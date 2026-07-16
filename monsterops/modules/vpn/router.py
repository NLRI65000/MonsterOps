from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.database import get_db
from monsterops.modules.auth.utils import audit, get_current_user, require_roles
from monsterops.modules.vpn.models import VpnTunnel
from monsterops.modules.vpn.schemas import (
    TunnelActionResult,
    TunnelBase,
    TunnelConfigPreview,
    TunnelCreate,
    TunnelOut,
    TunnelUpdate,
)
from monsterops.modules.vpn.service import apply_status, get_backend
from monsterops.modules.vpn.wgkeys import generate_keypair, public_from_private

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vpn", tags=["vpn"])


def _out(t: VpnTunnel) -> TunnelOut:
    out = TunnelOut.from_model(t)
    ok, hint = get_backend(t.type).tooling()
    out.tooling_ok = ok
    out.tooling_hint = hint
    return out


def _populate(t: VpnTunnel, body: TunnelBase, *, creating: bool) -> None:
    t.name = body.name
    t.type = body.type
    t.enabled = body.enabled
    t.description = body.description
    t.routes = body.routes_csv()

    if body.type == "wireguard":
        if body.wg_private_key:
            t.wg_private_key = body.wg_private_key
            t.wg_public_key = public_from_private(body.wg_private_key)
        elif creating or not t.wg_private_key:
            t.wg_private_key, t.wg_public_key = generate_keypair()
        t.wg_address = body.wg_address
        t.wg_listen_port = body.wg_listen_port
        t.wg_peer_public_key = body.wg_peer_public_key
        t.wg_peer_host = body.wg_peer_host
        t.wg_peer_port = body.wg_peer_port
        t.wg_persistent_keepalive = body.wg_persistent_keepalive
        t.wg_mtu = body.wg_mtu
        t.wg_dns = body.dns_csv()
    elif body.type == "l2tp-ipsec":
        t.l2tp_gateway = body.l2tp_gateway
        t.l2tp_username = body.l2tp_username
        if body.l2tp_psk:
            t.l2tp_psk = body.l2tp_psk
        if body.l2tp_password:
            t.l2tp_password = body.l2tp_password


async def _get_or_404(db: AsyncSession, tunnel_id: int) -> VpnTunnel:
    t = await db.get(VpnTunnel, tunnel_id)
    if not t:
        raise HTTPException(404, "VPN tunnel not found")
    return t




@router.get("", response_model=list[TunnelOut])
async def list_tunnels(db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    tunnels = (await db.execute(select(VpnTunnel).order_by(VpnTunnel.name))).scalars().all()
    return [_out(t) for t in tunnels]


@router.post("", response_model=TunnelOut, status_code=201)
async def create_tunnel(
    body: TunnelCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    dup = await db.scalar(
        select(func.count()).select_from(VpnTunnel).where(VpnTunnel.name == body.name)
    )
    if dup:
        raise HTTPException(409, f"VPN tunnel '{body.name}' already exists")
    t = VpnTunnel()
    _populate(t, body, creating=True)
    db.add(t)
    await db.flush()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.create",
        target=body.name,
        request=request,
    )
    await db.commit()
    await db.refresh(t)
    return _out(t)


@router.get("/{tunnel_id}", response_model=TunnelOut)
async def get_tunnel(
    tunnel_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)
):
    return _out(await _get_or_404(db, tunnel_id))


@router.put("/{tunnel_id}", response_model=TunnelOut)
async def update_tunnel(
    tunnel_id: int,
    body: TunnelUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    t = await _get_or_404(db, tunnel_id)
    dup = await db.scalar(
        select(func.count())
        .select_from(VpnTunnel)
        .where(VpnTunnel.name == body.name, VpnTunnel.id != tunnel_id)
    )
    if dup:
        raise HTTPException(409, f"VPN tunnel '{body.name}' already exists")
    _populate(t, body, creating=False)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.update",
        target=t.name,
        request=request,
    )
    await db.commit()
    await db.refresh(t)
    return _out(t)


@router.delete("/{tunnel_id}", status_code=204)
async def delete_tunnel(
    tunnel_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin", "admin")),
):
    t = await _get_or_404(db, tunnel_id)
    try:
        await get_backend(t.type).down(t)
    except Exception:  # noqa: BLE001
        logger.warning("Teardown of VPN tunnel %s during delete failed", t.name, exc_info=True)
    await db.delete(t)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.delete",
        target=t.name,
        request=request,
    )
    await db.commit()




@router.get("/{tunnel_id}/config-preview", response_model=TunnelConfigPreview)
async def preview_config(
    tunnel_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    t = await _get_or_404(db, tunnel_id)
    content, files = get_backend(t.type).preview(t)
    return TunnelConfigPreview(content=content, files=files)


@router.post("/{tunnel_id}/up", response_model=TunnelActionResult)
async def bring_up(
    tunnel_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin")),
):
    t = await _get_or_404(db, tunnel_id)
    st = await get_backend(t.type).up(t)
    t.enabled = True
    apply_status(t, st)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.up",
        target=t.name,
        detail={"result": st.oper_state},
        request=request,
    )
    await db.commit()
    await db.refresh(t)
    return TunnelActionResult(tunnel=_out(t), ok=st.oper_state == "up", detail=st.detail)


@router.post("/{tunnel_id}/down", response_model=TunnelActionResult)
async def bring_down(
    tunnel_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin")),
):
    t = await _get_or_404(db, tunnel_id)
    st = await get_backend(t.type).down(t)
    t.enabled = False
    apply_status(t, st)
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.down",
        target=t.name,
        request=request,
    )
    await db.commit()
    await db.refresh(t)
    return TunnelActionResult(tunnel=_out(t), ok=st.oper_state != "error", detail=st.detail)


@router.post("/{tunnel_id}/status", response_model=TunnelOut)
async def refresh_status(
    tunnel_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("superadmin", "admin")),
):
    t = await _get_or_404(db, tunnel_id)
    st = await get_backend(t.type).status(t)
    apply_status(t, st)
    await db.commit()
    await db.refresh(t)
    return _out(t)


@router.post("/{tunnel_id}/regenerate-keys", response_model=TunnelOut)
async def regenerate_keys(
    tunnel_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current=Depends(require_roles("superadmin")),
):
    t = await _get_or_404(db, tunnel_id)
    if t.type != "wireguard":
        raise HTTPException(400, "Key regeneration only applies to WireGuard tunnels")
    t.wg_private_key, t.wg_public_key = generate_keypair()
    await audit(
        db,
        user_id=current.id,
        username=current.username,
        action="vpn.regenerate_keys",
        target=t.name,
        request=request,
    )
    await db.commit()
    await db.refresh(t)
    return _out(t)
