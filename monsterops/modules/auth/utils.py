from __future__ import annotations

import asyncio
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.modules.nas_manager import crypto as _crypto

_bearer = HTTPBearer(auto_error=False)
_ph = PasswordHasher()

ACCESS_COOKIE = "mr_access"
REFRESH_COOKIE = "mr_refresh"
CSRF_COOKIE = "mr_csrf"

current_request: ContextVar[Request | None] = ContextVar("current_request", default=None)


def client_ip(request: Request) -> str | None:
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None




def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith("$argon2"):
        try:
            return _ph.verify(hashed, plain)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False




def encrypt_secret(plaintext: str) -> str:
    return _crypto.encrypt(plaintext, settings.secret_key)


def decrypt_secret(ciphertext: str) -> str:
    return _crypto.decrypt(ciphertext, settings.secret_key)




def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "role": role, "type": "access", "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def create_refresh_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode(
        {"sub": str(user_id), "type": "refresh", "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def create_pending_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    return jwt.encode(
        {"sub": str(user_id), "type": "mfa_pending", "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def decode_pending_token(token: str) -> int:
    payload = _decode(token)
    if payload.get("type") != "mfa_pending":
        raise HTTPException(status_code=401, detail="Invalid two-factor session")
    return int(payload["sub"])


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")




def _token_from_request(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    cookie_token = request.cookies.get(ACCESS_COOKIE)
    if cookie_token:
        return cookie_token
    if credentials:
        return credentials.credentials
    return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.auth.models import AdminUser

    token = _token_from_request(request, credentials)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = _decode(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")

    result = await db.execute(select(AdminUser).where(AdminUser.id == int(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user


def require_roles(*roles: str):

    async def _dep(user=Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return _dep


async def get_user_from_refresh_cookie(
    refresh_token: str | None = Cookie(default=None, alias="mr_refresh"),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.auth.models import AdminUser

    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    payload = _decode(refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Wrong token type")

    result = await db.execute(select(AdminUser).where(AdminUser.id == int(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user




async def audit(
    db: AsyncSession,
    *,
    user_id: int,
    username: str,
    action: str,
    target: str | None = None,
    detail: dict | None = None,
    request: Request | None = None,
) -> None:
    from monsterops.modules.auth.models import AuditLog

    req = request or current_request.get()

    ip = None
    enriched = dict(detail or {})
    if req is not None:
        ip = client_ip(req)
        enriched.setdefault("method", req.method)
        enriched.setdefault("path", req.url.path)
        ua = req.headers.get("User-Agent")
        if ua:
            enriched.setdefault("user_agent", ua[:200])

    db.add(
        AuditLog(
            admin_id=user_id,
            admin_username=username,
            action=action,
            target=target,
            detail=enriched or None,
            ip_address=ip,
        )
    )
    await db.commit()

    try:
        from monsterops.events import Event, fire

        parts = action.split(".", 1)
        entity_type = parts[0] if len(parts) > 1 else action
        event = Event(
            type=f"audit.{action}",
            actor=username,
            entity_type=entity_type,
            entity_id=target or "",
            data=detail or {},
        )
        asyncio.get_event_loop().create_task(fire(event))
    except Exception:
        pass
