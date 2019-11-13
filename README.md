Work in progress tunnel daemon for ppp over netcat tunnels.

For devices without support for any sane tunnels we can often use `pppd` and `nc` to open _some_ sort of tunnel.

This daemon listens for requests to open a tunnel, assigns an IP and port from a pool, opens the server end of the tunnel and informs the client of the assigned IP and port so the client can opent its end of the tunnel.

The client is a simple shell script capable of running on busybox as long as `pppd` and `nc` are available and PPP support is enabled in the kernel.

WARNING: This turns your box into an open relay with absolutely no authentication.

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

# Usage

## Server

```
sudo bin/cmd.js
```

## Client

The client is not quite working yet, but you can edit the top part of `client.sh` to configure the script, then simply run it as root.

You can manually replicate what the client does like so:

You simply open a TCP connection to the shovelcat daemon and send a unique identifier for your client that you've picked or randomly generated.

As an example:

```
echo "my unique id" | nc 127.0.0.1 9999
```

The server will reply with the server VPN IP, the IP and subnet you've been allocated on the VPN and the port to use for the tunnel connection in the format:

```
<server_ip>|<ip>/<netmask>:<port>\n
```

E.g:

```
172.20.0.1|172.20.0.10/24:8000
```

You should then open your end of the tunnel, e.g:

```
pppd pty "nc -u 127.0.0.1 8000" 172.20.0.10:172.20.0.1 local nodetach silent
```

and probably set the tunnel interface state to `up` and give it an IP:

```
ip link set dev ppp0 up
ip addr add dev ppp0 172.20.0.10/24
```

Then you should be able to ping `172.20.0.1`.

# ToDo

* Ensure server just prints an error instead of crashing on error
* Implement heartbeat and tunnel teardown/re-establish after timeout
* Kill pppd and nc when server/script is killed
* Finish IPv6 support

