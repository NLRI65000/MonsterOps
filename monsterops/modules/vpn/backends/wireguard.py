from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from monsterops.config import settings
from monsterops.modules.vpn.backends.base import (
    ConfigError,
    TunnelStatus,
    VpnBackend,
    have,
    run,
    safe_cidrs,
    safe_host,
    safe_ip_interface,
    safe_ips,
    safe_name,
    safe_port,
    safe_wg_key,
)

_REDACTED = "<hidden — set on this tunnel>"


class WireGuardBackend(VpnBackend):
    type = "wireguard"

    def _conf_path(self, t) -> Path:
        return Path(settings.vpn_config_dir) / f"{safe_name(t.name)}.conf"

    def _allowed_ips(self, t) -> str:
        cidrs = safe_cidrs(t.routes)
        if not cidrs:
            cidrs = [str(safe_ip_interface(t.wg_address))]
        return ", ".join(cidrs)

    def _render(self, t, *, redact: bool) -> str:
        if not t.wg_private_key or not t.wg_peer_public_key:
            raise ConfigError("WireGuard tunnel is missing keys")
        addr = safe_ip_interface(t.wg_address)
        peer_pub = safe_wg_key(t.wg_peer_public_key)
        endpoint = f"{safe_host(t.wg_peer_host)}:{safe_port(t.wg_peer_port or 51820)}"
        priv = _REDACTED if redact else safe_wg_key(t.wg_private_key)

        lines = ["[Interface]", f"Address = {addr}", f"PrivateKey = {priv}"]
        if t.wg_listen_port:
            lines.append(f"ListenPort = {safe_port(t.wg_listen_port)}")
        if t.wg_mtu:
            lines.append(f"MTU = {int(t.wg_mtu)}")
        dns = safe_ips(t.wg_dns)
        if dns:
            lines.append(f"DNS = {', '.join(dns)}")

        lines += ["", "[Peer]", f"PublicKey = {peer_pub}",
                  f"Endpoint = {endpoint}", f"AllowedIPs = {self._allowed_ips(t)}"]
        if t.wg_persistent_keepalive:
            lines.append(f"PersistentKeepalive = {int(t.wg_persistent_keepalive)}")
        return "\n".join(lines) + "\n"

    def preview(self, t) -> tuple[str, list[str]]:
        return self._render(t, redact=True), [str(self._conf_path(t))]

    def _write_conf(self, t) -> Path:
        path = self._conf_path(t)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(path.parent, 0o700)
        except OSError:
            pass
        content = self._render(t, redact=False)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(content)
        return path

    def tooling(self) -> tuple[bool, str | None]:
        if have("wg-quick") and have("wg"):
            return True, None
        return False, "WireGuard tools missing — install with: apt install wireguard-tools"

    async def up(self, t) -> TunnelStatus:
        ok, hint = self.tooling()
        if not ok:
            return TunnelStatus(oper_state="error", detail=hint)
        path = self._write_conf(t)
        await run(["wg-quick", "down", str(path)], timeout=20)
        rc, _out, err = await run(["wg-quick", "up", str(path)], timeout=30)
        if rc != 0:
            return TunnelStatus(oper_state="error", detail=err.strip() or "wg-quick up failed")
        return await self.status(t)

    async def down(self, t) -> TunnelStatus:
        path = self._conf_path(t)
        target = str(path) if path.exists() else safe_name(t.name)
        rc, _out, err = await run(["wg-quick", "down", target], timeout=20)
        if rc != 0 and "is not a WireGuard interface" not in err:
            return TunnelStatus(oper_state="error", detail=err.strip() or "wg-quick down failed")
        return TunnelStatus(oper_state="down", iface=safe_name(t.name))

    async def status(self, t) -> TunnelStatus:
        name = safe_name(t.name)
        if not have("wg"):
            return TunnelStatus(oper_state="unknown", detail="wg not installed")
        rc, out, _err = await run(["wg", "show", name, "dump"], timeout=10)
        if rc != 0:
            return TunnelStatus(oper_state="down", iface=name)
        rx = tx = 0
        last_hs: datetime | None = None
        for line in out.splitlines()[1:]:
            f = line.split("\t")
            if len(f) < 7:
                continue
            hs = int(f[4]) if f[4].isdigit() else 0
            rx += int(f[5]) if f[5].isdigit() else 0
            tx += int(f[6]) if f[6].isdigit() else 0
            if hs:
                ts = datetime.fromtimestamp(hs, tz=timezone.utc)
                last_hs = ts if last_hs is None or ts > last_hs else last_hs
        return TunnelStatus(oper_state="up", iface=name, rx_bytes=rx, tx_bytes=tx,
                            last_handshake_at=last_hs)
