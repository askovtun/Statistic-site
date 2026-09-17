"""VM Configuration Changes — per-field diff log recorded on each metadata sync."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.models.schemas import VmChangeItem, VmChangesResponse
from app.services import db, response_cache

router = APIRouter(tags=["vm-changes"])

_CACHE_TTL = 300


@router.get("/vm-changes", response_model=VmChangesResponse)
async def get_vm_changes(
    days: int = Query(default=30, ge=1, le=365),
) -> VmChangesResponse:
    cache_key = f"vm-changes-{days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    since_ts = int(time.time()) - days * 86400
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT id, name, change_type, old_value, new_value, detected_at "
            "FROM vm_config_changes WHERE detected_at >= ? ORDER BY detected_at DESC",
            (since_ts,),
        ).fetchall()

    items = [
        VmChangeItem(
            id=row[0],
            name=row[1],
            change_type=row[2],
            old_value=row[3],
            new_value=row[4],
            detected_at=datetime.fromtimestamp(row[5], tz=timezone.utc).isoformat(),
        )
        for row in rows
    ]
    result = VmChangesResponse(total=len(items), period_days=days, items=items)
    response_cache.put(cache_key, result)
    return result
