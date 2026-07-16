from __future__ import annotations

import asyncio
import json
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import partial
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _smtp_send(config: dict[str, Any], subject: str, message: str) -> None:
    smtp_host: str = config.get("smtp_host", "")
    smtp_port: int = int(config.get("smtp_port", 587))
    smtp_user: str = config.get("smtp_user", "")
    smtp_password: str = config.get("smtp_password", "")
    use_tls: bool = bool(config.get("use_tls", True))
    from_addr: str = config.get("from_addr", smtp_user)
    to_addrs: list[str] = config.get("to_addrs", [])

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.attach(MIMEText(message, "plain"))

    if use_tls:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            srv.ehlo()
            srv.starttls(context=ctx)
            if smtp_user:
                srv.login(smtp_user, smtp_password)
            srv.sendmail(from_addr, to_addrs, msg.as_string())
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            if smtp_user:
                srv.login(smtp_user, smtp_password)
            srv.sendmail(from_addr, to_addrs, msg.as_string())


async def send_email(config: dict[str, Any], subject: str, message: str) -> tuple[bool, str | None]:
    smtp_host = config.get("smtp_host", "")
    to_addrs = config.get("to_addrs", [])
    if not smtp_host or not to_addrs:
        return False, "Missing smtp_host or to_addrs in channel config"
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, partial(_smtp_send, config, subject, message))
        return True, None
    except Exception as exc:
        return False, str(exc)


async def send_webhook(
    config: dict[str, Any], subject: str, message: str
) -> tuple[bool, str | None]:
    url: str = config.get("url", "")
    if not url:
        return False, "Missing url in channel config"

    method: str = config.get("method", "POST").upper()
    headers: dict[str, str] = dict(config.get("headers", {}))
    body_template: str | None = config.get("body_template")

    if body_template:
        payload = body_template.replace("{{subject}}", subject).replace("{{message}}", message)
    else:
        payload = json.dumps({"subject": subject, "message": message})

    if "Content-Type" not in headers:
        headers["Content-Type"] = "application/json"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(method, url, content=payload.encode(), headers=headers)
        if resp.status_code >= 400:
            return False, f"HTTP {resp.status_code}: {resp.text[:300]}"
        return True, None
    except Exception as exc:
        return False, str(exc)


async def dispatch(
    channel_type: str, config: dict[str, Any], subject: str, message: str
) -> tuple[bool, str | None]:
    if channel_type == "email":
        return await send_email(config, subject, message)
    if channel_type == "webhook":
        return await send_webhook(config, subject, message)
    return False, f"Unknown channel type: {channel_type!r}"
