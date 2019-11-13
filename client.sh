#!/bin/sh

# Interface name for the tunnel
IFNAME="ppp0"

# Port where the tunnel daemon is listening
DEAMON_IP=127.0.0.1
DEAMON_PORT=9999

# Interface to get MAC address from.
# The MAC address is used as this device's unique identifier
# for talking to the tunnel daemon.
# It doesn't matter which interface is used as long as it exists
# and has a device-unique MAC address.
# Alternatively you can remove the MAC= line below
# and manually set ID= to some device-unique string
MAC_INTERFACE="wlan0"

#--------------------------------------------------
# Don't edit beyond this point for config purposes
#--------------------------------------------------

# generate device-unique ID from MAC address
MAC=$(ip link show dev $MAC_INTERFACE | grep ether| tr -s ' ' | cut -d ' ' -f 3)
ID=$(echo "$MAC meshmash" | md5sum)

echo "Connecting to shovelcat server"

# ask tunneling server to open a tunnel
REPLY=$(echo $ID | nc $DAEMON_IP $DAEMON_PORT)

if [ $? -ne 0 ]; then
    echo "Unable to connect to tunneling daemon" > /dev/stderr
    exit 1
fi

if [ -z $REPLY ]; then
    echo "Remote server closed socket without replying" > /dev/stderr
    exit 1
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
    echo "Server gave malformed response" > /dev/stderr
    exit 1
fi

echo "Remote tunnel endpoint established"

pppd pty "nc -u $DAEMON_IP $DAEMON_PORT" ${TUNNEL_IP}:${SERVER_IP} ifname $IFNAME local nodetach silent &

PPPD_PID=$!

if [ $? -ne 0 ]; then
    echo "Failed to start pppd" > /dev/stderr
    exit 1
fi

ip link set dev $IFNAME up

if [ $? -ne 0 ]; then
    echo "Failed to set $IFNAME state to up" > /dev/stderr
    exit 1
fi

ip addr add dev $IFNAME $TUNNEL_IP_SUBNET

if [ $? -ne 0 ]; then
    echo "Failed to assign IP address to $IFNAME" > /dev/stderr
    exit 1
fi

echo "Local tunnel endpoint established"

# ping three times, waiting 3 seconds for each reply
ping -c 3 -W 3 -q $SERVER_IP

if [ $? -ne 0 ]; then
    echo "Unable to ping server over tunnel" > /dev/stderr
    exit 1
fi

echo "Tunnel connection established!"

# ToDo
# * kill pppd when script this is killed
# * Add keepalive and tunnel re-establish

wait $PPPD_PID

# kill PPPD and wait for it to die
#kill $PPPD_PID
#wait $PPPD_PID