
from __future__ import annotations

import asyncio
import ipaddress
import logging

from sqlalchemy import select

from monsterops.config import settings
from monsterops.database import SessionLocal
from monsterops.modules.nas_manager import crypto
from monsterops.modules.tacacs import protocol as p
from monsterops.modules.tacacs.accounting import record_accounting
from monsterops.modules.tacacs.auth import verify_credentials
from monsterops.modules.tacacs.authorization import authorize
from monsterops.modules.tacacs.models import MrTacacsClient, MrTacacsUser

logger = logging.getLogger(__name__)

_MAX_BODY = 65535

_active_connections = 0


def _decode(b: bytes) -> str:
    return b.decode("utf-8", "replace")


async def _read_packet(reader: asyncio.StreamReader, secret: bytes) -> tuple[p.Header, bytes]:
    timeout = settings.tacacs_read_timeout
    header_bytes = await asyncio.wait_for(reader.readexactly(p.HEADER_SIZE), timeout)
    header = p.Header.unpack(header_bytes)
    if header.length > _MAX_BODY:
        raise ValueError("TACACS+ body too large")
    body_enc = (
        await asyncio.wait_for(reader.readexactly(header.length), timeout)
        if header.length
        else b""
    )
    return p.parse_packet(header_bytes + body_enc, secret)


def _reply_packet(req: p.Header, secret: bytes, ptype: int, body: bytes) -> bytes:
    hdr = p.Header(req.version, ptype, req.seq_no + 1, 0, req.session_id, 0)
    return p.build_packet(hdr, body, secret)


def _reply(req: p.Header, secret: bytes, reply: p.AuthenReply) -> bytes:
    return _reply_packet(req, secret, p.TAC_PLUS_AUTHEN, reply.pack())


def _authz_passed(status: int) -> bool:
    return status in (p.TAC_PLUS_AUTHOR_STATUS_PASS_ADD, p.TAC_PLUS_AUTHOR_STATUS_PASS_REPL)


async def _lookup_client(peer_ip: str) -> MrTacacsClient | None:
    try:
        ip = ipaddress.ip_address(peer_ip)
    except ValueError:
        return None
    async with SessionLocal() as db:
        rows = (
            (await db.execute(select(MrTacacsClient).where(MrTacacsClient.enabled.is_(True))))
            .scalars()
            .all()
        )
    for c in rows:
        try:
            if ip in ipaddress.ip_network(c.address, strict=False):
                return c
        except ValueError:
            continue
    return None


async def _collect_login(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    secret: bytes,
    header: p.Header,
    start: p.AuthenStart,
) -> tuple[str | None, str | None, p.Header]:
    if start.action != p.TAC_PLUS_AUTHEN_LOGIN:
        writer.write(_reply(header, secret, p.AuthenReply(p.TAC_PLUS_AUTHEN_STATUS_ERROR)))
        await writer.drain()
        return None, None, header

    if start.authen_type == p.TAC_PLUS_AUTHEN_TYPE_PAP:
        return _decode(start.user), _decode(start.data), header

    if start.authen_type == p.TAC_PLUS_AUTHEN_TYPE_ASCII:
        cur = header
        username = start.user
        if not username:
            writer.write(
                _reply(
                    cur,
                    secret,
                    p.AuthenReply(p.TAC_PLUS_AUTHEN_STATUS_GETUSER, server_msg=b"Username: "),
                )
            )
            await writer.drain()
            cur, body = await _read_packet(reader, secret)
            cont = p.AuthenContinue.unpack(body)
            if cont.flags & p.TAC_PLUS_CONTINUE_FLAG_ABORT:
                return None, None, cur
            username = cont.user_msg

        writer.write(
            _reply(
                cur,
                secret,
                p.AuthenReply(
                    p.TAC_PLUS_AUTHEN_STATUS_GETPASS,
                    flags=p.TAC_PLUS_REPLY_FLAG_NOECHO,
                    server_msg=b"Password: ",
                ),
            )
        )
        await writer.drain()
        cur, body = await _read_packet(reader, secret)
        cont = p.AuthenContinue.unpack(body)
        if cont.flags & p.TAC_PLUS_CONTINUE_FLAG_ABORT:
            return None, None, cur
        return _decode(username), _decode(cont.user_msg), cur

    writer.write(_reply(header, secret, p.AuthenReply(p.TAC_PLUS_AUTHEN_STATUS_ERROR)))
    await writer.drain()
    return None, None, header


async def _handle_authen(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    secret: bytes,
    header: p.Header,
    body: bytes,
    peer_ip: str,
) -> None:
    start = p.AuthenStart.unpack(body)
    username, password, last = await _collect_login(reader, writer, secret, header, start)
    if username is None or password is None:
        return
    async with SessionLocal() as db:
        user = await verify_credentials(db, username, password)
    status = p.TAC_PLUS_AUTHEN_STATUS_PASS if user else p.TAC_PLUS_AUTHEN_STATUS_FAIL
    writer.write(_reply(last, secret, p.AuthenReply(status)))
    await writer.drain()
    logger.info("TACACS+ auth %s for %r from %s", "PASS" if user else "FAIL", username, peer_ip)


async def _handle_author(
    writer: asyncio.StreamWriter,
    secret: bytes,
    header: p.Header,
    body: bytes,
    peer_ip: str,
) -> None:
    req = p.AuthorRequest.unpack(body)
    username = _decode(req.user)
    async with SessionLocal() as db:
        user = await db.scalar(select(MrTacacsUser).where(MrTacacsUser.username == username))
        if user is None or not user.enabled:
            resp = p.AuthorResponse(p.TAC_PLUS_AUTHOR_STATUS_FAIL)
        else:
            resp = await authorize(db, user, req)
    writer.write(_reply_packet(header, secret, p.TAC_PLUS_AUTHOR, resp.pack()))
    await writer.drain()
    logger.info(
        "TACACS+ author %s for %r from %s",
        "PASS" if _authz_passed(resp.status) else "FAIL",
        username,
        peer_ip,
    )


async def _handle_acct(
    writer: asyncio.StreamWriter,
    secret: bytes,
    header: p.Header,
    body: bytes,
    client: MrTacacsClient,
    peer_ip: str,
) -> None:
    req = p.AcctRequest.unpack(body)
    try:
        async with SessionLocal() as db:
            rec = await record_accounting(db, client, req)
        status = p.TAC_PLUS_ACCT_STATUS_SUCCESS
        logger.info(
            "TACACS+ acct %s %r%s from %s",
            rec.record_type,
            rec.username,
            f" cmd={rec.cmd!r}" if rec.cmd else "",
            peer_ip,
        )
    except Exception:
        logger.exception("TACACS+: failed to record accounting from %s", peer_ip)
        status = p.TAC_PLUS_ACCT_STATUS_ERROR
    writer.write(_reply_packet(header, secret, p.TAC_PLUS_ACCT, p.AcctReply(status).pack()))
    await writer.drain()


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    global _active_connections
    peer = writer.get_extra_info("peername")
    peer_ip = peer[0] if peer else ""

    if _active_connections >= settings.tacacs_max_connections:
        logger.warning(
            "TACACS+: at connection cap (%d) — refusing %s",
            settings.tacacs_max_connections,
            peer_ip,
        )
        try:
            writer.close()
        except Exception:
            pass
        return
    _active_connections += 1

    try:
        client = await _lookup_client(peer_ip)
        if client is None:
            logger.warning("TACACS+: connection from unknown client %s — closing", peer_ip)
            return
        secret = crypto.decrypt(client.secret_enc, settings.secret_key).encode()

        header, body = await _read_packet(reader, secret)
        if header.type == p.TAC_PLUS_AUTHEN:
            await _handle_authen(reader, writer, secret, header, body, peer_ip)
        elif header.type == p.TAC_PLUS_AUTHOR:
            await _handle_author(writer, secret, header, body, peer_ip)
        elif header.type == p.TAC_PLUS_ACCT:
            await _handle_acct(writer, secret, header, body, client, peer_ip)
    except asyncio.IncompleteReadError:
        pass
    except asyncio.TimeoutError:
        logger.debug("TACACS+: read timed out for %s — closing", peer_ip)
    except Exception:
        logger.exception("TACACS+: error handling connection from %s", peer_ip)
    finally:
        _active_connections -= 1
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def create_server(host: str, port: int) -> asyncio.Server:
    return await asyncio.start_server(_handle, host, port)


async def run_tacacs_server() -> None:
    server = await create_server(settings.tacacs_host, settings.tacacs_port)
    addrs = ", ".join(str(s.getsockname()) for s in (server.sockets or ()))
    logger.info("TACACS+ server listening on %s", addrs)
    try:
        async with server:
            await server.serve_forever()
    except asyncio.CancelledError:
        logger.info("TACACS+ server stopping")
        raise
