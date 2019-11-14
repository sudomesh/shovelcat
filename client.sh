#!/bin/sh

# Interface name for the tunnel
IFNAME="ppp0"

# Port where the tunnel daemon is listening
DAEMON_IP=107.170.232.149
DAEMON_PORT=9999

# Interface to get MAC address from.
# The MAC address is used as this device's unique identifier
# for talking to the tunnel daemon.
# It doesn't matter which interface is used as long as it exists
# and has a device-unique MAC address.
# Alternatively you can remove the MAC= line below
# and manually set ID= to some device-unique string
MAC_INTERFACE="wlan0"

# Ping the other end every HEARTBEAT_INTERVAL seconds
HEARTBEAT_INTERVAL=3


#--------------------------------------------------
# Don't edit beyond this point for config purposes
#--------------------------------------------------

# Generate device-unique ID from MAC address
MAC=$(ip link show dev $MAC_INTERFACE | grep ether| tr -s ' ' | cut -d ' ' -f 3)
ID=$(echo "$MAC meshmash" | md5sum)

connect() {

    echo "Connecting to shovelcat server"

    # ask tunneling server to open a tunnel
    REPLY=$(echo $ID | nc $DAEMON_IP $DAEMON_PORT)

    if [ $? -ne 0 ]; then
        echo "Unable to connect to tunneling daemon" > /dev/stderr
        return 1
    fi

    if [ -z $REPLY ]; then
        echo "Remote server closed socket without replying" > /dev/stderr
        return 1
    fi

    echo "Got reply"

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

    pppd pty "nc -u $DAEMON_IP $TUNNEL_PORT" ${TUNNEL_IP}:${SERVER_IP} ifname $IFNAME local nodetach silent &

    PPPD_PID=$!

    if [ $? -ne 0 ]; then
        echo "Failed to start pppd" >&2
        return 1
    fi

    # hacky but we need to wait for pppd to possibly rename the interface
    sleep 3

    ip link set dev $IFNAME up

    if [ $? -ne 0 ]; then
        echo "Failed to set $IFNAME state to up" >&2
        return 1
    fi

    ip addr add dev $IFNAME $TUNNEL_IP_SUBNET

    if [ $? -ne 0 ]; then
        echo "Failed to assign IP address to $IFNAME" >&2
        return 1
    fi

    echo "Local tunnel endpoint established"

    # ping three times, waiting 3 seconds for each reply
    ping -c 3 -W 3 -q $SERVER_IP > /dev/null 2>&1

    if [ $? -ne 0 ]; then
        echo "Unable to ping server over tunnel" >&2
        return 1
    else
        echo "Tunnel connection established!"    
    fi

    # heartbeat
    while [ $? -eq 0 ]; do
        echo "Pinging"
        sleep $HEARTBEAT_INTERVAL
        ping -c 1 -W 3 -q $SERVER_IP > /dev/null 2>&1
        
    done

    echo "No hearbeat response. Closing tunnel."
    kill $PPPD_PID > /dev/null 2>&1
    wait $PPPD_PID
    
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





# kill PPPD and wait for it to die
#kill $PPPD_PID
#wait $PPPD_PID
