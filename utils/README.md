
This directory contains pre-compiled binaries for arm-linux-gnueabi to support shovelcat on embedded systems.

`busybox` is busybox-1.31.1 compiled only with the `nc` commands (and mandatory parts of busybox). The busybox source code and license can be found [here](https://www.busybox.net/).

To use this busybox's netcat with shovelcat simply copy it to e.g. `/usr/bin/busybox_alt` on your target system, ensure that it is executable and set the following variables in `client.sh`:

```
NC_CMD="busybox_alt nc"
BUSYBOX_NETCAT=true
USE_UDP=true
```
