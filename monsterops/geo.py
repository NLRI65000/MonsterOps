
from __future__ import annotations

import ipaddress
import logging
import threading
from typing import TypedDict

logger = logging.getLogger(__name__)


class GeoInfo(TypedDict, total=False):
    city: str | None
    country: str | None
    country_code: str | None
    latitude: float | None
    longitude: float | None


_reader = None
_reader_lock = threading.Lock()
_db_warned = False


def _get_reader():
    global _reader, _db_warned
    if _reader is not None:
        return _reader
    with _reader_lock:
        if _reader is not None:
            return _reader
        from monsterops.config import settings

        db_path = getattr(settings, "geoip_db", "")
        if not db_path:
            return None
        try:
            import geoip2.database

            _reader = geoip2.database.Reader(db_path)
            logger.info("GeoIP2 database loaded from %s", db_path)
        except FileNotFoundError:
            if not _db_warned:
                logger.warning(
                    "GeoIP2 database not found at %s — geolocation disabled. "
                    "Download GeoLite2-City.mmdb from https://dev.maxmind.com/ "
                    "and set MONSTEROPS_GEOIP_DB.",
                    db_path,
                )
                _db_warned = True
        except Exception as exc:
            if not _db_warned:
                logger.warning("GeoIP2 database failed to load (%s) — geolocation disabled", exc)
                _db_warned = True
        return _reader


def _is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return not (
            addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_unspecified
        )
    except ValueError:
        return False


def lookup(ip: str | None) -> GeoInfo | None:
    if not ip:
        return None
    ip = ip.split("/")[0].strip()
    if not _is_public(ip):
        return None
    reader = _get_reader()
    if reader is None:
        return None
    try:
        resp = reader.city(ip)
        return GeoInfo(
            city=resp.city.name or None,
            country=resp.country.name or None,
            country_code=resp.country.iso_code or None,
            latitude=resp.location.latitude,
            longitude=resp.location.longitude,
        )
    except Exception:
        return None


def reload_reader() -> None:
    global _reader, _db_warned
    with _reader_lock:
        try:
            if _reader is not None:
                _reader.close()
        except Exception:
            pass
        _reader = None
        _db_warned = False


def lookup_calling_station(calling_station_id: str | None) -> GeoInfo | None:
    if not calling_station_id:
        return None
    val = calling_station_id.strip()
    if ":" in val or ("-" in val and len(val) == 17):
        return None
    return lookup(val)
