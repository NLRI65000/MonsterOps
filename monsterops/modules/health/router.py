from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import tempfile
import subprocess
import time
from collections import deque
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from monsterops.config import settings
from monsterops.database import get_db
from monsterops.modules.auth.utils import get_current_user, require_roles
from .schemas import DBHealth, HealthStatus, LogFile, LogTailResponse, ServiceActionResult, ServiceStatus

router = APIRouter(prefix="/api/health", tags=["health"])

_SERVICE = "freeradius"
_ALLOWED_ACTIONS = frozenset({"reload", "restart", "start", "stop"})

_APP_LOG_BUFFER: deque[str] = deque(maxlen=500)
_APP_LOG_QUEUES: list[asyncio.Queue[str]] = []


class _AppLogHandler(logging.Handler):

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
            _APP_LOG_BUFFER.append(line)
            for q in list(_APP_LOG_QUEUES):
                try:
                    q.put_nowait(line)
                except asyncio.QueueFull:
                    pass
        except Exception:
            pass


_app_log_handler = _AppLogHandler()
_app_log_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
))
logging.getLogger().addHandler(_app_log_handler)



def _get_service_status() -> ServiceStatus:
    try:
        result = subprocess.run(
            ["systemctl", "show", _SERVICE,
             "--property=ActiveState,SubState,LoadState"],
            capture_output=True, text=True, timeout=5,
        )
        props: dict[str, str] = {}
        for line in result.stdout.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                props[k] = v
        return ServiceStatus(
            service=_SERVICE,
            active_state=props.get("ActiveState", "unknown"),
            sub_state=props.get("SubState", "unknown"),
            load_state=props.get("LoadState", "unknown"),
        )
    except FileNotFoundError:
        return ServiceStatus(service=_SERVICE, active_state="unknown",
                             sub_state="systemctl not found", load_state="unknown")
    except Exception as exc:
        return ServiceStatus(service=_SERVICE, active_state="unknown",
                             sub_state=str(exc), load_state="unknown")


def _allowed_log_files() -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in settings.radius_log_files.split(","):
        p = raw.strip()
        if p:
            result[os.path.basename(p)] = os.path.realpath(p)
    return result


def _resolve_log_path(file: str) -> str:
    allowed = _allowed_log_files()
    key = os.path.basename(file)
    if key not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Log file not configured: {key}. "
                   f"Allowed: {', '.join(sorted(allowed))}",
        )
    path = allowed[key]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Log file not found: {key}")
    return path



@router.get("", tags=["health"])
async def health_ping():
    return {"status": "ok"}


@router.get("/status", response_model=HealthStatus)
async def get_health_status(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    loop = asyncio.get_running_loop()
    svc = await loop.run_in_executor(None, _get_service_status)

    t0 = time.monotonic()
    try:
        await db.execute(text("SELECT 1"))
        latency_ms = round((time.monotonic() - t0) * 1000, 2)
        db_health = DBHealth(ok=True, latency_ms=latency_ms)
    except Exception:
        db_health = DBHealth(ok=False)

    return HealthStatus(freeradius=svc, database=db_health)


@router.post("/validate-config")
async def validate_config(_user=Depends(require_roles("superadmin", "admin"))):
    try:
        proc = await asyncio.create_subprocess_exec(
            "/usr/sbin/freeradius", "-C",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        output = stdout.decode(errors="replace") if stdout else ""
        ok = proc.returncode == 0
        return {"ok": ok, "output": output, "return_code": proc.returncode}
    except FileNotFoundError:
        raise HTTPException(500, "freeradius binary not found at /usr/sbin/freeradius")
    except asyncio.TimeoutError:
        raise HTTPException(504, "Config validation timed out after 30 seconds")


@router.post("/service/{action}", response_model=ServiceActionResult)
async def control_service(
    action: str,
    _user=Depends(require_roles("superadmin", "admin")),
):
    if action not in _ALLOWED_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action. Must be one of: {', '.join(sorted(_ALLOWED_ACTIONS))}",
        )

    def _run() -> ServiceActionResult:
        import shutil
        cmd = ["systemctl", action, _SERVICE]
        if shutil.which("sudo"):
            cmd = ["sudo", "-n"] + cmd
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            output = (res.stdout + res.stderr).strip() or f"{action} completed"
            return ServiceActionResult(
                action=action, success=res.returncode == 0, output=output
            )
        except subprocess.TimeoutExpired:
            return ServiceActionResult(action=action, success=False, output="Command timed out")
        except FileNotFoundError:
            return ServiceActionResult(action=action, success=False, output="systemctl not found")
        except Exception as exc:
            return ServiceActionResult(action=action, success=False, output=str(exc))

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run)


@router.get("/logs/files", response_model=list[LogFile])
async def list_log_files(_user=Depends(get_current_user)):
    result = []
    for raw in settings.radius_log_files.split(","):
        p = raw.strip()
        if p:
            result.append(LogFile(
                name=os.path.basename(p),
                path=p,
                exists=os.path.exists(p),
            ))
    return result


@router.get("/logs/tail", response_model=LogTailResponse)
async def get_log_tail(
    file: str = Query("radius.log"),
    lines: int = Query(500, ge=1, le=2000),
    _user=Depends(get_current_user),
):
    path = _resolve_log_path(file)

    def _read() -> list[str]:
        buf: deque[str] = deque(maxlen=lines)
        with open(path, "r", errors="replace") as fh:
            for line in fh:
                buf.append(line.rstrip())
        return list(buf)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, _read)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return LogTailResponse(lines=result)



_SSE_AUTH = require_roles("superadmin", "admin")


def setup_app_log_handler() -> None:
    for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        _lg = logging.getLogger(_name)
        if _app_log_handler not in _lg.handlers:
            _lg.addHandler(_app_log_handler)
    logging.getLogger(__name__).info("MonsterOps app log stream ready")


@router.get("/logs/stream")
async def stream_log(
    file: str = Query("radius.log"),
    _user=Depends(_SSE_AUTH),
):
    path = _resolve_log_path(file)

    async def _generate() -> AsyncGenerator[str, None]:
        loop = asyncio.get_running_loop()
        state = {"offset": 0}

        def _tail_and_offset(n: int = 200) -> tuple[list[str], int]:
            try:
                size = os.path.getsize(path)
            except OSError:
                return [], 0
            lines: list[str] = []
            try:
                with open(path, "r", errors="replace") as fh:
                    chunk = 8192
                    remaining = size
                    buf = ""
                    while remaining > 0 and len(lines) <= n:
                        read_size = min(chunk, remaining)
                        remaining -= read_size
                        fh.seek(remaining)
                        buf = fh.read(read_size) + buf
                        lines = buf.splitlines()
                    return lines[-n:], size
            except OSError:
                return [], 0

        tail_lines, initial_offset = await loop.run_in_executor(None, _tail_and_offset)
        state["offset"] = initial_offset

        for line in tail_lines:
            yield f"data: {json.dumps({'line': line})}\n\n"
        yield ": keepalive\n\n"

        while True:
            def _read_new() -> list[str]:
                try:
                    size = os.path.getsize(path)
                except OSError:
                    return []
                if size < state["offset"]:
                    state["offset"] = 0
                if size == state["offset"]:
                    return []
                new_lines: list[str] = []
                with open(path, "r", errors="replace") as fh:
                    fh.seek(state["offset"])
                    for line in fh:
                        new_lines.append(line.rstrip())
                    state["offset"] = fh.tell()
                return new_lines

            try:
                new_lines = await loop.run_in_executor(None, _read_new)
            except OSError:
                yield ": keepalive\n\n"
                await asyncio.sleep(1)
                continue

            if new_lines:
                for line in new_lines:
                    yield f"data: {json.dumps({'line': line})}\n\n"
            else:
                yield ": keepalive\n\n"

            await asyncio.sleep(0.5)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )



@router.get("/logs/app")
async def stream_app_log(
    _user=Depends(_SSE_AUTH),
) -> StreamingResponse:
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=500)
    _APP_LOG_QUEUES.append(q)

    for line in list(_APP_LOG_BUFFER):
        try:
            q.put_nowait(line)
        except asyncio.QueueFull:
            break

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            yield ": keepalive\n\n"
            while True:
                try:
                    line = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps({'line': line})}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            try:
                _APP_LOG_QUEUES.remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



_CONSOLE_COMMANDS = {
    "reload_freeradius": "Reload FreeRADIUS config",
    "restart_freeradius": "Restart FreeRADIUS",
    "run_migrations": "Run pending Alembic migrations",
}


@router.get("/console/commands")
async def list_console_commands(
    _user=Depends(require_roles("superadmin")),
) -> dict:
    return {"commands": [{"id": k, "label": v} for k, v in _CONSOLE_COMMANDS.items()]}


@router.post("/console/run/{command_id}")
async def run_console_command(
    command_id: str,
    _user=Depends(require_roles("superadmin")),
) -> dict:
    if command_id not in _CONSOLE_COMMANDS:
        raise HTTPException(400, f"Unknown command: {command_id}")

    if command_id == "reload_freeradius":
        from monsterops.radius_reload import reload_freeradius
        ok = await reload_freeradius()
        return {"command": command_id, "success": ok,
                "message": "FreeRADIUS reloaded" if ok else "Reload failed — check logs"}

    if command_id == "restart_freeradius":
        from monsterops.radius_reload import restart_freeradius
        ok = await restart_freeradius()
        return {"command": command_id, "success": ok,
                "message": "FreeRADIUS restarted" if ok else "Restart failed — check logs"}

    if command_id == "run_migrations":
        import sys
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "alembic", "upgrade", "head",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
            output = stdout.decode(errors="replace").strip()
            success = proc.returncode == 0
            return {"command": command_id, "success": success, "message": output or "No output"}
        except asyncio.TimeoutError:
            return {"command": command_id, "success": False, "message": "Migration timed out after 60s"}

    raise HTTPException(400, f"Unhandled command: {command_id}")



_GEOIP_STORE = Path(__file__).resolve().parents[3] / "data" / "GeoLite2-City.mmdb"


def _env_file() -> Path:
    return Path(__file__).resolve().parents[3] / ".env"


def _update_env(key: str, value: str) -> None:
    env_path = _env_file()
    if env_path.exists():
        lines = env_path.read_text().splitlines()
        found = False
        new_lines = []
        for line in lines:
            if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
                new_lines.append(f"{key}={value}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={value}")
        env_path.write_text("\n".join(new_lines) + "\n")
    else:
        env_path.write_text(f"{key}={value}\n")


@router.get("/geoip/status")
async def geoip_status(_user=Depends(get_current_user)) -> dict:
    db_path = settings.geoip_db or str(_GEOIP_STORE)
    p = Path(db_path)
    if not p.exists():
        return {"configured": bool(settings.geoip_db), "db_exists": False,
                "db_path": db_path, "build_epoch": None, "description": None}
    try:
        import geoip2.database
        with geoip2.database.Reader(str(p)) as r:
            meta = r.metadata()
            return {
                "configured": True,
                "db_exists": True,
                "db_path": str(p),
                "build_epoch": meta.build_epoch,
                "description": meta.description.get("en", "") if meta.description else "",
                "record_size": meta.record_size,
                "ip_version": meta.ip_version,
            }
    except Exception as exc:
        return {"configured": bool(settings.geoip_db), "db_exists": True,
                "db_path": db_path, "build_epoch": None, "description": None,
                "error": str(exc)}


@router.post("/geoip/upload")
async def geoip_upload(
    file: UploadFile = File(...),
    _user=Depends(require_roles("admin", "superadmin")),
) -> dict:
    if not file.filename or not file.filename.endswith(".mmdb"):
        raise HTTPException(400, "File must be a .mmdb database")

    _MAX_MMDB_BYTES = 256 * 1024 * 1024
    content = await file.read(_MAX_MMDB_BYTES + 1)
    if len(content) > _MAX_MMDB_BYTES:
        raise HTTPException(413, "File exceeds the 256 MB limit")
    if len(content) < 1024:
        raise HTTPException(400, "File is too small to be a valid .mmdb database")

    try:
        import geoip2.database
        with tempfile.NamedTemporaryFile(suffix=".mmdb", delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)
        with geoip2.database.Reader(str(tmp_path)) as r:
            meta = r.metadata()
            build_epoch = meta.build_epoch
            description = meta.description.get("en", "") if meta.description else ""
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(422, f"Invalid database file: {exc}")

    _GEOIP_STORE.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(tmp_path), str(_GEOIP_STORE))

    settings.geoip_db = str(_GEOIP_STORE)
    _update_env("MONSTEROPS_GEOIP_DB", str(_GEOIP_STORE))

    from monsterops import geo as _geo_module
    _geo_module.reload_reader()

    test_result = _geo_module.lookup("8.8.8.8")

    return {
        "ok": True,
        "db_path": str(_GEOIP_STORE),
        "build_epoch": build_epoch,
        "description": description,
        "test_lookup": test_result,
    }


@router.post("/geoip/restart-app")
async def restart_app(_user=Depends(require_roles("superadmin"))) -> dict:
    async def _delayed_kill():
        await asyncio.sleep(1.5)
        os.kill(os.getpid(), signal.SIGTERM)
    asyncio.create_task(_delayed_kill())
    return {"ok": True, "message": "Application is restarting…"}
