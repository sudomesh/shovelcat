Tunnel daemon for `ppp over netcat` tunnels.

For devices without support for any sane tunnels we can often use `pppd` and `nc` to open _some_ sort of tunnel.

The daemon listens for requests to open a tunnel, assigns an IP and port from a specified pool, opens the server end of the tunnel and informs the client of the assigned IP and port. The client then opens its end of the tunnel.

The client is a simple shell script capable of running on busybox.

WARNING: The tunnel deamon has absolutely no authentication. Anyone will be able to open a tunnel so be careful what you allow through your endpoint.

# Requirements

The server needs node.js, the `pppd` daemon, PPP support in the kernel and the `nc`, `ip` and `ping` commands. A fairly old version of node.js should work. There are no dependecies on other node.js packages. The server has only been tested with the OpenBSD version of `nc`. On Debian-based systems this can be installed with `apt install netcat-openbsd`.

The client needs a shell (busybox sh or dash is fine), PPP support in the kernel, the `pppd` daemon and the `nc`, `ip` and `ping` commands. It is a really good idea to use a version of `nc` that supports UDP, since tunneling over TCP often won't be a great experience. A pre-compiled ARM version of busybox that only includes netcat (with UDP support) is in the `utils/` folder.

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

## A note on MTU

I've seen the tunnel overhead vary between 52 and 54 bytes, but I've only tested with small packets. I'm not sure if 54 is the actual max. I've set the default MTU to 1436 which assumes a maximum 64 byte overhead. Hopefully that's enough.

# ToDo

* Finish IPv6 support
