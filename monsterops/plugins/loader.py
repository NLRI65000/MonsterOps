from __future__ import annotations

import importlib
import importlib.metadata
import logging

from fastapi import FastAPI

from monsterops.config import settings

logger = logging.getLogger(__name__)

BUILTIN_MODULE_PATH = "monsterops.modules"
PLUGIN_ENTRY_POINT_GROUP = "monsterops.plugins"


def load_modules(app: FastAPI) -> None:
    for name in settings.module_list:
        module_path = f"{BUILTIN_MODULE_PATH}.{name}.router"
        try:
            mod = importlib.import_module(module_path)
            app.include_router(mod.router)
            logger.info("Loaded module: %s", name)
        except ModuleNotFoundError:
            logger.warning("Module '%s' not found — skipping", name)
        except Exception:
            logger.exception("Failed to load module '%s'", name)


def load_plugins(app: FastAPI) -> None:
    eps = importlib.metadata.entry_points(group=PLUGIN_ENTRY_POINT_GROUP)
    enabled = set(settings.plugin_list)

    for ep in eps:
        if enabled and ep.name not in enabled:
            continue
        try:
            plugin = ep.load()
            app.include_router(plugin.router)
            logger.info("Loaded plugin: %s", ep.name)
        except Exception:
            logger.exception("Failed to load plugin '%s'", ep.name)
