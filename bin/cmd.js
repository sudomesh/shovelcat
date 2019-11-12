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
    console.log("KILLING:", tunnel.process.pid);
    tunnel.socket.destroy();
    tunnel.process.kill();
  }
  delete tunnels[tunnel.port]
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
  if(tunnels[client.port]) {
    if(tunnels[client.port].id === client.id) {
      
      closeTunnel(tunnels[client.port]);
      process.nextTick(function() {
        openTunnel(client, cb);
      });
      return;
      
    } else {
      return cb(new Error("Another client (different ID) is already using this port"));
    }
  }

  // TODO move to own function
  var tunnelIP = settings.tunnelIPPrefix + tunnelIPCount;
  tunnelIPCount++;
  var tunnelPort = settings.tunnelPortStart + tunnelPortCount;
  tunnelPortCount++;
  
  var tunnel = {
    socket: client.socket,
    internetIP: client.ip,
    tunnelIP: tunnelIP,
    id: client.id,
    port: tunnelPort,
    ipv6: client.ipv6
  };

  tunnels[tunnelPort] = tunnel;

  console.log("Opening tunnel for", client.ip, "on port", client.port);
  
  var cmd = 'pppd';
  var args = [
    'pty',
    'nc -u -l '+tunnel.port,
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

  
