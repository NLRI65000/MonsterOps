from __future__ import annotations

import asyncio
import os
from pathlib import Path

from monsterops.modules.vpn.backends.base import (
    ConfigError,
    TunnelStatus,
    VpnBackend,
    have,
    run,
    safe_cidrs,
    safe_host,
    safe_name,
    safe_secret,
    safe_user,
)

_REDACTED = "<hidden — set on this tunnel>"
_RUN_DIR = Path("/run/monsterops-vpn")
_CHAP_SECRETS = Path("/etc/ppp/chap-secrets")


class L2tpIpsecBackend(VpnBackend):
    type = "l2tp-ipsec"


    def _conn_path(self, name: str) -> Path:
        return Path(f"/etc/ipsec.d/mr-{name}.conf")

    def _secrets_path(self, name: str) -> Path:
        return Path(f"/etc/ipsec.d/mr-{name}.secrets")

    def _xl2tpd_path(self, name: str) -> Path:
        return Path(f"/etc/xl2tpd/mr-{name}.conf")

    def _ppp_opts_path(self, name: str) -> Path:
        return Path(f"/etc/ppp/options.l2tpd.mr-{name}")

    def _control_path(self, name: str) -> Path:
        return _RUN_DIR / f"{name}.control"

    def _pid_path(self, name: str) -> Path:
        return _RUN_DIR / f"{name}.pid"

    def _lac(self, name: str) -> str:
        return f"mr-{name}"


    def _render_conn(self, t) -> str:
        name = safe_name(t.name)
        gw = safe_host(t.l2tp_gateway)
        return (
            f"conn {self._lac(name)}\n"
            "    keyexchange=ikev1\n"
            "    authby=secret\n"
            "    type=transport\n"
            "    left=%defaultroute\n"
            "    leftprotoport=17/1701\n"
            f"    right={gw}\n"
            "    rightprotoport=17/1701\n"
            "    auto=add\n"
        )

    def _render_secrets(self, t, *, redact: bool) -> str:
        gw = safe_host(t.l2tp_gateway)
        psk = _REDACTED if redact else safe_secret(t.l2tp_psk)
        return f'%any {gw} : PSK "{psk}"\n'

    def _render_xl2tpd(self, t) -> str:
        name = safe_name(t.name)
        gw = safe_host(t.l2tp_gateway)
        return (
            f"[lac {self._lac(name)}]\n"
            f"lns = {gw}\n"
            "ppp debug = no\n"
            f"pppoptfile = {self._ppp_opts_path(name)}\n"
            "length bit = yes\n"
            "redial = yes\n"
            "redial timeout = 10\n"
        )

    def _render_ppp_opts(self, t) -> str:
        user = safe_user(t.l2tp_username)
        return (
            "ipcp-accept-local\n"
            "ipcp-accept-remote\n"
            "refuse-eap\n"
            "require-mschap-v2\n"
            "noccp\n"
            "noauth\n"
            "mtu 1400\n"
            "mru 1400\n"
            "idle 0\n"
            "connect-delay 5000\n"
            f"name {user}\n"
        )

    def _chap_line(self, t, *, redact: bool) -> str:
        user = safe_user(t.l2tp_username)
        pw = _REDACTED if redact else safe_secret(t.l2tp_password)
        return f'"{user}" * "{pw}" *\t# monsterops:mr-{safe_name(t.name)}'

    def preview(self, t) -> tuple[str, list[str]]:
        name = safe_name(t.name)
        blocks = [
            (self._conn_path(name), self._render_conn(t)),
            (self._secrets_path(name), self._render_secrets(t, redact=True)),
            (self._xl2tpd_path(name), self._render_xl2tpd(t)),
            (self._ppp_opts_path(name), self._render_ppp_opts(t)),
            (_CHAP_SECRETS, self._chap_line(t, redact=True) + "\n"),
        ]
        text = "\n".join(f"# ── {path} ──\n{content}" for path, content in blocks)
        routes = safe_cidrs(t.routes)
        if routes:
            text += "\n# routes added on the ppp interface once connected:\n"
            text += "".join(f"#   ip route add {c} dev <pppN>\n" for c in routes)
        return text, [str(p) for p, _ in blocks]


    def tooling(self) -> tuple[bool, str | None]:
        missing = [b for b in ("ipsec", "xl2tpd", "xl2tpd-control", "pppd") if not have(b)]
        if missing:
            return False, (
                "L2TP/IPsec tools missing (" + ", ".join(missing) +
                ") — install with: apt install strongswan xl2tpd ppp"
            )
        return True, None

    def _write(self, path: Path, content: str, mode: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w") as fh:
            fh.write(content)

    def _upsert_chap_secret(self, t) -> None:
        marker = f"# monsterops:mr-{safe_name(t.name)}"
        existing = _CHAP_SECRETS.read_text().splitlines() if _CHAP_SECRETS.exists() else []
        kept = [ln for ln in existing if marker not in ln]
        kept.append(self._chap_line(t, redact=False))
        self._write(_CHAP_SECRETS, "\n".join(kept) + "\n", 0o600)

    def _remove_chap_secret(self, name: str) -> None:
        if not _CHAP_SECRETS.exists():
            return
        marker = f"# monsterops:mr-{name}"
        kept = [ln for ln in _CHAP_SECRETS.read_text().splitlines() if marker not in ln]
        self._write(_CHAP_SECRETS, "\n".join(kept) + ("\n" if kept else ""), 0o600)

    async def _list_ppp(self) -> set[str]:
        rc, out, _ = await run(["ip", "-o", "link", "show"], timeout=10)
        if rc != 0:
            return set()
        return {p.split(":")[0].strip() for line in out.splitlines()
                for p in [line.split(": ", 1)[1]] if p.startswith("ppp")}

    async def up(self, t) -> TunnelStatus:
        ok, hint = self.tooling()
        if not ok:
            return TunnelStatus(oper_state="error", detail=hint)

        name = safe_name(t.name)
        lac = self._lac(name)
        _RUN_DIR.mkdir(parents=True, exist_ok=True)
        try:
            self._write(self._conn_path(name), self._render_conn(t), 0o600)
            self._write(self._secrets_path(name), self._render_secrets(t, redact=False), 0o600)
            self._write(self._xl2tpd_path(name), self._render_xl2tpd(t), 0o644)
            self._write(self._ppp_opts_path(name), self._render_ppp_opts(t), 0o600)
            self._upsert_chap_secret(t)
        except (OSError, ConfigError) as exc:
            return TunnelStatus(oper_state="error", detail=f"config write failed: {exc}")

        before = await self._list_ppp()

        rc, _o, err = await run(["ipsec", "reload"], timeout=20)
        if rc != 0:
            return TunnelStatus(oper_state="error", detail=f"ipsec reload: {err.strip()}")
        rc, _o, err = await run(["ipsec", "up", lac], timeout=30)
        if rc != 0:
            return TunnelStatus(oper_state="error", detail=f"ipsec up: {err.strip()}")

        control, pid = self._control_path(name), self._pid_path(name)
        await run(["xl2tpd", "-c", str(self._xl2tpd_path(name)),
                   "-C", str(control), "-p", str(pid)], timeout=15)
        await asyncio.sleep(1)
        rc, _o, err = await run(["xl2tpd-control", "-c", str(control), "connect", lac], timeout=20)
        if rc != 0:
            return TunnelStatus(oper_state="error", detail=f"xl2tpd connect: {err.strip()}")

        iface = None
        for _ in range(10):
            await asyncio.sleep(1)
            new = await self._list_ppp() - before
            if new:
                iface = sorted(new)[0]
                break
        if not iface:
            return TunnelStatus(oper_state="error", detail="ppp interface did not come up")

        for cidr in safe_cidrs(t.routes):
            await run(["ip", "route", "replace", cidr, "dev", iface], timeout=10)
        return TunnelStatus(oper_state="up", iface=iface)

    async def down(self, t) -> TunnelStatus:
        name = safe_name(t.name)
        lac = self._lac(name)
        control = self._control_path(name)
        if have("xl2tpd-control") and control.exists():
            await run(["xl2tpd-control", "-c", str(control), "disconnect", lac], timeout=15)
        if have("ipsec"):
            await run(["ipsec", "down", lac], timeout=15)
        pid = self._pid_path(name)
        if pid.exists():
            try:
                await run(["kill", pid.read_text().strip()], timeout=5)
            except (OSError, ValueError):
                pass
        self._remove_chap_secret(name)
        return TunnelStatus(oper_state="down", iface=t.iface)

    async def status(self, t) -> TunnelStatus:
        ok, hint = self.tooling()
        if not ok:
            return TunnelStatus(oper_state="unknown", detail=hint)
        iface = t.iface
        if not iface:
            return TunnelStatus(oper_state="down")
        rc, out, _ = await run(["ip", "-o", "link", "show", "dev", iface], timeout=10, priv=False)
        if rc != 0:
            return TunnelStatus(oper_state="down", iface=iface)
        flags = out.split("<", 1)[-1].split(">", 1)[0].split(",") if "<" in out else []
        return TunnelStatus(oper_state="up" if "UP" in flags else "down", iface=iface)
