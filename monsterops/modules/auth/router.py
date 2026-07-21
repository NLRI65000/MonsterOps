from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.limiter import limiter
from monsterops.modules.auth import totp
from monsterops.modules.auth.models import AdminRecoveryCode, AdminTotp, AdminUser, AuditLog
from monsterops.modules.auth.schemas import (
    AdminUserCreate,
    AdminUserOut,
    AdminUserUpdate,
    AuditLogOut,
    LoginRequest,
    LoginResponse,
    RecoveryCodesResponse,
    SelfUpdate,
    SessionResponse,
    SetupRequest,
    StatusResponse,
    TotpDisableRequest,
    TotpEnableRequest,
    TotpEnableResponse,
    TotpSetupResponse,
    TotpStatusResponse,
    TotpVerifyRequest,
)
from monsterops.modules.auth.utils import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    audit,
    create_access_token,
    create_pending_token,
    create_refresh_token,
    decode_pending_token,
    decrypt_secret,
    encrypt_secret,
    get_current_user,
    get_user_from_refresh_cookie,
    hash_password,
    require_roles,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_REFRESH_MAX_AGE = 60 * 60 * 24 * 7


def _cookie_secure(request: Request) -> bool:
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    proto = request.headers.get("X-Forwarded-Proto", request.url.scheme).split(",")[0].strip()
    return proto == "https"


def _cookie_kwargs(max_age: int, *, http_only: bool, secure: bool) -> dict:
    return dict(
        httponly=http_only,
        samesite="lax",
        secure=secure,
        max_age=max_age,
        path="/",
    )


def _issue_session(response: Response, user, request: Request) -> None:
    secure = _cookie_secure(request)
    response.set_cookie(
        ACCESS_COOKIE,
        create_access_token(user.id, user.role),
        **_cookie_kwargs(settings.access_token_expire_minutes * 60, http_only=True, secure=secure),
    )
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user.id),
        **_cookie_kwargs(_REFRESH_MAX_AGE, http_only=True, secure=secure),
    )
    response.set_cookie(
        CSRF_COOKIE,
        secrets.token_urlsafe(32),
        **_cookie_kwargs(_REFRESH_MAX_AGE, http_only=False, secure=secure),
    )


def _clear_session(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/")




@router.get("/status", response_model=StatusResponse, summary="Check if first-run setup is needed")
async def auth_status(db: AsyncSession = Depends(get_db)):
    count = await db.scalar(select(func.count()).select_from(AdminUser))
    return StatusResponse(first_run=(count == 0), console_enabled=settings.console_enabled)


@router.post(
    "/setup", response_model=SessionResponse, status_code=201, summary="Create the first superadmin"
)
async def setup(
    body: SetupRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)
):
    count = await db.scalar(select(func.count()).select_from(AdminUser))
    if (count or 0) > 0:
        raise HTTPException(status_code=409, detail="Setup already completed")

    user = AdminUser(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role="superadmin",
        is_active=True,
    )
    db.add(user)
    await db.flush()

    db.add(
        AuditLog(
            admin_id=user.id,
            admin_username=user.username,
            action="admin.setup",
            target=f"admin:{user.id}",
        )
    )
    await db.commit()

    _issue_session(response, user, request)
    return SessionResponse(role=user.role, username=user.username)




@router.post("/login", response_model=LoginResponse, summary="Authenticate and start a session")
@limiter.limit("10/minute")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AdminUser).where(AdminUser.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    totp_row = await _totp_row(db, user.id)
    if totp_row and totp_row.enabled:
        return LoginResponse(
            mfa_required=True,
            username=user.username,
            pending_token=create_pending_token(user.id),
        )

    await audit(db, user_id=user.id, username=user.username, action="admin.login", request=request)
    await db.commit()

    _issue_session(response, user, request)
    setup_required = user.totp_required or settings.require_2fa
    return LoginResponse(role=user.role, username=user.username, mfa_setup_required=setup_required)


@router.post("/refresh", status_code=204, summary="Rotate session cookies using the refresh cookie")
async def refresh(
    request: Request,
    response: Response,
    user: AdminUser = Depends(get_user_from_refresh_cookie),
):
    _issue_session(response, user, request)


@router.post("/logout", status_code=204, summary="Clear the session cookies")
async def logout(response: Response):
    _clear_session(response)




@router.get("/me", response_model=AdminUserOut, summary="Get current admin profile")
async def me(user: AdminUser = Depends(get_current_user)):
    return user


@router.put("/me", response_model=AdminUserOut, summary="Update own email or password")
async def update_me(
    body: SelfUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    changed: list[str] = []
    if body.email is not None:
        user.email = body.email
        changed.append("email")
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
        changed.append("password")

    if changed:
        await audit(
            db,
            user_id=user.id,
            username=user.username,
            action="admin.self_update",
            target=f"admin:{user.id}",
            detail={"changed": changed},
            request=request,
        )
        await db.commit()
        await db.refresh(user)

    return user




async def _totp_row(db: AsyncSession, admin_id: int) -> AdminTotp | None:
    return await db.scalar(select(AdminTotp).where(AdminTotp.admin_id == admin_id))


async def _issue_recovery_codes(db: AsyncSession, admin_id: int) -> list[str]:
    await db.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.admin_id == admin_id))
    codes = totp.generate_recovery_codes()
    for code in codes:
        db.add(AdminRecoveryCode(admin_id=admin_id, code_hash=hash_password(code)))
    return codes


async def _consume_recovery_code(db: AsyncSession, admin_id: int, code: str) -> bool:
    normalized = (code or "").strip().upper()
    if not normalized:
        return False
    rows = (
        (
            await db.execute(
                select(AdminRecoveryCode).where(
                    AdminRecoveryCode.admin_id == admin_id,
                    AdminRecoveryCode.used_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for rc in rows:
        if verify_password(normalized, rc.code_hash):
            rc.used_at = datetime.now(timezone.utc)
            return True
    return False


@router.post("/2fa/setup", response_model=TotpSetupResponse, summary="Begin TOTP enrollment")
async def totp_setup(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    row = await _totp_row(db, user.id)
    if row and row.enabled:
        raise HTTPException(status_code=409, detail="Two-factor is already enabled")

    secret = totp.generate_secret()
    if row:
        row.secret_enc = encrypt_secret(secret)
        row.enabled = False
        row.confirmed_at = None
    else:
        db.add(AdminTotp(admin_id=user.id, secret_enc=encrypt_secret(secret), enabled=False))

    await audit(
        db,
        user_id=user.id,
        username=user.username,
        action="admin.2fa_setup",
        target=f"admin:{user.id}",
        request=request,
    )
    await db.commit()
    return TotpSetupResponse(
        secret=secret, otpauth_uri=totp.provisioning_uri(user.username, secret)
    )


@router.post("/2fa/enable", response_model=TotpEnableResponse, summary="Confirm and enable TOTP")
async def totp_enable(
    body: TotpEnableRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    row = await _totp_row(db, user.id)
    if not row:
        raise HTTPException(status_code=400, detail="Start two-factor setup first")
    if row.enabled:
        raise HTTPException(status_code=409, detail="Two-factor is already enabled")
    if not totp.verify(decrypt_secret(row.secret_enc), body.code):
        raise HTTPException(status_code=400, detail="Incorrect code")

    row.enabled = True
    row.confirmed_at = datetime.now(timezone.utc)
    codes = await _issue_recovery_codes(db, user.id)
    await audit(
        db,
        user_id=user.id,
        username=user.username,
        action="admin.2fa_enabled",
        target=f"admin:{user.id}",
        request=request,
    )
    await db.commit()
    return TotpEnableResponse(enabled=True, recovery_codes=codes)


@router.post("/2fa/disable", response_model=TotpStatusResponse, summary="Disable TOTP")
async def totp_disable(
    body: TotpDisableRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    row = await _totp_row(db, user.id)
    if not row or not row.enabled:
        raise HTTPException(status_code=400, detail="Two-factor is not enabled")
    if user.totp_required or settings.require_2fa:
        raise HTTPException(
            status_code=403,
            detail="Two-factor is required for this account and cannot be turned off",
        )

    verified = bool(body.password and verify_password(body.password, user.hashed_password)) or bool(
        body.code and totp.verify(decrypt_secret(row.secret_enc), body.code)
    )
    if not verified:
        raise HTTPException(status_code=400, detail="Password or code is incorrect")

    await db.delete(row)
    await db.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.admin_id == user.id))
    await audit(
        db,
        user_id=user.id,
        username=user.username,
        action="admin.2fa_disabled",
        target=f"admin:{user.id}",
        request=request,
    )
    await db.commit()
    return TotpStatusResponse(enabled=False, required=user.totp_required or settings.require_2fa)


@router.get("/2fa/status", response_model=TotpStatusResponse, summary="Own two-factor status")
async def totp_status(
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    row = await _totp_row(db, user.id)
    return TotpStatusResponse(
        enabled=bool(row and row.enabled),
        required=user.totp_required or settings.require_2fa,
    )


@router.post("/2fa/verify", response_model=LoginResponse, summary="Complete login with a 2FA code")
@limiter.limit("10/minute")
async def totp_verify(
    body: TotpVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    user_id = decode_pending_token(body.pending_token)
    result = await db.execute(select(AdminUser).where(AdminUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")

    row = await _totp_row(db, user.id)
    if not row or not row.enabled:
        raise HTTPException(status_code=400, detail="Two-factor is not enabled")

    ok = totp.verify(decrypt_secret(row.secret_enc), body.code)
    used_recovery = False
    if not ok:
        ok = await _consume_recovery_code(db, user.id, body.code)
        used_recovery = ok

    if not ok:
        await audit(
            db,
            user_id=user.id,
            username=user.username,
            action="admin.2fa_failed",
            target=f"admin:{user.id}",
            request=request,
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Incorrect code")

    await audit(
        db,
        user_id=user.id,
        username=user.username,
        action="admin.login",
        detail={"recovery_code": True} if used_recovery else None,
        request=request,
    )
    await db.commit()

    _issue_session(response, user, request)
    return LoginResponse(role=user.role, username=user.username)


@router.post(
    "/2fa/recovery-codes",
    response_model=RecoveryCodesResponse,
    summary="Regenerate recovery codes",
)
async def totp_regenerate_recovery_codes(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AdminUser = Depends(get_current_user),
):
    row = await _totp_row(db, user.id)
    if not row or not row.enabled:
        raise HTTPException(status_code=400, detail="Two-factor is not enabled")

    codes = await _issue_recovery_codes(db, user.id)
    await audit(
        db,
        user_id=user.id,
        username=user.username,
        action="admin.2fa_recovery_regenerated",
        target=f"admin:{user.id}",
        request=request,
    )
    await db.commit()
    return RecoveryCodesResponse(recovery_codes=codes)




@router.get("/admins", response_model=list[AdminUserOut], summary="List all admin accounts")
async def list_admins(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(require_roles("superadmin")),
):
    admins = (await db.execute(select(AdminUser).order_by(AdminUser.created_at))).scalars().all()
    enabled_ids = set(
        (await db.execute(select(AdminTotp.admin_id).where(AdminTotp.enabled.is_(True)))).scalars()
    )
    for a in admins:
        a.totp_enabled = a.id in enabled_ids
    return admins


@router.post(
    "/admins", response_model=AdminUserOut, status_code=201, summary="Create an admin account"
)
async def create_admin(
    body: AdminUserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: AdminUser = Depends(require_roles("superadmin")),
):
    existing = await db.scalar(select(AdminUser).where(AdminUser.username == body.username))
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")

    user = AdminUser(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await audit(
        db,
        user_id=actor.id,
        username=actor.username,
        action="admin.create",
        target=f"admin:{user.id}",
        detail={"username": user.username, "role": user.role},
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/admins/{admin_id}", response_model=AdminUserOut, summary="Update an admin account")
async def update_admin(
    admin_id: int,
    body: AdminUserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: AdminUser = Depends(require_roles("superadmin")),
):
    result = await db.execute(select(AdminUser).where(AdminUser.id == admin_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Admin not found")

    changed: list[str] = []
    if body.email is not None:
        user.email = body.email
        changed.append("email")
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
        changed.append("password")
    if body.role is not None:
        user.role = body.role
        changed.append("role")
    if body.is_active is not None:
        user.is_active = body.is_active
        changed.append("is_active")
    if body.totp_required is not None:
        user.totp_required = body.totp_required
        changed.append("totp_required")

    if changed:
        await audit(
            db,
            user_id=actor.id,
            username=actor.username,
            action="admin.update",
            target=f"admin:{user.id}",
            detail={"changed": changed},
            request=request,
        )
        await db.commit()
        await db.refresh(user)

    return user


@router.delete("/admins/{admin_id}", status_code=204, summary="Delete an admin account")
async def delete_admin(
    admin_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: AdminUser = Depends(require_roles("superadmin")),
):
    result = await db.execute(select(AdminUser).where(AdminUser.id == admin_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Admin not found")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    await audit(
        db,
        user_id=actor.id,
        username=actor.username,
        action="admin.delete",
        target=f"admin:{user.id}",
        detail={"username": user.username},
        request=request,
    )
    await db.delete(user)
    await db.commit()


@router.post(
    "/admins/{admin_id}/2fa/reset",
    status_code=204,
    summary="Reset an admin's two-factor (lost device)",
)
async def reset_admin_2fa(
    admin_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: AdminUser = Depends(require_roles("superadmin")),
):
    target = await db.scalar(select(AdminUser).where(AdminUser.id == admin_id))
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    await db.execute(delete(AdminTotp).where(AdminTotp.admin_id == admin_id))
    await db.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.admin_id == admin_id))
    await audit(
        db,
        user_id=actor.id,
        username=actor.username,
        action="admin.2fa_reset",
        target=f"admin:{admin_id}",
        detail={"username": target.username},
        request=request,
    )
    await db.commit()




@router.get("/audit-log", response_model=list[AuditLogOut], summary="View audit log")
async def get_audit_log(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(require_roles("superadmin")),
):
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )
    return result.scalars().all()
