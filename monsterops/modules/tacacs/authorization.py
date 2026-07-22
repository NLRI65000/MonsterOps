
from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.modules.tacacs import protocol as p
from monsterops.modules.tacacs.models import MrTacacsCommandRule, MrTacacsUser

logger = logging.getLogger(__name__)

PERMIT = "permit"
DENY = "deny"


async def authorize(db: AsyncSession, user: MrTacacsUser, req: p.AuthorRequest) -> p.AuthorResponse:
    avs = p.parse_av_pairs(req.args)
    values = {attr: val for attr, val, _ in avs}
    service = values.get("service", "")
    cmd = values.get("cmd", "")

    if service == "shell" and not cmd:
        return p.AuthorResponse(
            p.TAC_PLUS_AUTHOR_STATUS_PASS_ADD,
            args=[f"priv-lvl={user.privilege_level}".encode()],
        )

    if cmd:
        cmd_args = [val for attr, val, _ in avs if attr == "cmd-arg"]
        full_command = " ".join([cmd, *cmd_args]).strip()
        permitted = await _command_permitted(db, user, full_command)
        status = (
            p.TAC_PLUS_AUTHOR_STATUS_PASS_ADD if permitted else p.TAC_PLUS_AUTHOR_STATUS_FAIL
        )
        return p.AuthorResponse(status)

    return p.AuthorResponse(p.TAC_PLUS_AUTHOR_STATUS_PASS_ADD)


async def _command_permitted(db: AsyncSession, user: MrTacacsUser, full_command: str) -> bool:
    rules = (
        (
            await db.execute(
                select(MrTacacsCommandRule)
                .where(MrTacacsCommandRule.user_id == user.id)
                .order_by(MrTacacsCommandRule.sort_order, MrTacacsCommandRule.id)
            )
        )
        .scalars()
        .all()
    )
    if not rules:
        return True
    for rule in rules:
        if _rule_matches(rule, full_command):
            return bool(rule.action == PERMIT)
    return False


def _rule_matches(rule: MrTacacsCommandRule, full_command: str) -> bool:
    try:
        return re.match(rule.command, full_command) is not None
    except re.error:
        logger.warning(
            "TACACS+: invalid command-rule regex %r (rule %s) — skipping", rule.command, rule.id
        )
        return False
