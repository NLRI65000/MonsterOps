from __future__ import annotations

import asyncio
import importlib.metadata
import json
import os
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from monsterops.config import settings
from monsterops.modules.auth.utils import get_current_user, require_roles

router = APIRouter(prefix="/api/system", tags=["system"])

_ALL_MODULES = [
    "auth", "dashboard", "users", "groups", "nas", "ip_pools",
    "accounting", "auth_logs", "reports", "radius_logs", "system", "health",
]


def _redact_url(url: str) -> str:
    try:
        p = urlparse(url)
        if p.password:
            return url.replace(f":{p.password}@", ":***@")
    except Exception:
        pass
    return url



@router.get("/settings")
async def get_settings(_user=Depends(require_roles("superadmin", "admin"))):
    return {
        "database_url": _redact_url(settings.database_url),
        "secret_key_ok": settings.secret_key != "change-me-before-production",
        "debug": settings.debug,
        "allowed_origins": settings.allowed_origins,
        "log_level": settings.log_level,
        "radius_log_files": settings.radius_log_files,
        "access_token_expire_minutes": settings.access_token_expire_minutes,
        "enabled_modules": settings.module_list,
        "all_modules": _ALL_MODULES,
    }



@router.get("/backup/db")
async def backup_db(_user=Depends(require_roles("superadmin"))):
    try:
        p = urlparse(settings.database_url)
        host = p.hostname or "localhost"
        port = str(p.port or 5432)
        user = p.username or "radius"
        password = p.password or ""
        dbname = (p.path or "/radius").lstrip("/")
    except Exception as e:
        raise HTTPException(500, f"Failed to parse DATABASE_URL: {e}")

    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")

    async def _stream():
        env = {
            "PGPASSWORD": password,
            "PATH": "/usr/bin:/usr/local/bin:/bin",
        }
        proc = await asyncio.create_subprocess_exec(
            "pg_dump", "-U", user, "-h", host, "-p", port, "--no-password", dbname,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        assert proc.stdout is not None
        async for chunk in proc.stdout:
            yield chunk
        await proc.wait()
        if proc.returncode != 0:
            assert proc.stderr is not None
            err = (await proc.stderr.read()).decode(errors="replace")
            yield f"\n-- pg_dump exited with code {proc.returncode}: {err}\n".encode()

    return StreamingResponse(
        _stream(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="monsterops-{ts}.sql"'},
    )



def _backup_dir(create: bool = False) -> Path:
    d = Path(settings.backup_dir)
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/backup/create")
async def create_backup(_user=Depends(require_roles("superadmin"))):
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    snap_dir = _backup_dir(create=True) / ts
    snap_dir.mkdir(parents=True, exist_ok=True)

    try:
        p = urlparse(settings.database_url)
        host = p.hostname or "localhost"
        port = str(p.port or 5432)
        user = p.username or "radius"
        password = p.password or ""
        dbname = (p.path or "/radius").lstrip("/")
    except Exception as e:
        raise HTTPException(500, f"Failed to parse DATABASE_URL: {e}")

    env = {"PGPASSWORD": password, "PATH": "/usr/bin:/usr/local/bin:/bin"}
    sql_path = str(snap_dir / "db.sql")
    proc = await asyncio.create_subprocess_exec(
        "pg_dump", "-U", user, "-h", host, "-p", port, "--no-password", "-f", sql_path, dbname,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(500, f"pg_dump failed: {stderr.decode(errors='replace')}")

    fr_conf = "/etc/freeradius/3.0"
    if os.path.isdir(fr_conf):
        tar_path = snap_dir / "freeradius-config.tar.gz"
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: tarfile.open(str(tar_path), "w:gz").add(fr_conf, arcname="freeradius"))

    meta = {"timestamp": ts, "db": dbname, "freeradius_config": fr_conf}
    (snap_dir / "metadata.json").write_text(json.dumps(meta, indent=2))

    size = sum(f.stat().st_size for f in snap_dir.rglob("*") if f.is_file())
    return {"snapshot": ts, "size_bytes": size, "path": str(snap_dir)}


@router.get("/backup/list")
async def list_backups(_user=Depends(require_roles("superadmin"))):
    bd = _backup_dir()
    if not bd.exists():
        return []
    snaps = []
    for entry in sorted(bd.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        meta_f = entry / "metadata.json"
        meta = {}
        if meta_f.exists():
            try:
                meta = json.loads(meta_f.read_text())
            except Exception:
                pass
        size = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
        files = [f.name for f in entry.iterdir() if f.is_file()]
        snaps.append({"snapshot": entry.name, "size_bytes": size, "files": files, "meta": meta})
    return snaps


@router.delete("/backup/{snapshot}")
async def delete_backup(snapshot: str, _user=Depends(require_roles("superadmin"))):
    if "/" in snapshot or "\\" in snapshot or ".." in snapshot:
        raise HTTPException(400, "Invalid snapshot name")
    snap_dir = _backup_dir() / snapshot
    if not snap_dir.exists():
        raise HTTPException(404, "Snapshot not found")
    import shutil
    shutil.rmtree(str(snap_dir))
    return {"deleted": snapshot}


@router.get("/backup/{snapshot}/download-db")
async def download_backup_db(snapshot: str, _user=Depends(require_roles("superadmin"))):
    if "/" in snapshot or "\\" in snapshot or ".." in snapshot:
        raise HTTPException(400, "Invalid snapshot name")
    sql_file = _backup_dir() / snapshot / "db.sql"
    if not sql_file.exists():
        raise HTTPException(404, "DB backup not found in snapshot")
    return FileResponse(
        path=str(sql_file),
        media_type="application/octet-stream",
        filename=f"monsterops-{snapshot}.sql",
    )


@router.get("/backup/{snapshot}/download-config")
async def download_backup_config(snapshot: str, _user=Depends(require_roles("superadmin"))):
    if "/" in snapshot or "\\" in snapshot or ".." in snapshot:
        raise HTTPException(400, "Invalid snapshot name")
    tar_file = _backup_dir() / snapshot / "freeradius-config.tar.gz"
    if not tar_file.exists():
        raise HTTPException(404, "Config backup not found in snapshot")
    return FileResponse(
        path=str(tar_file),
        media_type="application/gzip",
        filename=f"freeradius-config-{snapshot}.tar.gz",
    )



@router.get("/plugins")
async def list_plugins(_user=Depends(require_roles("superadmin", "admin"))):
    eps = importlib.metadata.entry_points(group="monsterops.plugins")
    result = []
    for ep in eps:
        pkg_name = ep.value.split(".")[0]
        try:
            dist = importlib.metadata.distribution(pkg_name)
            meta: dict[str, str] = dict(dist.metadata)
            version = meta.get("Version", "")
            home = meta.get("Home-page") or meta.get("Project-URL", "")
        except importlib.metadata.PackageNotFoundError:
            version = ""
            home = ""
        result.append({
            "name": ep.name,
            "value": ep.value,
            "version": version,
            "home": home.split(", ")[-1] if ", " in home else home,
        })
    return result


@router.get("/changelog")
async def get_changelog(_user=Depends(get_current_user)):
    import re
    from pathlib import Path

    changelog_path = Path(__file__).parents[3] / "CHANGELOG.md"
    if not changelog_path.exists():
        return {"releases": []}

    text = changelog_path.read_text(encoding="utf-8")
    releases = []
    current: dict | None = None

    for line in text.splitlines():
        m = re.match(r'^## \[(.+?)\]\s*[—-]\s*(.+)', line)
        if m:
            if current:
                releases.append(current)
            current = {"version": m.group(1), "date": m.group(2).strip(), "sections": {}, "_section": None}
            continue
        if current is None:
            continue
        if line.startswith("### "):
            current["_section"] = line[4:].strip()
            current["sections"][current["_section"]] = []
        elif line.startswith("- ") and current["_section"]:
            current["sections"][current["_section"]].append(line[2:].strip())

    if current:
        releases.append(current)

    for r in releases:
        r.pop("_section", None)

    return {"releases": releases}
