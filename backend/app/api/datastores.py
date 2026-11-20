"""Datastores: vCenter datastore capacity and usage."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import DatastoreItem, DatastoresResponse
from app.services import response_cache, vcenter_client

router = APIRouter(tags=["vcenter"])

_CACHE_TTL = 1800


@router.get("/vcenter/datastores", response_model=DatastoresResponse)
async def get_datastores() -> DatastoresResponse:
    """All vCenter datastores with capacity, free space and usage %."""
    cached = response_cache.get("vcenter-datastores", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    raw = await vcenter_client.list_datastores()
    datastores = [DatastoreItem(**d) for d in raw]

    total_cap = sum(d.capacity_gb or 0 for d in datastores)
    total_free = sum(d.free_gb or 0 for d in datastores)
    overall_used_pct = round((total_cap - total_free) / total_cap * 100, 1) if total_cap else None

    result = DatastoresResponse(
        datastores=datastores,
        total=len(datastores),
        total_capacity_gb=round(total_cap, 1),
        total_free_gb=round(total_free, 1),
        overall_used_pct=overall_used_pct,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("vcenter-datastores", result)
    return result


@router.post("/vcenter/datastores/refresh", status_code=200)
async def refresh_datastores() -> dict:
    """Invalidate datastore cache and fetch fresh data from vCenter."""
    response_cache.invalidate_prefix("vcenter-datastores")
    raw = await vcenter_client.list_datastores()
    datastores = [DatastoreItem(**d) for d in raw]
    total_cap = sum(d.capacity_gb or 0 for d in datastores)
    total_free = sum(d.free_gb or 0 for d in datastores)
    overall_used_pct = round((total_cap - total_free) / total_cap * 100, 1) if total_cap else None
    result = DatastoresResponse(
        datastores=datastores,
        total=len(datastores),
        total_capacity_gb=round(total_cap, 1),
        total_free_gb=round(total_free, 1),
        overall_used_pct=overall_used_pct,
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("vcenter-datastores", result)
    return {"refreshed": True, "total": len(datastores)}
