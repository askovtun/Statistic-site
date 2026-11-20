"""Infrastructure Growth Trend: VM and physical server count over time."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import InfraGrowthPoint, InfraGrowthResponse
from app.services import cmdb_tracker, response_cache

router = APIRouter(tags=["cmdb"])

_CACHE_TTL = 1800


@router.get("/infra/growth", response_model=InfraGrowthResponse)
async def get_infra_growth(days: int = Query(90, ge=7, le=365)) -> InfraGrowthResponse:
    """Daily CI count trend for VM and physical server types from CMDB tracker."""
    cache_key = f"infra-growth-{days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    stats = cmdb_tracker.get_stats(days)
    totals = cmdb_tracker.get_current_totals()

    # Build {date: {ci_type: total}}
    date_map: dict[str, dict[str, int]] = {}
    for row in stats:
        d, ci_type, total = row["date"], row["ci_type"], row["total"]
        if d not in date_map:
            date_map[d] = {}
        date_map[d][ci_type] = total

    points = [
        InfraGrowthPoint(
            date=d,
            vm_total=vals.get("vm", 0),
            physical_total=vals.get("physical", 0),
        )
        for d, vals in sorted(date_map.items())
    ]

    result = InfraGrowthResponse(
        points=points,
        current_vms=totals.get("vm", 0),
        current_physical=totals.get("physical", 0),
        days=days,
    )
    response_cache.put(cache_key, result)
    return result
