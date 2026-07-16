from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.geo import lookup_calling_station as geo_lookup_cs
from monsterops.modules.accounting.models import Radacct
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.auth_logs.models import Radpostauth
from monsterops.modules.auth_logs.schemas import GeoInfo

from .models import MrBulkJob, Radcheck, Radreply, Radusergroup
from .schemas import (
    AttributeCreate,
    AttributeUpdate,
    AuthHistoryOut,
    BulkGroupAssign,
    BulkUsernameList,
    GroupAssign,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportPreviewResponse,
    ImportPreviewRow,
    RadcheckRow,
    RadreplyRow,
    RadusergroupRow,
    SessionOut,
    TimelineEvent,
    UserCreate,
    UserDetail,
    UserListItem,
    UserListResponse,
    UserUpdate,
)

router = APIRouter(prefix="/api/users", tags=["users"])

_DISABLED_ATTR = "Auth-Type"
_DISABLED_VALUE = "Reject"
_DISABLED_OP = ":="
_PWD_ATTRS = frozenset(
    {
        "Cleartext-Password",
        "MD5-Password",
        "NT-Password",
        "SHA-Password",
        "Crypt-Password",
    }
)
_SPECIAL_ATTRS = frozenset({_DISABLED_ATTR, "Expiration", "Simultaneous-Use"})


async def _exists_or_404(username: str, db: AsyncSession) -> str:
    for table in (Radcheck, Radusergroup):
        q = await db.execute(
            select(func.count()).select_from(table).where(table.username == username)
        )
        if q.scalar_one():
            return username
    raise HTTPException(404, f"User '{username}' not found")


async def _purge_ad_provenance(db: AsyncSession, usernames: list[str]) -> None:
    if not usernames:
        return
    from monsterops.modules.realms.models import MrAuthSyncedUser

    await db.execute(delete(MrAuthSyncedUser).where(MrAuthSyncedUser.username.in_(usernames)))


async def _ad_sources(db: AsyncSession, usernames: list[str]) -> dict[str, str]:
    if not usernames:
        return {}
    from monsterops.modules.realms.models import MrAuthDomain, MrAuthSyncedUser

    rows = (
        await db.execute(
            select(MrAuthSyncedUser.username, MrAuthDomain.name)
            .join(MrAuthDomain, MrAuthDomain.id == MrAuthSyncedUser.auth_domain_id)
            .where(MrAuthSyncedUser.username.in_(usernames))
        )
    ).all()
    return {r[0]: r[1] for r in rows}




@router.get("", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    base = select(Radcheck.username).distinct()
    if search:
        base = base.where(Radcheck.username.ilike(f"%{search}%"))

    total_q = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_q.scalar_one() or 0

    username_order = Radcheck.username.desc() if order == "desc" else Radcheck.username.asc()
    rows_q = await db.execute(base.order_by(username_order).limit(size).offset((page - 1) * size))
    usernames = [r[0] for r in rows_q.all()]

    if not usernames:
        return UserListResponse(total=total, page=page, size=size, items=[])

    grp_q = await db.execute(
        select(Radusergroup.username, Radusergroup.groupname)
        .where(Radusergroup.username.in_(usernames))
        .order_by(Radusergroup.priority)
    )
    groups_map: dict[str, list[str]] = {}
    for row in grp_q.all():
        groups_map.setdefault(row.username, []).append(row.groupname)

    attrs_q = await db.execute(
        select(Radcheck.username, Radcheck.attribute, Radcheck.value).where(
            and_(
                Radcheck.username.in_(usernames),
                Radcheck.attribute.in_(_SPECIAL_ATTRS),
            )
        )
    )
    attrs_map: dict[str, dict[str, str]] = {}
    for row in attrs_q.all():
        attrs_map.setdefault(row.username, {})[row.attribute] = row.value

    ad_map = await _ad_sources(db, usernames)

    items = []
    for u in usernames:
        ua = attrs_map.get(u, {})
        sim_raw = ua.get("Simultaneous-Use")
        realm = ad_map.get(u)
        items.append(
            UserListItem(
                username=u,
                disabled=ua.get(_DISABLED_ATTR) == _DISABLED_VALUE,
                groups=groups_map.get(u, []),
                expiration=ua.get("Expiration"),
                simultaneous_use=int(sim_raw) if sim_raw else None,
                source="directory" if realm else "local",
                source_realm=realm,
            )
        )

    return UserListResponse(total=total, page=page, size=size, items=items)




@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(func.count()).select_from(Radcheck).where(Radcheck.username == body.username)
    )
    if q.scalar_one():
        raise HTTPException(409, f"User '{body.username}' already exists")

    db.add(
        Radcheck(username=body.username, attribute=body.password_type, op=":=", value=body.password)
    )

    if body.expiration:
        db.add(
            Radcheck(username=body.username, attribute="Expiration", op=":=", value=body.expiration)
        )

    if body.simultaneous_use is not None and body.simultaneous_use > 0:
        db.add(
            Radcheck(
                username=body.username,
                attribute="Simultaneous-Use",
                op=":=",
                value=str(body.simultaneous_use),
            )
        )

    for i, g in enumerate(body.groups):
        if g.strip():
            db.add(Radusergroup(username=body.username, groupname=g.strip(), priority=i))

    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.create",
        target=body.username,
        detail={"password_type": body.password_type, "groups": body.groups},
        request=request,
    )
    return {"username": body.username}




@router.post("/bulk/enable")
async def bulk_enable(
    body: BulkUsernameList,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if not body.usernames:
        raise HTTPException(400, "No usernames provided")
    await db.execute(
        delete(Radcheck).where(
            and_(
                Radcheck.username.in_(body.usernames),
                Radcheck.attribute == _DISABLED_ATTR,
                Radcheck.value == _DISABLED_VALUE,
            )
        )
    )
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.bulk_enable",
        target=f"{len(body.usernames)} users",
        detail={"usernames": body.usernames},
        request=request,
    )
    return {"ok": len(body.usernames)}


@router.post("/bulk/disable")
async def bulk_disable(
    body: BulkUsernameList,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if not body.usernames:
        raise HTTPException(400, "No usernames provided")
    await db.execute(
        delete(Radcheck).where(
            and_(
                Radcheck.username.in_(body.usernames),
                Radcheck.attribute == _DISABLED_ATTR,
            )
        )
    )
    for username in body.usernames:
        db.add(
            Radcheck(
                username=username, attribute=_DISABLED_ATTR, op=_DISABLED_OP, value=_DISABLED_VALUE
            )
        )
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.bulk_disable",
        target=f"{len(body.usernames)} users",
        detail={"usernames": body.usernames},
        request=request,
    )
    return {"ok": len(body.usernames)}


@router.post("/bulk/delete")
async def bulk_delete(
    body: BulkUsernameList,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if not body.usernames:
        raise HTTPException(400, "No usernames provided")
    for table in (Radcheck, Radreply, Radusergroup):
        await db.execute(delete(table).where(table.username.in_(body.usernames)))
    await _purge_ad_provenance(db, body.usernames)
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.bulk_delete",
        target=f"{len(body.usernames)} users",
        detail={"usernames": body.usernames},
        request=request,
    )
    return {"ok": len(body.usernames)}


@router.post("/bulk/assign-group")
async def bulk_assign_group(
    body: BulkGroupAssign,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if not body.usernames or not body.group:
        raise HTTPException(400, "usernames and group required")
    existing_q = await db.execute(
        select(Radusergroup.username).where(
            and_(
                Radusergroup.username.in_(body.usernames),
                Radusergroup.groupname == body.group,
            )
        )
    )
    already = {r[0] for r in existing_q.all()}
    added = 0
    for username in body.usernames:
        if username not in already:
            db.add(Radusergroup(username=username, groupname=body.group, priority=0))
            added += 1
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.bulk_assign_group",
        target=body.group,
        detail={"usernames": body.usernames, "added": added},
        request=request,
    )
    return {"ok": added}




@router.get("/export")
async def export_users_csv(
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _current=Depends(require_roles("admin", "superadmin")),
):
    base = select(Radcheck.username).distinct()
    if search:
        base = base.where(Radcheck.username.ilike(f"%{search}%"))
    rows_q = await db.execute(base.order_by(Radcheck.username))
    usernames = [r[0] for r in rows_q.all()]

    groups_map: dict[str, list[str]] = {}
    attrs_map: dict[str, dict[str, str]] = {}
    pwd_map: dict[str, str] = {}

    if usernames:
        grp_q = await db.execute(
            select(Radusergroup.username, Radusergroup.groupname)
            .where(Radusergroup.username.in_(usernames))
            .order_by(Radusergroup.priority)
        )
        for row in grp_q.all():
            groups_map.setdefault(row.username, []).append(row.groupname)

        attrs_q = await db.execute(
            select(Radcheck.username, Radcheck.attribute, Radcheck.value).where(
                and_(
                    Radcheck.username.in_(usernames),
                    Radcheck.attribute.in_(_SPECIAL_ATTRS | {_DISABLED_ATTR}),
                )
            )
        )
        for row in attrs_q.all():
            attrs_map.setdefault(row.username, {})[row.attribute] = row.value

        pwd_q = await db.execute(
            select(Radcheck.username, Radcheck.attribute).where(
                and_(
                    Radcheck.username.in_(usernames),
                    Radcheck.attribute.in_(_PWD_ATTRS),
                )
            )
        )
        for row in pwd_q.all():
            pwd_map[row.username] = row.attribute

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["username", "password_type", "groups", "expiration", "simultaneous_use", "disabled"]
    )
    for u in usernames:
        ua = attrs_map.get(u, {})
        writer.writerow(
            [
                u,
                pwd_map.get(u, "Cleartext-Password"),
                ";".join(groups_map.get(u, [])),
                ua.get("Expiration", ""),
                ua.get("Simultaneous-Use", ""),
                "true" if ua.get(_DISABLED_ATTR) == _DISABLED_VALUE else "false",
            ]
        )

    content = output.getvalue()
    db.add(
        MrBulkJob(
            job_type="export",
            created_by=_current.username,
            row_total=len(usernames),
            row_ok=len(usernames),
            detail={"search": search, "count": len(usernames)},
        )
    )
    await db.commit()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users.csv"},
    )



_VALID_PWD_TYPES = frozenset(
    {"Cleartext-Password", "MD5-Password", "NT-Password", "SHA-Password", "Crypt-Password"}
)


@router.post("/import/preview", response_model=ImportPreviewResponse)
async def import_users_preview(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _current=Depends(require_roles("admin", "superadmin")),
):
    _MAX_CSV_BYTES = 32 * 1024 * 1024
    content = await file.read(_MAX_CSV_BYTES + 1)
    if len(content) > _MAX_CSV_BYTES:
        raise HTTPException(413, "CSV exceeds the 32 MB limit")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows_out: list[ImportPreviewRow] = []
    error_count = 0

    for i, row in enumerate(reader, start=2):
        username = (row.get("username") or "").strip()
        password = (row.get("password") or "").strip()

        if not username:
            rows_out.append(
                ImportPreviewRow(row=i, username="", status="error", error="username is required")
            )
            error_count += 1
            continue
        if not password:
            rows_out.append(
                ImportPreviewRow(
                    row=i, username=username, status="error", error="password is required"
                )
            )
            error_count += 1
            continue

        pwd_type = (row.get("password_type") or "Cleartext-Password").strip()
        if pwd_type not in _VALID_PWD_TYPES:
            rows_out.append(
                ImportPreviewRow(
                    row=i,
                    username=username,
                    password=password,
                    status="error",
                    error=f"unknown password_type '{pwd_type}'",
                )
            )
            error_count += 1
            continue

        groups_str = (row.get("groups") or "").strip()
        groups = [g.strip() for g in groups_str.split(";") if g.strip()]
        expiration = (row.get("expiration") or "").strip() or None
        sim_raw = (row.get("simultaneous_use") or "").strip()
        simultaneous_use: int | None = None
        if sim_raw:
            try:
                simultaneous_use = int(sim_raw)
            except ValueError:
                rows_out.append(
                    ImportPreviewRow(
                        row=i,
                        username=username,
                        password=password,
                        status="error",
                        error="simultaneous_use must be an integer",
                    )
                )
                error_count += 1
                continue

        rows_out.append(
            ImportPreviewRow(
                row=i,
                username=username,
                password=password,
                password_type=pwd_type,
                groups=groups,
                expiration=expiration,
                simultaneous_use=simultaneous_use,
                status="pending",
            )
        )

    pending = [r.username for r in rows_out if r.status == "pending"]
    existing: set[str] = set()
    if pending:
        eq = await db.execute(
            select(Radcheck.username).distinct().where(Radcheck.username.in_(pending))
        )
        existing = {r[0] for r in eq.all()}

    new_count = 0
    exists_count = 0
    for r in rows_out:
        if r.status == "pending":
            if r.username in existing:
                r.status = "exists"
                exists_count += 1
            else:
                r.status = "ok"
                new_count += 1

    return ImportPreviewResponse(
        rows=rows_out, new_count=new_count, exists_count=exists_count, error_count=error_count
    )


@router.post("/import/commit", response_model=ImportCommitResponse)
async def import_users_commit(
    body: ImportCommitRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    if not body.rows:
        return ImportCommitResponse(created=0, skipped=0, errors=[])

    usernames = [r.username for r in body.rows]
    eq = await db.execute(
        select(Radcheck.username).distinct().where(Radcheck.username.in_(usernames))
    )
    existing = {r[0] for r in eq.all()}

    created = 0
    skipped = 0
    errors: list[dict] = []

    for row in body.rows:
        if row.username in existing:
            if body.skip_existing:
                skipped += 1
                continue
            errors.append({"username": row.username, "error": "already exists"})
            continue

        db.add(
            Radcheck(
                username=row.username, attribute=row.password_type, op=":=", value=row.password
            )
        )
        if row.expiration:
            db.add(
                Radcheck(
                    username=row.username, attribute="Expiration", op=":=", value=row.expiration
                )
            )
        if row.simultaneous_use:
            db.add(
                Radcheck(
                    username=row.username,
                    attribute="Simultaneous-Use",
                    op=":=",
                    value=str(row.simultaneous_use),
                )
            )
        for idx, g in enumerate(row.groups):
            if g.strip():
                db.add(Radusergroup(username=row.username, groupname=g.strip(), priority=idx))
        created += 1

    if created:
        try:
            await db.commit()
        except Exception as exc:
            await db.rollback()
            return ImportCommitResponse(
                created=0, skipped=skipped, errors=[{"username": "batch", "error": str(exc)}]
            )
        await audit(
            db,
            user_id=current.id,
            username=current.username,
            action="user.import",
            target=f"{created} users",
            detail={"created": created, "skipped": skipped},
            request=request,
        )
        db.add(
            MrBulkJob(
                job_type="import",
                created_by=current.username,
                row_total=len(body.rows),
                row_ok=created,
                row_skipped=skipped,
                row_error=len(errors),
                detail={"errors": errors[:50]} if errors else None,
            )
        )
        await db.commit()

    return ImportCommitResponse(created=created, skipped=skipped, errors=errors)




@router.get("/bulk-jobs")
async def list_bulk_jobs(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("admin", "superadmin")),
):
    total = await db.scalar(select(func.count()).select_from(MrBulkJob)) or 0
    rows = (
        (
            await db.execute(
                select(MrBulkJob)
                .order_by(MrBulkJob.created_at.desc())
                .limit(size)
                .offset((page - 1) * size)
            )
        )
        .scalars()
        .all()
    )
    return {
        "total": total,
        "page": page,
        "size": size,
        "items": [
            {
                "id": r.id,
                "job_type": r.job_type,
                "created_by": r.created_by,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "row_total": r.row_total,
                "row_ok": r.row_ok,
                "row_skipped": r.row_skipped,
                "row_error": r.row_error,
                "detail": r.detail,
            }
            for r in rows
        ],
    }




@router.get("/{username}", response_model=UserDetail)
async def get_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _exists_or_404(username, db)

    check_q = await db.execute(
        select(Radcheck).where(Radcheck.username == username).order_by(Radcheck.id)
    )
    check_rows = check_q.scalars().all()

    reply_q = await db.execute(
        select(Radreply).where(Radreply.username == username).order_by(Radreply.id)
    )
    reply_rows = reply_q.scalars().all()

    grp_q = await db.execute(
        select(Radusergroup)
        .where(Radusergroup.username == username)
        .order_by(Radusergroup.priority)
    )
    grp_rows = grp_q.scalars().all()

    disabled = any(r.attribute == _DISABLED_ATTR and r.value == _DISABLED_VALUE for r in check_rows)

    realm = (await _ad_sources(db, [username])).get(username)

    return UserDetail(
        username=username,
        disabled=disabled,
        groups=[RadusergroupRow.model_validate(r) for r in grp_rows],
        check_attrs=[RadcheckRow.model_validate(r) for r in check_rows],
        reply_attrs=[RadreplyRow.model_validate(r) for r in reply_rows],
        source="directory" if realm else "local",
        source_realm=realm,
    )




@router.put("/{username}")
async def update_user(
    username: str,
    body: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    changed: dict = {}

    if body.password is not None:
        pwd_type = body.password_type or "Cleartext-Password"
        await db.execute(
            delete(Radcheck).where(
                and_(
                    Radcheck.username == username,
                    Radcheck.attribute.in_(_PWD_ATTRS),
                )
            )
        )
        db.add(Radcheck(username=username, attribute=pwd_type, op=":=", value=body.password))
        changed["password"] = pwd_type

    if body.expiration is not None:
        await db.execute(
            delete(Radcheck).where(
                and_(Radcheck.username == username, Radcheck.attribute == "Expiration")
            )
        )
        if body.expiration:
            db.add(
                Radcheck(username=username, attribute="Expiration", op=":=", value=body.expiration)
            )
        changed["expiration"] = body.expiration or None

    if body.simultaneous_use is not None:
        await db.execute(
            delete(Radcheck).where(
                and_(Radcheck.username == username, Radcheck.attribute == "Simultaneous-Use")
            )
        )
        if body.simultaneous_use > 0:
            db.add(
                Radcheck(
                    username=username,
                    attribute="Simultaneous-Use",
                    op=":=",
                    value=str(body.simultaneous_use),
                )
            )
        changed["simultaneous_use"] = body.simultaneous_use or None

    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.update",
        target=username,
        detail=changed,
        request=request,
    )
    return {"ok": True}




@router.delete("/{username}", status_code=204)
async def delete_user(
    username: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    await db.execute(delete(Radcheck).where(Radcheck.username == username))
    await db.execute(delete(Radreply).where(Radreply.username == username))
    await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
    await _purge_ad_provenance(db, [username])
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.delete",
        target=username,
        detail={},
        request=request,
    )




@router.post("/{username}/disable")
async def disable_user(
    username: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    await db.execute(
        delete(Radcheck).where(
            and_(Radcheck.username == username, Radcheck.attribute == _DISABLED_ATTR)
        )
    )
    db.add(
        Radcheck(
            username=username, attribute=_DISABLED_ATTR, op=_DISABLED_OP, value=_DISABLED_VALUE
        )
    )
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.disable",
        target=username,
        detail={},
        request=request,
    )
    return {"ok": True}


@router.post("/{username}/enable")
async def enable_user(
    username: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    await db.execute(
        delete(Radcheck).where(
            and_(
                Radcheck.username == username,
                Radcheck.attribute == _DISABLED_ATTR,
                Radcheck.value == _DISABLED_VALUE,
            )
        )
    )
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.enable",
        target=username,
        detail={},
        request=request,
    )
    return {"ok": True}




@router.post("/{username}/check", status_code=201, response_model=RadcheckRow)
async def add_check_attr(
    username: str,
    body: AttributeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    row = Radcheck(username=username, attribute=body.attribute, op=body.op, value=body.value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RadcheckRow.model_validate(row)


@router.put("/{username}/check/{attr_id}", response_model=RadcheckRow)
async def update_check_attr(
    username: str,
    attr_id: int,
    body: AttributeUpdate,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radcheck).where(and_(Radcheck.id == attr_id, Radcheck.username == username))
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    if body.op is not None:
        row.op = body.op
    if body.value is not None:
        row.value = body.value
    await db.commit()
    await db.refresh(row)
    return RadcheckRow.model_validate(row)


@router.delete("/{username}/check/{attr_id}", status_code=204)
async def delete_check_attr(
    username: str,
    attr_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radcheck).where(and_(Radcheck.id == attr_id, Radcheck.username == username))
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    await db.delete(row)
    await db.commit()




@router.post("/{username}/reply", status_code=201, response_model=RadreplyRow)
async def add_reply_attr(
    username: str,
    body: AttributeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    row = Radreply(username=username, attribute=body.attribute, op=body.op, value=body.value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RadreplyRow.model_validate(row)


@router.put("/{username}/reply/{attr_id}", response_model=RadreplyRow)
async def update_reply_attr(
    username: str,
    attr_id: int,
    body: AttributeUpdate,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radreply).where(and_(Radreply.id == attr_id, Radreply.username == username))
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    if body.op is not None:
        row.op = body.op
    if body.value is not None:
        row.value = body.value
    await db.commit()
    await db.refresh(row)
    return RadreplyRow.model_validate(row)


@router.delete("/{username}/reply/{attr_id}", status_code=204)
async def delete_reply_attr(
    username: str,
    attr_id: int,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    q = await db.execute(
        select(Radreply).where(and_(Radreply.id == attr_id, Radreply.username == username))
    )
    row = q.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Attribute not found")
    await db.delete(row)
    await db.commit()




@router.put("/{username}/groups")
async def set_groups(
    username: str,
    body: GroupAssign,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("admin", "superadmin")),
):
    await _exists_or_404(username, db)
    await db.execute(delete(Radusergroup).where(Radusergroup.username == username))
    for i, g in enumerate(body.groups):
        if g.strip():
            db.add(Radusergroup(username=username, groupname=g.strip(), priority=i))
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="user.groups.set",
        target=username,
        detail={"groups": body.groups},
        request=request,
    )
    return {"ok": True}




def _geo(calling_station_id: object) -> GeoInfo | None:
    raw = geo_lookup_cs(str(calling_station_id) if calling_station_id else None)
    return GeoInfo(**raw) if raw else None


@router.get("/{username}/sessions", response_model=list[SessionOut])
async def get_sessions(
    username: str,
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = select(Radacct).where(Radacct.username == username)
    if active_only:
        q = q.where(Radacct.acctstoptime.is_(None))
    q = q.order_by(Radacct.acctstarttime.desc()).limit(100)
    result = await db.execute(q)
    sessions = result.scalars().all()

    auth_events: list[Radpostauth] = []
    if sessions:
        t_min = min((s.acctstarttime for s in sessions if s.acctstarttime), default=None)
        t_max = max((s.acctstarttime for s in sessions if s.acctstarttime), default=None)
        if t_min and t_max:
            aq = await db.execute(
                select(Radpostauth).where(
                    and_(
                        Radpostauth.username == username,
                        Radpostauth.authdate >= t_min - timedelta(seconds=120),
                        Radpostauth.authdate <= t_max + timedelta(seconds=120),
                    )
                )
            )
            auth_events = aq.scalars().all()

    out = []
    for s in sessions:
        obj = SessionOut.model_validate(s)
        obj.geo_client = _geo(s.callingstationid)
        if s.acctstarttime:
            best_id: int | None = None
            best_reply: str | None = None
            best_diff: float = 61.0
            for ae in auth_events:
                if not ae.authdate:
                    continue
                diff = abs((ae.authdate - s.acctstarttime).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best_id = ae.id
                    best_reply = ae.reply
            obj.auth_log_id = best_id
            obj.auth_outcome = best_reply
        out.append(obj)
    return out


@router.get("/{username}/auth-history", response_model=list[AuthHistoryOut])
async def get_auth_history(
    username: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    auth_q = await db.execute(
        select(Radpostauth)
        .where(Radpostauth.username == username)
        .order_by(Radpostauth.authdate.desc())
        .limit(100)
    )
    auth_rows = auth_q.scalars().all()

    sessions: list[Radacct] = []
    if auth_rows:
        t_min = min((r.authdate for r in auth_rows if r.authdate), default=None)
        t_max = max((r.authdate for r in auth_rows if r.authdate), default=None)
        if t_min and t_max:
            sq = await db.execute(
                select(Radacct).where(
                    and_(
                        Radacct.username == username,
                        Radacct.acctstarttime >= t_min - timedelta(seconds=120),
                        Radacct.acctstarttime <= t_max + timedelta(seconds=120),
                    )
                )
            )
            sessions = sq.scalars().all()

    out = []
    for r in auth_rows:
        obj = AuthHistoryOut.model_validate(r)
        obj.geo_client = _geo(r.callingstationid)
        if r.authdate:
            best_sess_id: int | None = None
            best_diff: float = 61.0
            for s in sessions:
                if not s.acctstarttime:
                    continue
                diff = abs((s.acctstarttime - r.authdate).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best_sess_id = s.radacctid
            obj.linked_session_id = best_sess_id
        out.append(obj)
    return out


@router.get("/{username}/timeline", response_model=list[TimelineEvent])
async def get_user_timeline(
    username: str,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    await _exists_or_404(username, db)

    auth_q = await db.execute(
        select(Radpostauth)
        .where(Radpostauth.username == username)
        .order_by(Radpostauth.authdate.desc())
        .limit(limit)
    )
    auth_rows = auth_q.scalars().all()

    sess_q = await db.execute(
        select(Radacct)
        .where(Radacct.username == username)
        .order_by(Radacct.acctstarttime.desc())
        .limit(limit)
    )
    sess_rows = sess_q.scalars().all()

    events: list[TimelineEvent] = []

    for s in sess_rows:
        nas_ip = str(s.nasipaddress).split("/")[0] if s.nasipaddress else None
        ev = TimelineEvent(
            type="session",
            timestamp=s.acctstarttime or s.acctupdatetime or s.acctstoptime,  # type: ignore[arg-type]
            session_id=s.radacctid,
            acctstarttime=s.acctstarttime,
            acctstoptime=s.acctstoptime,
            acctsessiontime=s.acctsessiontime,
            acctinputoctets=s.acctinputoctets,
            acctoutputoctets=s.acctoutputoctets,
            acctterminatecause=s.acctterminatecause,
            framedipaddress=str(s.framedipaddress).split("/")[0] if s.framedipaddress else None,
            nasipaddress=nas_ip,
            callingstationid=s.callingstationid,
            calledstationid=s.calledstationid,
            geo_client=_geo(s.callingstationid),
        )
        if s.acctstarttime:
            best_id = None
            best_reply = None
            best_diff: float = 61.0
            for ae in auth_rows:
                if not ae.authdate:
                    continue
                diff = abs((ae.authdate - s.acctstarttime).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best_id = ae.id
                    best_reply = ae.reply
            ev.auth_log_ref = best_id
            ev.auth_outcome = best_reply
        events.append(ev)

    for ae in auth_rows:
        if not ae.authdate:
            continue
        events.append(
            TimelineEvent(
                type="auth",
                timestamp=ae.authdate,
                auth_log_id=ae.id,
                reply=ae.reply,
                authmethod=ae.authmethod,
                failurereason=ae.failurereason,
                auth_latency_ms=ae.auth_latency_ms,
                nasipaddress=str(ae.nasipaddress).split("/")[0] if ae.nasipaddress else None,
                nasidentifier=ae.nasidentifier,
                callingstationid=ae.callingstationid,
                calledstationid=ae.calledstationid,
                geo_client=_geo(ae.callingstationid),
            )
        )

    events.sort(key=lambda e: e.timestamp or datetime.min, reverse=True)
    return events[:limit]
