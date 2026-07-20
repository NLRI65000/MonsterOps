from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.limiter import limiter
from monsterops.modules.auth.models import AdminUser, AuditLog
from monsterops.modules.auth.schemas import (
    AdminUserCreate,
    AdminUserOut,
    AdminUserUpdate,
    AuditLogOut,
    LoginRequest,
    SelfUpdate,
    SessionResponse,
    SetupRequest,
    StatusResponse,
)
from monsterops.modules.auth.utils import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    audit,
    create_access_token,
    create_refresh_token,
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




@router.post("/login", response_model=SessionResponse, summary="Authenticate and start a session")
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

    await audit(db, user_id=user.id, username=user.username, action="admin.login", request=request)
    await db.commit()

    _issue_session(response, user, request)
    return SessionResponse(role=user.role, username=user.username)


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




@router.get("/admins", response_model=list[AdminUserOut], summary="List all admin accounts")
async def list_admins(
    db: AsyncSession = Depends(get_db),
    _: AdminUser = Depends(require_roles("superadmin")),
):
    result = await db.execute(select(AdminUser).order_by(AdminUser.created_at))
    return result.scalars().all()


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
