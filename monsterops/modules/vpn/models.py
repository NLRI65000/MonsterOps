from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Column, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import TIMESTAMP

from monsterops.database import Base


class VpnTunnel(Base):

    __tablename__ = "mr_vpn_tunnel"

    id = Column(Integer, primary_key=True)
    name = Column(String(15), nullable=False, unique=True)
    type = Column(String(16), nullable=False, default="wireguard")
    enabled = Column(Boolean, nullable=False, default=False)
    description = Column(String(120))
    routes = Column(Text, nullable=False, default="")

    wg_private_key = Column(Text)
    wg_public_key = Column(Text)
    wg_address = Column(Text)
    wg_listen_port = Column(Integer)
    wg_peer_public_key = Column(Text)
    wg_peer_host = Column(Text)
    wg_peer_port = Column(Integer, default=51820)
    wg_persistent_keepalive = Column(Integer)
    wg_mtu = Column(Integer)
    wg_dns = Column(Text)

    l2tp_gateway = Column(Text)
    l2tp_psk = Column(Text)
    l2tp_username = Column(Text)
    l2tp_password = Column(Text)

    oper_state = Column(String(16), nullable=False, default="unknown")
    iface = Column(String(32))
    rx_bytes = Column(BigInteger)
    tx_bytes = Column(BigInteger)
    last_handshake_at = Column(TIMESTAMP(timezone=True))
    last_error = Column(Text)
    last_status_at = Column(TIMESTAMP(timezone=True))

    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("now()"))
