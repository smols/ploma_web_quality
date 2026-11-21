#!/bin/sh
set -eu

CONFIG=/etc/amnezia/amneziawg/awg0.conf
VETH=ploma-peer
VETH_GATEWAY=10.203.0.1

endpoint_ip() {
  endpoint=$(awk -F= 'tolower($1) ~ /^[[:space:]]*endpoint[[:space:]]*$/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$CONFIG")
  case "$endpoint" in
    \[*\]:*) endpoint=${endpoint#\[}; endpoint=${endpoint%%\]*} ;;
    *:*) endpoint=${endpoint%:*} ;;
    *) echo "Could not parse AWG endpoint from config" >&2; return 1 ;;
  esac
  printf '%s\n' "$endpoint"
}

case "${1:-}" in
  up)
    peer=$(endpoint_ip)
    ip route replace "$peer/32" via "$VETH_GATEWAY" dev "$VETH"
    ip route replace default dev awg0
    ip -6 route replace default dev awg0 2>/dev/null || true
    ;;
  down)
    peer=$(endpoint_ip)
    ip route del default dev awg0 2>/dev/null || true
    ip -6 route del default dev awg0 2>/dev/null || true
    ip route del "$peer/32" via "$VETH_GATEWAY" dev "$VETH" 2>/dev/null || true
    ip route replace default via "$VETH_GATEWAY" dev "$VETH"
    ;;
  *) echo "Usage: $0 {up|down}" >&2; exit 2 ;;
esac
