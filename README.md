Work in progress tunnel daemon for ppp over netcat tunnels.

For devices without support for any sane tunnels we can often use `pppd` and `nc` to open _some_ sort of tunnel.

This daemon listens for requests to open a tunnel, assigns an IP and port from a pool, opens the server end of the tunnel and informs the client of the assigned IP and port so the client can opent its end of the tunnel.

The client is a simple shell script capable of running on busybox as long as `pppd` and `nc` are available and PPP support is enabled in the kernel.

WARNING: This turns your box into an open relay with absolutely no authentication.

# Requirements

The server needs node.js, the `pppd` daemon, PPP support in the kernel and the `ip` command. A fairly old version of node.js should work. There are no dependecies on other node.js packages.

The client needs a shell (busybox sh or dash is fine), the `nc` command, the `pppd` daemon and PPP support in the kernel.

Both client and server must be run as root.

# Configuration

This is just enough to establish the tunnel. You still have to manualy add the appropriate routing rules to get traffic flowing.

## Server

This should be the contents of `/etc/ppp/options`:

```
lock
noauth
ipcp-accept-local
ipcp-accept-remote
noproxyarp
```

Copy `settings.js.example` and edit to suit your setup:

```
cp settings.js.example settings.js
```

## Client

This should be the contents of `/etc/ppp/options`:

```
lock
noauth
noproxyarp
```

Edit the top part of `client.sh` to configure the script,

# Usage

## Server

```
sudo ./bin/cmd.js
```

## Client

```
sudo ./client.sh
```

# ToDo

* Implement server heartbeat and tunnel teardown/re-establish after timeout
* Finish IPv6 support

