#!/bin/sh
set -eu

NS=ploma-egress
HOST_IF=ploma-host
PEER_IF=ploma-peer
SUBNET=10.203.0.0/30
HOST_IP=10.203.0.1/30
PEER_IP=10.203.0.2/30
WAN_IF=eth0
PROXY_UID=$(id -u tinyproxy)

up() {
  install -d -o tinyproxy -g tinyproxy -m 0750 /run/ploma-vpn-proxy
  if ! ip netns exec "$NS" true >/dev/null 2>&1; then
    ip netns add "$NS"
  fi
  if ! ip link show "$HOST_IF" >/dev/null 2>&1; then
    ip link add "$HOST_IF" type veth peer name "$PEER_IF"
    ip link set "$PEER_IF" netns "$NS"
  fi
  ip address replace "$HOST_IP" dev "$HOST_IF"
  ip link set "$HOST_IF" up
  ip netns exec "$NS" ip link set lo up
  ip netns exec "$NS" ip address replace "$PEER_IP" dev "$PEER_IF"
  ip netns exec "$NS" ip link set "$PEER_IF" up
  ip netns exec "$NS" ip route replace default via 10.203.0.1 dev "$PEER_IF"

  sysctl -q -w net.ipv4.ip_forward=1
  iptables -t nat -C POSTROUTING -s "$SUBNET" -o "$WAN_IF" -j MASQUERADE >/dev/null 2>&1 || \
    iptables -t nat -A POSTROUTING -s "$SUBNET" -o "$WAN_IF" -j MASQUERADE
  iptables -C FORWARD -i "$WAN_IF" -o "$HOST_IF" -d "$SUBNET" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT >/dev/null 2>&1 || \
    iptables -I FORWARD 1 -i "$WAN_IF" -o "$HOST_IF" -d "$SUBNET" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  iptables -C FORWARD -i "$HOST_IF" -o "$WAN_IF" -s "$SUBNET" -j ACCEPT >/dev/null 2>&1 || \
    iptables -I FORWARD 2 -i "$HOST_IF" -o "$WAN_IF" -s "$SUBNET" -j ACCEPT
  iptables -C FORWARD -i "$WAN_IF" -o "$WAN_IF" -j DROP >/dev/null 2>&1 || \
    iptables -I FORWARD 3 -i "$WAN_IF" -o "$WAN_IF" -j DROP
  iptables -C FORWARD -j DROP >/dev/null 2>&1 || iptables -A FORWARD -j DROP

  ip netns exec "$NS" iptables -C OUTPUT -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" \
    -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT >/dev/null 2>&1 || \
    ip netns exec "$NS" iptables -I OUTPUT 1 -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" \
      -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip netns exec "$NS" iptables -C OUTPUT -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" -j REJECT >/dev/null 2>&1 || \
    ip netns exec "$NS" iptables -I OUTPUT 2 -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" -j REJECT
}

down() {
  if ip netns exec "$NS" true >/dev/null 2>&1; then
    ip netns exec "$NS" iptables -D OUTPUT -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" -j REJECT >/dev/null 2>&1 || true
    ip netns exec "$NS" iptables -D OUTPUT -m owner --uid-owner "$PROXY_UID" -o "$PEER_IF" \
      -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT >/dev/null 2>&1 || true
    ip netns delete "$NS"
  fi
  iptables -D FORWARD -j DROP >/dev/null 2>&1 || true
  iptables -D FORWARD -i "$WAN_IF" -o "$WAN_IF" -j DROP >/dev/null 2>&1 || true
  iptables -D FORWARD -i "$HOST_IF" -o "$WAN_IF" -s "$SUBNET" -j ACCEPT >/dev/null 2>&1 || true
  iptables -D FORWARD -i "$WAN_IF" -o "$HOST_IF" -d "$SUBNET" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT >/dev/null 2>&1 || true
  iptables -t nat -D POSTROUTING -s "$SUBNET" -o "$WAN_IF" -j MASQUERADE >/dev/null 2>&1 || true
  ip link delete "$HOST_IF" >/dev/null 2>&1 || true
  sysctl -q -w net.ipv4.ip_forward=0
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) printf 'Usage: %s {up|down}\n' "$0" >&2; exit 2 ;;
esac
