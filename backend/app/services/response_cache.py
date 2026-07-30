"""In-process TTL cache for expensive endpoint responses.

uvicorn runs as a single-threaded asyncio process, so a plain dict is safe —
no locking needed. Entries keyed as "endpoint:params" expire after `ttl` seconds.
The cache is cleared on every sync cycle so stale data never persists past a
data refresh.
"""
from __future__ import annotations

import time
from typing import Any

_store: dict[str, tuple[Any, float]] = {}


def get(key: str, ttl: int = 300) -> Any | None:
    entry = _store.get(key)
    if entry is None:
        return None
    value, ts = entry
    if time.time() - ts > ttl:
        del _store[key]
        return None
    return value


def put(key: str, value: Any) -> None:
    _store[key] = (value, time.time())


def invalidate_prefix(prefix: str) -> None:
    """Remove all entries whose key starts with prefix."""
    for k in [k for k in _store if k.startswith(prefix)]:
        del _store[k]


def clear() -> None:
    """Wipe the entire cache — called after a sync cycle completes."""
    _store.clear()
