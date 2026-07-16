
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

Handler = Callable[["Event"], Awaitable[None]]
_handlers: list[Handler] = []


@dataclass
class Event:
    type: str
    actor: str
    entity_type: str
    entity_id: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))

    def matches(self, pattern: str) -> bool:
        if pattern == "*":
            return True
        if pattern.endswith(".*"):
            return self.type.startswith(pattern[:-1])
        return self.type == pattern

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "actor": self.actor,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
        }


def register_handler(fn: Handler) -> None:
    _handlers.append(fn)


async def fire(event: Event) -> None:
    for handler in _handlers:
        try:
            await handler(event)
        except Exception as exc:
            logger.warning("Event handler %r raised for %s: %s", handler.__name__, event.type, exc)
