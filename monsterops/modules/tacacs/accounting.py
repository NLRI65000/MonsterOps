
from __future__ import annotations

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.events import Event, fire
from monsterops.modules.tacacs import protocol as p
from monsterops.modules.tacacs.models import MrTacacsAcctRecord, MrTacacsClient

logger = logging.getLogger(__name__)


def _decode(b: bytes) -> str:
    return b.decode("utf-8", "replace")


def _record_type(flags: int) -> str:
    if flags & p.TAC_PLUS_ACCT_FLAG_STOP:
        return "stop"
    if flags & p.TAC_PLUS_ACCT_FLAG_START:
        return "start"
    return "update"


def _int_or_none(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _command_line(avs: list[tuple[str, str, bool]]) -> str:
    cmd = next((val for attr, val, _ in avs if attr == "cmd"), "")
    if not cmd:
        return ""
    cmd_args = [val for attr, val, _ in avs if attr == "cmd-arg"]
    return " ".join([cmd, *cmd_args]).strip()


def _event_type(record_type: str, cmd: str) -> str:
    if cmd:
        return "tacacs.command"
    return {
        "start": "tacacs.session_start",
        "stop": "tacacs.session_stop",
    }.get(record_type, "tacacs.session_update")


async def record_accounting(
    db: AsyncSession, client: MrTacacsClient, req: p.AcctRequest
) -> MrTacacsAcctRecord:
    avs = p.parse_av_pairs(req.args)
    values = {attr: val for attr, val, _ in avs}
    record_type = _record_type(req.flags)
    cmd = _command_line(avs)

    rec = MrTacacsAcctRecord(
        username=_decode(req.user),
        client_id=client.id,
        client_name=client.name,
        record_type=record_type,
        priv_lvl=req.priv_lvl,
        port=_decode(req.port) or None,
        rem_addr=_decode(req.rem_addr) or None,
        service=values.get("service") or None,
        cmd=cmd or None,
        task_id=values.get("task_id") or None,
        elapsed_time=_int_or_none(values.get("elapsed_time", "")),
        args="\n".join(_decode(a) for a in req.args) or None,
    )
    db.add(rec)
    await db.commit()

    event = Event(
        type=_event_type(record_type, cmd),
        actor=rec.username,
        entity_type="tacacs",
        entity_id=rec.username,
        data={
            "client": client.name,
            "record_type": record_type,
            "priv_lvl": req.priv_lvl,
            "service": rec.service,
            "cmd": rec.cmd,
            "port": rec.port,
            "rem_addr": rec.rem_addr,
            "task_id": rec.task_id,
        },
    )
    asyncio.create_task(fire(event))
    return rec
