#!/usr/bin/env node

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var net = require('net');

// TODO add support for more than a /24 subnet of nodes

var settings = require('../settings.js');

var tunnelIPCount = 10; // used as the last part of the tunnel IP
var tunnelPortCount = 0;

var maxTunnelCount = 200; // TODO actually check this

var tunnels = {};

if(process.getuid() !== 0) {
  console.error("shovelcat must be run as root");
  process.exit(1);
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
  if(tunnel.process) {
    tunnel.socket.destroy();
    tunnel.process.kill();
  }
  delete tunnels[tunnel.id]
}

function configureTunnel(tunnel, cb) {
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
  
    exec('ip addr add dev '+tunnel.ifname+' '+tunnel.tunnelIP+'/'+settings.tunnelNetmask, {shell: true},  function(err, stdout, stderr) {
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
    'pty',
    'nc -l '+tunnel.port,
    settings.tunnelIP+':'+tunnelIP,
    'local',
    'nodetach',
    'silent'];
  
  var pppd = spawn(cmd, args, {
  });
  
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
        console.error("pppd died for tunnel:", tunnel, "with error:", stderr);
      } else {
        console.error("pppd died for tunnel:", tunnel);
      }
    }
    console.log("pppd terminated peacefully for tunnel:", tunnel);
    console.log(stdout)
    console.log(stderr)    
  });

  // TODO add timeout so we kill this process if we never learn the tunnel interface name
}

var server = net.createServer(function(socket) {

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
        } catch(e) {
          console.log("Socket closed before we could tell the client their IP");
          tunnel.killMe = true;
        }
      });
    } catch(e) {
      socket.write("Error: " + e.toString());
      socket.destroy();
    }
  });
}).on('error', function(err) {
  console.log("Error:", err);
});

server.listen({
  host: settings.ip,
  port: settings.port
}, function() {
  console.log("Server listening in port", settings.port);
});

  
