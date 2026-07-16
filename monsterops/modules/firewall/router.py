from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from monsterops.database import get_db
from monsterops.modules.auth.models import AdminUser
from monsterops.modules.auth.utils import audit, client_ip, get_current_user, require_roles
from monsterops.modules.firewall import nft, presets, service
from monsterops.modules.firewall.models import (
    MrFirewallRule,
    MrFirewallSet,
    MrFirewallSetEntry,
)
from monsterops.modules.firewall.schemas import (
    BlockEventOut,
    ConfigIn,
    ConfigOut,
    CountryBlockIn,
    ReorderIn,
    RuleIn,
    RuleOut,
    SetEntryIn,
    SetIn,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/firewall", tags=["firewall"])

_WRITE = require_roles("admin", "superadmin")


def _guard_ips(request: Request) -> list[str]:
    ip = client_ip(request)
    return [ip] if ip and ip not in ("127.0.0.1", "::1", "testclient") else []




@router.get("/config", response_model=ConfigOut)
async def get_config(_: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.get_config(db)


@router.put("/config", response_model=ConfigOut)
async def update_config(
    body: ConfigIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    cfg = await service.get_config(db)
    for field, value in body.model_dump().items():
        setattr(cfg, field, value)
    await db.commit()
    await db.refresh(cfg)

    if body.autoblock_enabled:
        has_target = (
            await db.execute(
                select(MrFirewallSet).where(MrFirewallSet.auto_ban == True)  # noqa: E712
            )
        ).scalar_one_or_none()
        if has_target is None:
            db.add(
                MrFirewallSet(
                    name="mr_autoblock",
                    family="ipv4_addr",
                    kind="block",
                    auto_ban=True,
                    comment="Auto-managed by brute-force protection",
                )
            )
            await db.commit()

    await service.persist_boot_ruleset(db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.config",
        detail=body.model_dump(),
    )
    return cfg




@router.get("/rules", response_model=list[RuleOut])
async def list_rules(_: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.list_rules(db)


@router.post("/rules", response_model=RuleOut, status_code=201)
async def create_rule(
    body: RuleIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    max_pos = (await db.execute(select(func.max(MrFirewallRule.position)))).scalar() or 0
    rule = MrFirewallRule(position=int(max_pos) + 1, **body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.rule_create",
        target=str(rule.id),
    )
    return rule


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: int,
    body: RuleIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(MrFirewallRule, rule_id)
    if rule is None:
        raise HTTPException(404, "rule not found")
    for field, value in body.model_dump().items():
        setattr(rule, field, value)
    await db.commit()
    await db.refresh(rule)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.rule_update",
        target=str(rule_id),
    )
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    rule = await db.get(MrFirewallRule, rule_id)
    if rule is None:
        raise HTTPException(404, "rule not found")
    await db.delete(rule)
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.rule_delete",
        target=str(rule_id),
    )


@router.post("/rules/reorder")
async def reorder_rules(
    body: ReorderIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    rules = {int(r.id): r for r in await service.list_rules(db)}
    for idx, rid in enumerate(body.order):
        if rid in rules:
            rules[rid].position = idx
    await db.commit()
    return {"ok": True}




def _set_out(s: MrFirewallSet) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "family": s.family,
        "kind": s.kind,
        "auto_ban": s.auto_ban,
        "managed_source": s.managed_source,
        "comment": s.comment,
        "entries": [
            {
                "id": e.id,
                "element": e.element,
                "comment": e.comment,
                "expires_at": e.expires_at.isoformat() if e.expires_at else None,
            }
            for e in s.entries
        ],
    }


@router.get("/sets")
async def list_sets(_: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [_set_out(s) for s in await service.list_sets(db)]


@router.post("/sets", status_code=201)
async def create_set(
    body: SetIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    exists = (
        await db.execute(select(MrFirewallSet).where(MrFirewallSet.name == body.name))
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "a set with that name already exists")
    fset = MrFirewallSet(**body.model_dump())
    db.add(fset)
    await db.commit()
    await db.refresh(fset, ["entries"])
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.set_create",
        target=body.name,
    )
    return _set_out(fset)


@router.delete("/sets/{set_id}", status_code=204)
async def delete_set(
    set_id: int,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    fset = await db.get(MrFirewallSet, set_id)
    if fset is None:
        raise HTTPException(404, "set not found")
    await db.delete(fset)
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.set_delete",
        target=str(set_id),
    )


@router.post("/sets/{set_id}/entries")
async def add_entry(
    set_id: int,
    body: SetEntryIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    fset = (
        await db.execute(
            select(MrFirewallSet)
            .options(selectinload(MrFirewallSet.entries))
            .where(MrFirewallSet.id == set_id)
        )
    ).scalar_one_or_none()
    if fset is None:
        raise HTTPException(404, "set not found")
    if fset.managed_source:
        raise HTTPException(
            409, "this set is auto-managed — manual entries would be lost on refresh"
        )
    if any(e.element == body.element for e in fset.entries):
        raise HTTPException(409, "element already in set")

    from datetime import datetime, timedelta, timezone

    expires = (
        (datetime.now(timezone.utc) + timedelta(seconds=body.ttl_seconds))
        if body.ttl_seconds
        else None
    )
    entry = MrFirewallSetEntry(
        set_id=set_id, element=body.element, comment=body.comment, expires_at=expires
    )
    db.add(entry)
    await db.commit()
    live_err = None
    if nft.nft_available():
        ok, err = await nft.add_element(fset.name, body.element)
        live_err = None if ok else err
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.set_add_element",
        target=fset.name,
        detail={"element": body.element},
    )
    return {"ok": True, "live_error": live_err}


@router.delete("/sets/{set_id}/entries/{entry_id}", status_code=204)
async def delete_entry(
    set_id: int,
    entry_id: int,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(MrFirewallSetEntry, entry_id)
    if entry is None or entry.set_id != set_id:
        raise HTTPException(404, "entry not found")
    fset = await db.get(MrFirewallSet, set_id)
    if fset is not None and fset.managed_source:
        raise HTTPException(
            409, "this set is auto-managed — remove the whole country block instead"
        )
    element = entry.element
    await db.delete(entry)
    await db.commit()
    if fset is not None and nft.nft_available():
        await nft.delete_element(fset.name, element)
    if fset is not None and await service.mark_block_override(
        db, element=element, set_name=fset.name, username=current.username
    ):
        await audit(
            db,
            user_id=current.id,
            username=current.username,
            action="firewall.autoblock_override",
            target=fset.name,
            detail={"element": element},
        )




@router.post("/country-block")
async def country_block(
    body: CountryBlockIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.firewall import geoblock

    try:
        result = await geoblock.build_country_set(db, body.country_code)
    except geoblock.CountryBlockError as exc:
        raise HTTPException(400, str(exc))
    await service.persist_boot_ruleset(db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.country_block",
        target=result["country"],
        detail={"set": result["name"], "networks": result["count"]},
    )
    return {
        **result,
        "applied": False,
        "hint": "Apply the firewall on the Preview & Apply tab to activate the block.",
    }


@router.delete("/country-block/{cc}", status_code=204)
async def country_unblock(
    cc: str,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.firewall import geoblock

    try:
        name = geoblock.set_name_for(geoblock.normalize_cc(cc))
    except geoblock.CountryBlockError as exc:
        raise HTTPException(400, str(exc))
    fset = (
        await db.execute(select(MrFirewallSet).where(MrFirewallSet.name == name))
    ).scalar_one_or_none()
    if fset is None:
        raise HTTPException(404, "no country block for that code")
    await db.delete(fset)
    await db.commit()
    await service.persist_boot_ruleset(db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.country_unblock",
        target=geoblock.normalize_cc(cc),
    )




@router.post("/country-allow-only")
async def country_allow_only(
    body: CountryBlockIn,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.firewall import geoblock

    try:
        result = await geoblock.build_country_allow_set(db, body.country_code)
    except geoblock.CountryBlockError as exc:
        raise HTTPException(400, str(exc))

    guard = await service.provision_nas_guard_set(db)

    cfg = await service.get_config(db)
    prev_policy = cfg.default_input_policy
    cfg.default_input_policy = "drop"
    await db.commit()

    await service.persist_boot_ruleset(db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.country_allow_only",
        target=result["country"],
        detail={
            "set": result["name"],
            "networks": result["count"],
            "nas_guard": guard["count"],
            "nas_skipped": guard["skipped"],
            "prev_input_policy": prev_policy,
        },
    )
    return {
        **result,
        "applied": False,
        "nas_guard": guard,
        "input_policy": "drop",
        "warning": (
            "Allow-only sets the input policy to DROP. Management stays reachable "
            "(SSH/web guard ports, your admin IP, established connections) and the "
            f"{guard['count']} known NAS client(s) keep RADIUS access"
            + (
                f"; {guard['skipped']} NAS client(s) were skipped (hostname or IPv6) — "
                "add their IPs manually if they must reach RADIUS"
                if guard["skipped"]
                else ""
            )
            + ". Review the Preview & Apply diff before applying; the apply arms a "
            "60s auto-rollback."
        ),
        "hint": "Apply the firewall on the Preview & Apply tab to activate allow-only.",
    }


@router.delete("/country-allow-only/{cc}", status_code=204)
async def country_allow_only_remove(
    cc: str,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    from monsterops.modules.firewall import geoblock

    try:
        name = geoblock.set_name_for_allow(geoblock.normalize_cc(cc))
    except geoblock.CountryBlockError as exc:
        raise HTTPException(400, str(exc))
    fset = (
        await db.execute(select(MrFirewallSet).where(MrFirewallSet.name == name))
    ).scalar_one_or_none()
    if fset is None:
        raise HTTPException(404, "no allow-only block for that code")
    await db.delete(fset)
    await db.commit()

    remaining = (
        await db.execute(
            select(func.count())
            .select_from(MrFirewallSet)
            .where(MrFirewallSet.managed_source.like("country_allow:%"))
        )
    ).scalar() or 0
    reverted = False
    if remaining == 0:
        guard = (
            await db.execute(
                select(MrFirewallSet).where(MrFirewallSet.name == service.NAS_GUARD_SET)
            )
        ).scalar_one_or_none()
        if guard is not None:
            await db.delete(guard)
        cfg = await service.get_config(db)
        cfg.default_input_policy = "accept"
        await db.commit()
        reverted = True

    await service.persist_boot_ruleset(db)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.country_allow_only_remove",
        target=geoblock.normalize_cc(cc),
        detail={"policy_reverted_to_accept": reverted},
    )




@router.post("/block-preflight")
async def block_preflight(
    body: dict,
    request: Request,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    elements = body.get("elements")
    if isinstance(elements, str):
        elements = [elements]
    return await service.find_lockout_ips(
        db,
        elements or [],
        current_ip=client_ip(request),
        country_code=body.get("country_code"),
    )




@router.get("/block-events", response_model=list[BlockEventOut])
async def list_block_events(
    limit: int = 50,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_block_events(db, limit)




@router.get("/preview")
async def preview(
    request: Request,
    _: AdminUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.preview(db, _guard_ips(request))


@router.post("/apply")
async def apply(
    request: Request,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.apply_with_rollback(db, current.username, _guard_ips(request))
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc))
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.apply",
        detail={"confirm_timeout": result["confirm_timeout"]},
    )
    return result


@router.post("/confirm")
async def confirm(
    body: dict,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    if not service.confirm(body.get("token", "")):
        raise HTTPException(404, "no pending apply with that token (may have already rolled back)")
    await service.persist_boot_ruleset(db)
    await audit(db, user_id=current.id, username=current.username, action="firewall.confirm")
    return {"ok": True}


@router.post("/rollback")
async def rollback(
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    ok = await service.rollback_now(db)
    if not ok:
        raise HTTPException(404, "no snapshot to roll back to")
    await audit(db, user_id=current.id, username=current.username, action="firewall.rollback")
    return {"ok": True}




@router.get("/status")
async def status(_: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.status(db)


@router.get("/counters")
async def get_counters(
    _: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await service.counters(db)


@router.get("/presets")
async def list_presets(_: AdminUser = Depends(get_current_user)):
    return [
        {"name": k, "label": v["label"], "description": v["description"]}
        for k, v in presets.PRESETS.items()
    ]


@router.post("/presets/{name}")
async def apply_preset(
    name: str,
    body: dict | None = None,
    current: AdminUser = Depends(_WRITE),
    db: AsyncSession = Depends(get_db),
):
    src_set = (body or {}).get("src_set")
    try:
        rule_dicts = presets.preset_rules(name, src_set)
    except KeyError:
        raise HTTPException(404, "unknown preset")
    max_pos = (await db.execute(select(func.max(MrFirewallRule.position)))).scalar() or 0
    created = 0
    for i, rd in enumerate(rule_dicts):
        rule = MrFirewallRule(position=int(max_pos) + 1 + i, **RuleIn(**rd).model_dump())
        db.add(rule)
        created += 1
    await db.commit()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="firewall.preset",
        target=name,
        detail={"rules_added": created},
    )
    return {"ok": True, "rules_added": created}


@router.get("/snapshots")
async def list_snapshots(
    _: AdminUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    from monsterops.modules.firewall.models import MrFirewallSnapshot

    rows = (
        (
            await db.execute(
                select(MrFirewallSnapshot).order_by(MrFirewallSnapshot.id.desc()).limit(50)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": s.id,
            "note": s.note,
            "actor": s.actor,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "size": len(s.nft_text),
        }
        for s in rows
    ]
