#!/bin/sh

# Port where the tunnel daemon is listening
DAEMON_IP=juul.io
DAEMON_PORT=9999

# The command to use for netcat
NC_CMD="nc"

# Is the busybox version of netcat being used?
# If this is false then the OpenBSD version of netcat is assumed
BUSYBOX_NETCAT=true

# Use UDP for the tunnel? If this is false then TCP will be used
# You should definitely set this ti true if you have UDP support in your netcat
USE_UDP=true

# If your version of pppd supports setting the tunnel interface name
# using the `ifname <interface name>` syntax then you can use this
# to specify what you'd like the tunnnel interface to be called
# e.g. SET_IFNAME="ppp0"
# If you would like the tunnel interface name to be auto-detected
# then set this value to ""
SET_IFNAME=""

# Interface to get MAC address from.
# The MAC address is used as this device's unique identifier
# for talking to the tunnel daemon.
# It doesn't matter which interface is used as long as it exists
# and has a device-unique MAC address.
# Alternatively you can remove the MAC= line furthre down 
# and manually set ID= to some device-unique string
MAC_INTERFACE="wlan0"

# This should be the MTU of your network interface minus 64
MTU=1436

# Ping the other end every HEARTBEAT_INTERVAL seconds
HEARTBEAT_INTERVAL=3

# Paths to optional user-defined scripts to call when the tunnel goes up and down
# They receve as arguments:
#   <tunnel_iface_name> <tunnel_iface_ip> <tunnel_iface_subnet> <tunnel_port>
#POST_UP_HOOK="./dummy_up.sh"
#PRE_DOWN_HOOK="./dummy_down.sh"

# Where to store temporary files
TMP_DIR=/tmp/shovelcat

#--------------------------------------------------
# Don't edit beyond this point for config purposes
#--------------------------------------------------

if [ ! -z "$SET_IFNAME" ]; then
  IFNAME=$SET_IFNAME
else
  IFNAME="-"    
fi

mkdir -p $TMP_DIR
FIFO=${TMP_DIR}/${$}.fifo

# Generate device-unique ID from MAC address
MAC=$(ip link show dev $MAC_INTERFACE | grep ether| tr -s ' ' | cut -d ' ' -f 3)
ID=$(echo "$MAC meshmash" | md5sum)

PPPD_PID=""
TUNNEL_IP=""
TUNNEL_SUBNET=""
TUNNEL_PORT=""
 
disconnect() {

    if [ ! -z $PRE_DOWN_HOOK ]; then
        if [ -x $PRE_DOWN_HOOK ]; then
            $PRE_DOWN_HOOK $IFNAME $TUNNEL_IP $TUNNEL_IP_SUBNET $TUNNEL_PORT
        fi
    fi
    
    kill $PPPD_PID > /dev/null 2>&1
    wait $PPPD_PID
}

shutdown() {
    if [ -z $PPPD_PID ]; then
       exit 0
    fi
    
    echo "Shutting down tunnel"
    disconnect
    rm -f $FIFO
    exit 0
}

trap "shutdown" INT TERM

connect() {

    echo "Connecting to shovelcat server"

    NC_HANDSHAKE_ARGS=""
    if [ "$BUSYBOX_NETCAT" = true ]; then
        # For busybox netcat, when input is piped into the nc command
        # it will connect, send the piped data and immediately exit
        # unless the `-i` argument is given
        # The OpenBSD version of netcat will stay open until the remote
        # end closes the connection even without the `-i` flag
        NC_HANDSHAKE_ARGS="-i 3"
    fi
    
    # ask tunneling server to open a tunnel
    REPLY=$(echo $ID | $NC_CMD $NC_HANDSHAKE_ARGS $DAEMON_IP $DAEMON_PORT)

    if [ $? -ne 0 ]; then
        echo "Unable to connect to tunneling daemon" >&2
        return 1
    fi

    if [ -z $REPLY ]; then
        echo "Remote server closed socket without replying" >&2
        return 1
    fi

    echo "Got reply from server"

    # parse reply
    SERVER_IP=$(echo $REPLY | cut -d '|' -f 1 | sed 's/[^[[:digit:].]//g')
    TMP=$(echo $REPLY | cut -d '|' -f 2)
    TUNNEL_IP_SUBNET=$(echo $TMP | cut -d ':' -f 1 | sed 's/[^[[:digit:].\/]//g')
    TUNNEL_IP=$(echo $TUNNEL_IP_SUBNET | cut -d '/' -f 1)
    TUNNEL_SUBNET=$(echo $TUNNEL_IP_SUBNET | cut -d '/' -f 2)
    TUNNEL_PORT=$(echo $TMP | cut -d ':' -f 2 | sed 's/[^[[:digit:]]//g')

    if [ -z $SERVER_IP -o -z $TUNNEL_IP_SUBNET -o -z $TUNNEL_PORT ]; then
        echo "Server gave malformed response" >&2
        return 1
    fi

    echo "Remote tunnel endpoint established"

    PPP_ARGS=""
    if [ ! -z "$SET_IFNAME" ]; then
        PPP_ARGS="ifname $IFNAME"
    fi

    NC_ARGS=""
    if [ "$USE_UDP" = true ]; then
        NC_ARGS="-u"
    fi

    mkfifo $FIFO
    
    pppd pty "$NC_CMD $NC_ARGS $DAEMON_IP $TUNNEL_PORT" ${TUNNEL_IP}:${SERVER_IP} $PPP_ARGS local nodetach silent > $FIFO &

    PPPD_PID=$!

    if [ $? -ne 0 ]; then
        echo "Failed to start pppd" >&2
        rm -f $FIFO
        return 1
    fi

    if [ ! -z "$SET_IFNAME" ]; then
        # hacky but we need to wait for pppd to possibly rename the interface
        sleep 3
    fi

    echo "Waiting for tunnel interface name to be assigned"

    if [ -z "$SET_IFNAME" ]; then
        # Look at each line of output from pppd and wait for it to announce
        # the name of the interface
        while read line; do
            MATCH=$(echo $line | grep -i 'using interface')
            if [ "$?" -eq "0" ]; then
                IFNAME=$(echo $MATCH | cut -d ' ' -f 3)
                if [ -z "$IFNAME" ]; then
                    echo "Failed to find tunnel interface name" >&2
                    rm -f $FIFO
                    return 1
                fi
                break
            fi
        done <$FIFO
    fi

    echo "Tunnel interface is: $IFNAME"
    
    ip link set mtu $MTU dev $IFNAME

    if [ $? -ne 0 ]; then
        echo "Failed setting the mtu of $IFNAME to $MTU" >&2
        rm -f $FIFO
        return 1
    fi
    
    ip link set dev $IFNAME up
    
    if [ $? -ne 0 ]; then
        echo "Failed to set $IFNAME state to up" >&2
        rm -f $FIFO
        return 1
    fi

    ip addr add dev $IFNAME $TUNNEL_IP_SUBNET

    if [ $? -ne 0 ]; then
        echo "Failed to assign IP address to $IFNAME" >&2
        rm -f $FIFO
        return 1
    fi

    echo "Local tunnel endpoint established"

    # ping three times, waiting 3 seconds for each reply
    ping -c 3 -W 3 -q $SERVER_IP > /dev/null 2>&1

    if [ $? -ne 0 ]; then
        echo "Unable to ping server over tunnel" >&2
        rm -f $FIFO
        return 1
    else
        echo "Tunnel connection established!"
        if [ ! -z $POST_UP_HOOK ]; then
            if [ -x $POST_UP_HOOK ]; then
                $POST_UP_HOOK $IFNAME $TUNNEL_IP $TUNNEL_IP_SUBNET $TUNNEL_PORT
            fi
        fi
    fi

    # heartbeat
    while [ $? -eq 0 ]; do
        sleep $HEARTBEAT_INTERVAL
        ping -c 1 -W 3 -q $SERVER_IP > /dev/null 2>&1
    done
    
    echo "No hearbeat response. Closing tunnel."
    disconnect

    rm -f $FIFO
    
    return 0
}

RETRY_TIMEOUT_INITIAL=1
RETRY_TIMEOUT_MAX=60
RETRY_TIMEOUT=$RETRY_TIMEOUT_INITIAL

while [ 1 ]; do
    connect
    
    # if we were connected then reset the retry timeout
    if [ $? -eq 0 ]; then
        RETRY_TIMEOUT=$RETRY_TIMEOUT_INITIAL
    else
        RETRY_TIMEOUT=$(expr $RETRY_TIMEOUT \* 2)
        if [ $RETRY_TIMEOUT -gt $RETRY_TIMEOUT_MAX ]; then
            RETRY_TIMEOUT=$RETRY_TIMEOUT_MAX
        fi
    fi

    echo "Retrying in $RETRY_TIMEOUT seconds"
    sleep $RETRY_TIMEOUT
done

