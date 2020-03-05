#!/usr/bin/env node

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var net = require('net');
var kill = process.kill;
var settings = require('../settings.js');

var tunnelIPCount = 10; // used as the last part of the tunnel IP
var tunnelPortCount = 0;

var maxTunnelCount = 200; // TODO actually check this

var tunnels = {};

if(process.getuid() !== 0) {
  console.error("shovelcat must be run as root");
  process.exit(1);
}

var shutdownTriggered = false;

function shutdown() {
  if(shutdownTriggered) return;
  shutdownTriggered = true;
     
  var id;
  console.log("Shutting down all tunnels")
  for(id in tunnels) {
    closeTunnel(tunnels[id]);
  }
  process.exit();
}

process.on('exit', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// first arg to callback will be truthy if ping failed, otherwise falsy
function ping(host, cb) {
  exec('ping -c 3 -W 5 '+host, cb);
}

function heartbeat(tunnel, cb) {
  if(tunnel.closed) return;

  ping(tunnel.tunnelIP, function(fail, foo, bar) {
    if(fail) {
      if(tunnel.closed) return;
      return cb();
    }

    setTimeout(function() {
      heartbeat(tunnel, cb);
    }, settings.heartbeatInterval * 1000);
  });
}

function allocatePort() {
  var i, id, tun, used;
  for(i=settings.tunnelPortFrom; i < settings.tunnelPortTo; i++) {
    used = false;
    for(id in tunnels) {
      tun = tunnels[id];
      if(tun.port === i) {
        used = true;
        break
      }
    }
    if(!used) return i;
  }
  throw new Error("No unallocated ports remaining");
}


function ipToNumber(ip) {
  var parts = ip.split('.');
  var number = 0;
  var n;
  var i;
  for(i=0; i < 4; i++) {
    n = parseInt(parts[i])
    if(n < 0 || n > 255) throw new Error("Invalid IP: " + ip);
    number += n * Math.pow(256, 3-i)
  }
  return number;
}

function numberToIP(number) {
  var parts = [0, 0, 0, 0]
  var i, p;
  for(i=0; i < 3; i++) {
    p = Math.pow(256, 3-i)
    parts[i] = Math.floor(number / p);
    number -= parts[i] * p;
  }
  parts[3] = number;
  return parts.join('.');
}

function allocateIP() {
  var from = ipToNumber(settings.tunnelIPFrom);
  var to = ipToNumber(settings.tunnelIPTo);
  
  var n, id, tun, used;
  for(n=from; n <= to; n++) {
    used = false
    for(id in tunnels) {
      tun = tunnels[id];
      if(ipToNumber(tun.tunnelIP) === n) {
        used = true;
        break;
      }
    }
    if(!used) return numberToIP(n);
  }
  throw new Error("No unallocated ports remaining");
}

function parseClientHello(data) {

  var client = {
    id: data.toString()
  }
  if(!client.id || client.id.length < 8) {
    throw new Error("Client ID missing or shorter than 8 characters (UTF-8)");
  }

  return client;
}

function closeTunnel(tunnel) {
  if(tunnel.closed) return;
  
  if(tunnel.process) {
    if(settings.preDownHook) {
      var process = spawn(settings.preDownHook, [tunnel.ifname, tunnel.tunnelIP, settings.tunnelNetmask, tunnel.port], {
        detached: true
      });
    }
    tunnel.socket.destroy();

    // Send SIGINT to the process group
    kill(-tunnel.process.pid, 'SIGINT');
  }
  delete tunnels[tunnel.id]
  tunnel.closed = true;
}

function configureTunnel(tunnel, cb) {
  exec('ip link set mtu '+settings.mtu+' dev '+tunnel.ifname, {shell: true}, function(err, stdout, stderr) {
    if(err) {
      var str = "Setting tunnel MTU to "+settings.mtu+" failed";
      if(stderr) {
        str += ": " + stderr;
      }
      return cb(new Error(str));
    }
    exec('ip link set dev '+tunnel.ifname+' up', {shell: true}, function(err, stdout, stderr) {
      if(err) {
        var str = "Setting tunnel state to UP failed";
        if(stderr) {
          str += ": " + stderr;
        }
        return cb(new Error(str));
      }
      
      // TODO add IPv6 support here
      if(tunnel.ipv6) {
        return cb(new Error("configureTunnel does not have IPv6 support"));
      }
      
      exec('ip addr add dev '+tunnel.ifname+' '+settings.tunnelIP+'/'+settings.tunnelNetmask, {shell: true},  function(err, stdout, stderr) {
        if(err) {
          var str = "Configuring tunnel failed";
          if(stderr) {
            str += ": " + stderr;
          }
          return cb(new Error(str));
        }
        cb(null, tunnel);
      });
    });
  });
}
  
function openTunnel(client, cb) {
  if(tunnels[client.id]) {
    closeTunnel(tunnels[client.id]);
    process.nextTick(function() {
      openTunnel(client, cb);
    });
    return;
  }

  try {
    var tunnelIP = allocateIP();
    var tunnelPort = allocatePort();
  } catch(e) {
    return cb(err);
  }
  
  var tunnel = {
    socket: client.socket,
    internetIP: client.ip,
    tunnelIP: tunnelIP,
    id: client.id,
    port: tunnelPort,
    ipv6: client.ipv6
  };

  tunnels[tunnel.id] = tunnel;

  console.log("Opening tunnel for", client.ip, "on port", tunnel.port);
  
  var cmd = 'pppd';
  var args = [
    'pty', // use the following script to communicate
    settings.ncCmd + (settings.useUDP ? ' -u ' : '') + ' -l ' + tunnel.port,
    'child-timeout', 0, // wait for child process (nc) to exit when terminating
    settings.tunnelIP + ':' + tunnelIP, // set local and remote IP addresses
    'local', // don't use modem control lines
    'nodetach', // don't detach from controlling terminal
    'silent']; // don't transmit LCP packets until an LCP packet is received
  
  var pppd = spawn(cmd, args, {});
  
  tunnel.process = pppd;
  
  var stderr = '';
  var stdout = '';
  pppd.stdout.on('data', function(data) {
    stdout += data.toString();
    if(tunnel.ifname) return;
    // wait for pppd to output tunnel interface name
    var m = stdout.match(/^Using interface\s+([\w\d]+)/);
    if(!m || m.length < 2) return;
    tunnel.ifname = m[1];
    console.log("Tunnel up with interface:", tunnel.ifname);
    
    configureTunnel(tunnel, cb);
  });

  pppd.stderr.on('data', function(data) {
    stderr += data;
  });
  pppd.on('close', function(exitCode) {
    if(exitCode !== 0) {
      if(stderr) {
        console.error("pppd died for tunnel with IP", tunnel.internetIP, "with error:", stderr);
        console.log("pppd stdout said:", stdout);
        closeTunnel(tunnel);
      } else {
        console.error("pppd died for tunnel with IP", tunnel.internetIP);
        console.log("pppd stdout said:", stdout);
        closeTunnel(tunnel);
      }
      return;
    }
    console.log("pppd terminated peacefully for tunnel with IP:", tunnel.internetIP);
    closeTunnel(tunnel);
  });

  // TODO add timeout so we kill this process if we never learn the tunnel interface name
}

var server = net.createServer(function(socket) {
  try {
    var addr = socket.address();
    console.log("Client connected from IP:", addr.address);
    
    socket.on('data', function(data) {
      try {
        var client = parseClientHello(data);
        client.ip = addr.address;
        if(addr.family !== 'IPv4') {
          client.ipv6 = true;
        }
        client.socket = socket;
        openTunnel(client, function(err, tunnel) {
          if(err) return console.error(err);
          
          try {
            socket.write(settings.tunnelIP+'|'+tunnel.tunnelIP+'/'+settings.tunnelNetmask+':'+tunnel.port+"\n");
            socket.end();

            if(settings.postUpHook) {
              spawn(settings.postUpHook, [tunnel.ifname, tunnel.tunnelIP, settings.tunnelNetmask, tunnel.port]);
            }

            // start heartbeat
            if(settings.heartbeatInterval) {
              
              // Kinda hacky but we shouldn't ping the client
              // before the client has time to bring up its own end
              // so we wait 20 seconds before sending the first heartbeat.
              // This is fine since the heartbeat is only to clean up dead tunnels
              // when clients disconnect and don't reconnect
              setTimeout(function() {
                heartbeat(tunnel, function() {
                  console.log("Heartbeat failed for IP", tunnel.internetIP);
                  closeTunnel(tunnel);
                });
              }, 20000); 
            }
            
          } catch(e) {
            console.log("Socket closed before we could tell the client their IP:", e);
            closeTunnel(tunnel);
          }

        });
      } catch(e) {
        socket.write("Error: " + e.toString());
        socket.destroy();
      }
    });
  } catch(e) {
    console.log("Error:", e);
  }
}).on('error', function(err) {
  console.log("Error:", err);
});

server.listen({
  host: settings.ip,
  port: settings.port
}, function() {
  console.log("Server listening on port", settings.port);
});

  
