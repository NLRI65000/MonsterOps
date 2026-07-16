
from __future__ import annotations

import logging
import ssl
import time

import ldap3
from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError

logger = logging.getLogger(__name__)

TIMEOUT_CAP = 30


class LdapBindError(Exception):
    pass


def _capped(timeout: int) -> int:
    return max(1, min(int(timeout), TIMEOUT_CAP))


def _build_server(host: str, port: int, encryption: str, tls_verify: bool, timeout: int):
    use_ssl = encryption == "ldaps"
    tls = None
    if encryption in ("starttls", "ldaps"):
        tls = ldap3.Tls(validate=ssl.CERT_REQUIRED if tls_verify else ssl.CERT_NONE)
    return ldap3.Server(
        host,
        port=int(port),
        use_ssl=use_ssl,
        tls=tls,
        connect_timeout=timeout,
        get_info=ldap3.NONE,
    )


def connect(
    *,
    host: str,
    port: int,
    encryption: str,
    bind_dn: str | None,
    bind_password: str | None,
    tls_verify: bool,
    timeout: int,
) -> ldap3.Connection:
    timeout = _capped(timeout)
    server = _build_server(host, port, encryption, tls_verify, timeout)
    conn = ldap3.Connection(
        server,
        user=bind_dn or None,
        password=bind_password or None,
        authentication=ldap3.SIMPLE if bind_dn else ldap3.ANONYMOUS,
        receive_timeout=timeout,
    )
    conn.open()
    if encryption == "starttls":
        conn.start_tls()
    if not conn.bind():
        res = conn.result or {}
        detail = res.get("description") or res.get("message") or "invalid credentials"
        try:
            conn.unbind()
        except Exception:
            pass
        raise LdapBindError(f"bind rejected: {detail}")
    return conn


def test_bind(
    *,
    host: str,
    port: int,
    encryption: str,
    base_dn: str,
    bind_dn: str | None,
    bind_password: str | None,
    tls_verify: bool,
    timeout: int,
) -> tuple[str, str, float | None]:
    timeout = _capped(timeout)
    t0 = time.monotonic()
    conn = None
    try:
        conn = connect(
            host=host,
            port=port,
            encryption=encryption,
            bind_dn=bind_dn,
            bind_password=bind_password,
            tls_verify=tls_verify,
            timeout=timeout,
        )
        rtt = round((time.monotonic() - t0) * 1000, 1)

        ok = conn.search(
            base_dn,
            "(objectClass=*)",
            search_scope=ldap3.BASE,
            attributes=[],
            size_limit=1,
            time_limit=timeout,
        )
        if not ok:
            res = conn.result or {}
            return (
                "down",
                f"bound OK but base DN unreadable: {res.get('description', 'error')}",
                rtt,
            )
        return "up", "bind and base DN lookup succeeded", rtt

    except LdapBindError as exc:
        return "down", str(exc), None
    except LDAPSocketOpenError as exc:
        msg = str(exc)
        if "time" in msg.lower() and "out" in msg.lower():
            return "timeout", f"connection timed out after {timeout}s", None
        return "down", f"could not connect: {msg}", None
    except LDAPException as exc:
        return "down", f"LDAP error: {exc}", None
    except Exception as exc:
        logger.warning("LDAP bind test raised: %s", exc)
        return "down", f"unexpected error: {exc}", None
    finally:
        try:
            if conn is not None:
                conn.unbind()
        except Exception:
            pass
