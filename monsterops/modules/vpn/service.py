from __future__ import annotations

from datetime import datetime, timezone

from monsterops.modules.vpn.backends.base import TunnelStatus, VpnBackend
from monsterops.modules.vpn.backends.l2tp_ipsec import L2tpIpsecBackend
from monsterops.modules.vpn.backends.wireguard import WireGuardBackend

_BACKENDS: dict[str, VpnBackend] = {
    WireGuardBackend.type: WireGuardBackend(),
    L2tpIpsecBackend.type: L2tpIpsecBackend(),
}


def get_backend(tunnel_type: str) -> VpnBackend:
    try:
        return _BACKENDS[tunnel_type]
    except KeyError:
        raise ValueError(f"unknown tunnel type: {tunnel_type!r}")


def apply_status(t, st: TunnelStatus) -> None:
    t.oper_state = st.oper_state
    if st.iface is not None:
        t.iface = st.iface
    t.rx_bytes = st.rx_bytes
    t.tx_bytes = st.tx_bytes
    if st.last_handshake_at is not None:
        t.last_handshake_at = st.last_handshake_at
    t.last_error = st.detail if st.oper_state == "error" else None
    t.last_status_at = datetime.now(tz=timezone.utc)
