
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

logger = logging.getLogger(__name__)

_VALID_ACTIONS = frozenset(
    {
        "log",
        "notify_webhook",
        "disable_user",
        "add_to_group",
        "remove_from_group",
        "send_email",
        "firewall_ban",
        "run_nas_command",
    }
)


def _render_nas_command(command: str, event: "Any") -> str:
    for token, val in (
        ("{type}", event.type),
        ("{actor}", event.actor),
        ("{entity_type}", event.entity_type),
        ("{entity_id}", event.entity_id),
    ):
        command = command.replace(token, str(val or ""))
    for key, val in (event.data or {}).items():
        command = command.replace("{data.%s}" % key, str(val))
    return command


def _condition_match(event: "Any", conditions: list[dict]) -> bool:
    for cond in conditions:
        field = cond.get("field", "")
        op = cond.get("op", "eq")
        value = str(cond.get("value", ""))

        if field == "type":
            actual = event.type
        elif field == "actor":
            actual = event.actor
        elif field == "entity_type":
            actual = event.entity_type
        elif field == "entity_id":
            actual = event.entity_id
        else:
            actual = str(event.data.get(field, ""))

        if op == "eq" and actual != value:
            return False
        if op == "neq" and actual == value:
            return False
        if op == "contains" and value not in actual:
            return False
        if op == "startswith" and not actual.startswith(value):
            return False
        if op == "endswith" and not actual.endswith(value):
            return False
        if op == "regex" and not re.search(value, actual):
            return False

    return True


async def _run_action(action_type: str, config: dict, event: "Any") -> None:
    if action_type == "log":
        logger.info(
            "[Automation] rule matched: event=%s actor=%s entity=%s",
            event.type,
            event.actor,
            event.entity_id,
        )

    elif action_type == "notify_webhook":
        url = config.get("url", "")
        secret = config.get("secret", "")
        if not url:
            logger.warning("[Automation] notify_webhook has no url")
            return
        payload = json.dumps(event.to_dict()).encode()
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if secret:
            sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
            headers["X-MonsterOps-Signature"] = f"sha256={sig}"
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, content=payload, headers=headers)
            if resp.status_code >= 400:
                logger.warning("[Automation] webhook %s returned %d", url, resp.status_code)
        except Exception as exc:
            logger.warning("[Automation] webhook %s failed: %s", url, exc)

    elif action_type == "disable_user":
        username = event.entity_id
        if not username:
            return
        try:
            from sqlalchemy import and_, select

            from monsterops.database import SessionLocal

            async with SessionLocal() as db:
                from monsterops.modules.users.models import RadCheck

                existing = (
                    await db.execute(
                        select(RadCheck).where(
                            and_(
                                RadCheck.username == username,
                                RadCheck.attribute == "Auth-Type",
                                RadCheck.value == "Reject",
                            )
                        )
                    )
                ).scalar_one_or_none()
                if not existing:
                    db.add(
                        RadCheck(username=username, attribute="Auth-Type", op=":=", value="Reject")
                    )
                    await db.commit()
                    logger.info("[Automation] disabled user %s", username)
        except Exception as exc:
            logger.warning("[Automation] disable_user failed for %s: %s", username, exc)

    elif action_type in ("add_to_group", "remove_from_group"):
        username = event.entity_id
        group = config.get("group", "")
        if not username or not group:
            return
        try:
            from sqlalchemy import and_, select
            from sqlalchemy import delete as sql_delete

            from monsterops.database import SessionLocal

            async with SessionLocal() as db:
                from monsterops.modules.users.models import RadUserGroup

                if action_type == "add_to_group":
                    existing = (
                        await db.execute(
                            select(RadUserGroup).where(
                                and_(
                                    RadUserGroup.username == username,
                                    RadUserGroup.groupname == group,
                                )
                            )
                        )
                    ).scalar_one_or_none()
                    if not existing:
                        db.add(RadUserGroup(username=username, groupname=group, priority=1))
                        await db.commit()
                        logger.info("[Automation] added %s to group %s", username, group)
                else:
                    await db.execute(
                        sql_delete(RadUserGroup).where(
                            and_(RadUserGroup.username == username, RadUserGroup.groupname == group)
                        )
                    )
                    await db.commit()
                    logger.info("[Automation] removed %s from group %s", username, group)
        except Exception as exc:
            logger.warning("[Automation] %s failed: %s", action_type, exc)

    elif action_type == "firewall_ban":
        ip = str(event.data.get(config.get("ip_field", "ip"), "")).strip()
        if not ip:
            logger.warning("[Automation] firewall_ban: no IP found on event")
            return
        try:
            from monsterops.database import SessionLocal
            from monsterops.modules.firewall import service as fw_service

            ttl = config.get("ttl_seconds")
            async with SessionLocal() as db:
                await fw_service.add_ban(db, ip, int(ttl) if ttl else None, config.get("set"))
            logger.info("[Automation] firewall_ban: banned %s", ip)
        except Exception as exc:
            logger.warning("[Automation] firewall_ban failed for %s: %s", ip, exc)

    elif action_type == "run_nas_command":
        raw_cmd = str(config.get("command", "")).strip()
        nas_id = config.get("nas_id")
        if not nas_id or not raw_cmd:
            logger.warning("[Automation] run_nas_command: nas_id and command are required")
            return
        try:
            from sqlalchemy import select

            from monsterops.config import settings
            from monsterops.database import SessionLocal
            from monsterops.modules.nas_manager import service as nm_service
            from monsterops.modules.nas_manager.crypto import decrypt
            from monsterops.modules.nas_manager.models import MrNasManager

            async with SessionLocal() as db:
                nm = (
                    await db.execute(select(MrNasManager).where(MrNasManager.nas_id == int(nas_id)))
                ).scalar_one_or_none()
            if nm is None:
                logger.warning("[Automation] run_nas_command: no NAS Manager for nas_id=%s", nas_id)
                return
            if not nm.enabled:
                logger.warning(
                    "[Automation] run_nas_command: NAS Manager for nas_id=%s is disabled", nas_id
                )
                return
            if not nm.secret_enc:
                logger.warning(
                    "[Automation] run_nas_command: no stored credentials for nas_id=%s", nas_id
                )
                return
            password = decrypt(nm.secret_enc, settings.secret_key)
            command = _render_nas_command(raw_cmd, event)
            _output, err = await nm_service.run_command(nm, password, command)
            if err:
                logger.warning("[Automation] run_nas_command on nas_id=%s failed: %s", nas_id, err)
            else:
                logger.info("[Automation] run_nas_command on nas_id=%s ran: %s", nas_id, command)
        except Exception as exc:
            logger.warning("[Automation] run_nas_command failed: %s", exc)

    elif action_type == "send_email":
        to_addr = config.get("to", "")
        if not to_addr:
            return
        from monsterops.config import settings

        if not settings.smtp_host:
            logger.warning("[Automation] send_email: SMTP not configured")
            return
        subject = config.get("subject") or f"MonsterOps: {event.type}"
        body = (
            f"Event: {event.type}\n"
            f"Actor: {event.actor}\n"
            f"Entity: {event.entity_type} / {event.entity_id}\n"
            f"Time: {event.timestamp.isoformat()}\n"
        )
        if event.data:
            body += f"\nDetails:\n{json.dumps(event.data, indent=2)}\n"
        try:
            msg = EmailMessage()
            msg["From"] = settings.smtp_from or settings.smtp_user
            msg["To"] = to_addr
            msg["Subject"] = subject
            msg.set_content(body)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: _send_smtp(msg))
        except Exception as exc:
            logger.warning("[Automation] send_email to %s failed: %s", to_addr, exc)


def _send_smtp(msg: EmailMessage) -> None:
    from monsterops.config import settings

    if settings.smtp_tls:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as s:
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as s:
            s.ehlo()
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)


async def automation_handler(event: "Any") -> None:
    try:
        from sqlalchemy import select

        from monsterops.database import SessionLocal
        from monsterops.modules.automation.models import MrAutomationRule

        async with SessionLocal() as db:
            result = await db.execute(
                select(MrAutomationRule).where(MrAutomationRule.enabled.is_(True))
            )
            rules = result.scalars().all()

        for rule in rules:
            if not event.matches(str(rule.event_pattern)):
                continue
            conditions: list[dict] = rule.conditions or []
            if not _condition_match(event, conditions):
                continue

            action_type = str(rule.action_type)
            config: dict[str, Any] = rule.action_config or {}
            asyncio.create_task(_run_and_record(rule.id, action_type, config, event))

    except Exception as exc:
        logger.warning("[Automation] handler error: %s", exc)


async def _run_and_record(rule_id: int, action_type: str, config: dict, event: "Any") -> None:
    try:
        await _run_action(action_type, config, event)
    except Exception as exc:
        logger.warning("[Automation] action %s (rule %d) failed: %s", action_type, rule_id, exc)
    finally:
        try:
            from sqlalchemy import update

            from monsterops.database import SessionLocal
            from monsterops.modules.automation.models import MrAutomationRule

            async with SessionLocal() as db:
                await db.execute(
                    update(MrAutomationRule)
                    .where(MrAutomationRule.id == rule_id)
                    .values(
                        last_triggered_at=datetime.now(tz=timezone.utc),
                        trigger_count=MrAutomationRule.trigger_count + 1,
                    )
                )
                await db.commit()
        except Exception:
            pass
