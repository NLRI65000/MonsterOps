
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def webhook_handler(event: "Any") -> None:  # noqa: F821 — Event imported at call time
    from sqlalchemy import select

    from monsterops.database import SessionLocal
    from monsterops.modules.webhooks.models import MrWebhookSub

    try:
        async with SessionLocal() as db:
            result = await db.execute(select(MrWebhookSub).where(MrWebhookSub.enabled.is_(True)))
            subs = result.scalars().all()

        matching = [s for s in subs if any(event.matches(p) for p in (s.events or []))]
        if not matching:
            return

        payload = json.dumps(event.to_dict()).encode()

        async def _post(sub: MrWebhookSub) -> None:
            import httpx

            headers: dict[str, str] = {"Content-Type": "application/json"}
            if sub.secret:
                sig = hmac.new(sub.secret.encode(), payload, hashlib.sha256).hexdigest()
                headers["X-MonsterOps-Signature"] = f"sha256={sig}"
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.post(str(sub.url), content=payload, headers=headers)
                if resp.status_code >= 400:
                    logger.warning(
                        "Webhook %r returned %d for %s", sub.url, resp.status_code, event.type
                    )
            except Exception as exc:
                logger.warning("Webhook delivery to %r failed: %s", sub.url, exc)

        await asyncio.gather(*(_post(s) for s in matching), return_exceptions=True)

    except Exception as exc:
        logger.warning("webhook_handler error: %s", exc)


async def graylog_handler(event: "Any") -> None:  # noqa: F821
    from sqlalchemy import select

    from monsterops.database import SessionLocal
    from monsterops.modules.integrations.models import Integration

    if not event.type.startswith("audit."):
        return

    try:
        async with SessionLocal() as db:
            result = await db.execute(
                select(Integration).where(
                    Integration.type == "graylog",
                    Integration.enabled.is_(True),
                )
            )
            integrations = result.scalars().all()

        for integ in integrations:
            cfg: dict = integ.config or {}
            host = cfg.get("host", "127.0.0.1")
            port = int(cfg.get("port", 12201))
            asyncio.create_task(_send_gelf(host, port, event))

    except Exception as exc:
        logger.warning("graylog_handler error: %s", exc)


async def _send_gelf(host: str, port: int, event: "Any") -> None:  # noqa: F821
    import socket

    payload = json.dumps(
        {
            "version": "1.1",
            "host": "monsterops",
            "short_message": f"{event.type}: {event.entity_id}",
            "timestamp": event.timestamp.timestamp(),
            "level": 6,
            "_actor": event.actor,
            "_entity_type": event.entity_type,
            "_entity_id": event.entity_id,
            "_event_type": event.type,
            **{f"_{k}": v for k, v in event.data.items()},
        }
    ).encode()

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(payload, (host, port)),
        )
    except Exception as exc:
        logger.warning("GELF send to %s:%d failed: %s", host, port, exc)


async def sse_handler(event: "Any") -> None:  # noqa: F821
    from monsterops.modules.webhooks.router import push_to_sse

    push_to_sse(event.to_dict())


def register_all() -> None:
    from monsterops.events import register_handler

    register_handler(webhook_handler)
    register_handler(graylog_handler)
    register_handler(sse_handler)
