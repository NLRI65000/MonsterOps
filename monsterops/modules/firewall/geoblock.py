from __future__ import annotations

import ipaddress
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from monsterops.config import settings
from monsterops.modules.firewall import validators as V
from monsterops.modules.firewall.models import MrFirewallSet, MrFirewallSetEntry

logger = logging.getLogger(__name__)

MAX_CIDRS = 200_000
FETCH_TIMEOUT = 20.0


class CountryBlockError(RuntimeError):
    pass


def normalize_cc(cc: str) -> str:
    s = (cc or "").strip().upper()
    if len(s) != 2 or not s.isalpha():
        raise CountryBlockError(f"invalid country code {cc!r} (use a 2-letter ISO code, e.g. CN)")
    return s


def set_name_for(cc: str) -> str:
    return f"mr_country_{cc.lower()}"


def set_name_for_allow(cc: str) -> str:
    return f"mr_country_allow_{cc.lower()}"


def _parse_zone(text: str) -> list[str]:
    cidrs: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        try:
            net = ipaddress.ip_network(line, strict=False)
        except ValueError:
            continue
        if net.version != 4:
            continue
        cidrs.append(str(net))
        if len(cidrs) > MAX_CIDRS:
            raise CountryBlockError(f"country data exceeds {MAX_CIDRS} networks")
    return cidrs


async def fetch_country_cidrs(cc: str) -> list[str]:
    if not settings.firewall_country_block_enabled:
        raise CountryBlockError("country block is disabled by configuration")
    cc = normalize_cc(cc)
    url = settings.firewall_country_block_url.format(cc=cc.lower())
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "MonsterOps-firewall"})
    except httpx.HTTPError as exc:
        raise CountryBlockError(f"could not reach the country data source: {exc}") from exc
    if resp.status_code == 404:
        raise CountryBlockError(f"no IP data published for country {cc}")
    if resp.status_code != 200:
        raise CountryBlockError(f"country data source returned HTTP {resp.status_code}")

    cidrs = _parse_zone(resp.text)
    if not cidrs:
        raise CountryBlockError(f"no usable IPv4 networks found for country {cc}")
    return cidrs


async def _build_managed_country_set(
    db: AsyncSession, cc: str, *, kind: str, name: str, source: str, comment: str,
) -> dict:
    cidrs = await fetch_country_cidrs(cc)

    fset = (await db.execute(
        select(MrFirewallSet).options(selectinload(MrFirewallSet.entries))
        .where(MrFirewallSet.name == name)
    )).scalar_one_or_none()

    if fset is None:
        fset = MrFirewallSet(name=name, family="ipv4_addr", kind=kind,
                             auto_ban=False, managed_source=source, comment=comment)
        db.add(fset)
        await db.flush()
    elif fset.managed_source != source:
        raise CountryBlockError(
            f"a set named {name!r} already exists and is not managed as {source!r}")
    else:
        for e in list(fset.entries):
            await db.delete(e)
        await db.flush()

    for cidr in cidrs:
        V.validate_addr(cidr)
        db.add(MrFirewallSetEntry(set_id=fset.id, element=cidr, comment=source))
    await db.commit()

    logger.info("Country set: built %s (%s) with %d networks", name, kind, len(cidrs))
    return {"name": name, "country": cc, "count": len(cidrs)}


async def build_country_set(db: AsyncSession, cc: str) -> dict:
    cc = normalize_cc(cc)
    return await _build_managed_country_set(
        db, cc, kind="block", name=set_name_for(cc), source=f"country:{cc}",
        comment=f"Auto-managed country block: {cc}")


async def build_country_allow_set(db: AsyncSession, cc: str) -> dict:
    cc = normalize_cc(cc)
    return await _build_managed_country_set(
        db, cc, kind="allow", name=set_name_for_allow(cc), source=f"country_allow:{cc}",
        comment=f"Auto-managed allow-only (block all except {cc})")
