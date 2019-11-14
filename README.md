Tunnel daemon for `ppp over netcat` tunnels.

For devices without support for any sane tunnels we can often use `pppd` and `nc` to open _some_ sort of tunnel.

The daemon listens for requests to open a tunnel, assigns an IP and port from a specified pool, opens the server end of the tunnel and informs the client of the assigned IP and port. The client then opens its end of the tunnel.

The client is a simple shell script capable of running on busybox.

WARNING: The deamon turns your box into an open relay with absolutely no authentication.

# Requirements

The server needs node.js, the `pppd` daemon, PPP support in the kernel and the `ip` and `ping` commands. A fairly old version of node.js should work. There are no dependecies on other node.js packages.

The client needs a shell (busybox sh or dash is fine), PPP support in the kernel, the `pppd` daemon and the `nc`, `ip` and `ping` commands.

Both client and server must be run as root.

# Configuration

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

* Finish IPv6 support
