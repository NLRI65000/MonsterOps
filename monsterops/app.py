from __future__ import annotations

import asyncio
import hmac
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from monsterops import __version__
from monsterops.config import settings
from monsterops.limiter import limiter
from monsterops.modules.auth.utils import ACCESS_COOKIE, CSRF_COOKIE
from monsterops.plugins.loader import load_modules, load_plugins

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
MODULES_DIR = Path(__file__).parent / "modules"

_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "img-src 'self' data: https://flagcdn.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "connect-src 'self'; "
    "frame-ancestors 'none';"
)


class RequestContextMiddleware:

    def __init__(self, asgi_app):
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.asgi_app(scope, receive, send)
            return
        from monsterops.modules.auth.utils import current_request

        token = current_request.set(Request(scope, receive))
        try:
            await self.asgi_app(scope, receive, send)
        finally:
            current_request.reset(token)


class CSRFMiddleware(BaseHTTPMiddleware):

    _SAFE = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method not in self._SAFE and ACCESS_COOKIE in request.cookies:
            header = request.headers.get("X-CSRF-Token")
            cookie = request.cookies.get(CSRF_COOKIE)
            if not header or not cookie or not hmac.compare_digest(header, cookie):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token missing or invalid"},
                )
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:  # skipcq: PYL-R0201
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = _CSP
        if not settings.debug:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    from monsterops.events import register_handler
    from monsterops.modules.automation.engine import automation_handler
    from monsterops.modules.health.router import setup_app_log_handler
    from monsterops.modules.notifications.worker import notification_worker
    from monsterops.modules.scheduler.service import get_scheduler, load_jobs_from_db
    from monsterops.modules.webhooks.handler import register_all as register_event_handlers

    setup_app_log_handler()
    register_event_handlers()
    register_handler(automation_handler)

    notif_task = asyncio.create_task(notification_worker())

    probe_task = None
    if "realms" in settings.module_list:
        from monsterops.modules.realms.probe import realm_probe_worker

        probe_task = asyncio.create_task(realm_probe_worker())

    vpn_task = None
    if "vpn" in settings.module_list:
        from monsterops.modules.vpn.worker import vpn_status_worker

        vpn_task = asyncio.create_task(vpn_status_worker())

    nm_task = None
    if "nas_manager" in settings.module_list:
        from monsterops.modules.nas_manager.worker import nas_manager_sync_worker

        nm_task = asyncio.create_task(nas_manager_sync_worker())

    nasr_task = None
    if "nas" in settings.module_list and settings.nas_probe_enabled:
        from monsterops.modules.nas.probe import nas_reachability_worker

        nasr_task = asyncio.create_task(nas_reachability_worker())

    fw_task = None
    ab_task = None
    if "firewall" in settings.module_list:
        from monsterops.modules.firewall.worker import (
            brute_force_autoblock_worker,
            firewall_ban_reaper,
        )

        fw_task = asyncio.create_task(firewall_ban_reaper())
        ab_task = asyncio.create_task(brute_force_autoblock_worker())

    tacacs_task = None
    if settings.tacacs_enabled:
        from monsterops.modules.tacacs.server import run_tacacs_server

        tacacs_task = asyncio.create_task(run_tacacs_server())

    sched = get_scheduler()
    sched.start()
    await load_jobs_from_db()
    if "realms" in settings.module_list:
        from monsterops.modules.scheduler.service import load_domain_syncs_from_db

        await load_domain_syncs_from_db()

    try:
        yield
    finally:
        sched.shutdown(wait=False)
        for task in (
            notif_task,
            probe_task,
            vpn_task,
            nm_task,
            nasr_task,
            fw_task,
            ab_task,
            tacacs_task,
        ):
            if task is None:
                continue
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


def create_app() -> FastAPI:
    if settings.secret_key == "change-me-before-production":
        logger.warning(
            "SECURITY WARNING: MONSTEROPS_SECRET_KEY is set to the default value. "
            "Change it before exposing this service to any network."
        )

    docs_url = "/api/docs" if settings.debug else None
    redoc_url = "/api/redoc" if settings.debug else None
    openapi_url = "/api/openapi.json" if settings.debug else None

    app = FastAPI(  # skipcq: PYL-W0621 — the factory local is intentionally also named `app`
        title="MonsterOps",
        version=__version__,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
        lifespan=_lifespan,
    )

    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please slow down."},
            headers={"Retry-After": str(exc.retry_after) if hasattr(exc, "retry_after") else "60"},
        )

    origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(RequestContextMiddleware)

    load_modules(app)
    load_plugins(app)

    if "apikeys" in settings.module_list:
        try:
            from monsterops.modules.apikeys.router import _ext
            from monsterops.modules.apikeys.v1 import router as _v1

            app.include_router(_ext)
            app.include_router(_v1)
        except Exception:
            logger.exception("Failed to load apikeys external router")

    _mount_module_statics(app)
    _register_manifest_endpoint(app)

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

    return app


def _mount_module_statics(application: FastAPI) -> None:
    for name in settings.module_list:
        static_dir = MODULES_DIR / name / "static"
        if static_dir.is_dir():
            application.mount(
                f"/modules/{name}",
                StaticFiles(directory=static_dir),
                name=f"module_static_{name}",
            )


def _register_manifest_endpoint(application: FastAPI) -> None:
    @application.get("/api/manifests", tags=["core"])
    async def get_manifests() -> JSONResponse:
        manifests = []
        for name in settings.module_list:
            manifest_path = MODULES_DIR / name / "static" / "manifest.json"
            if manifest_path.exists():
                manifests.append(json.loads(manifest_path.read_text()))
        return JSONResponse(manifests)


app = create_app()
