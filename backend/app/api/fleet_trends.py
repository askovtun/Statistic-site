"""Fleet Summary Trends: weekly VM fleet changes + daily fleet CPU/RAM performance."""
from __future__ import annotations

import time
from datetime import datetime, timedelta

from fastapi import APIRouter

from app.models.schemas import FleetDailyPerfPoint, FleetTrendsResponse, WeeklyFleetChange
from app.services import db, metrics_store, response_cache

router = APIRouter(tags=["fleet-trends"])
_CACHE_TTL = 600


def _monday_of(dt: datetime) -> datetime:
    return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("/fleet-trends", response_model=FleetTrendsResponse)
async def get_fleet_trends() -> FleetTrendsResponse:
    cached = response_cache.get("fleet_trends", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    synced_at: str | None = vms_cached[1] if vms_cached else None

    # Daily fleet CPU/RAM performance (90 days)
    raw = metrics_store.get_fleet_daily_perf(90)
    daily_perf = [
        FleetDailyPerfPoint(timestamp=p["timestamp"], cpu_avg=p["cpu_avg"], ram_avg=p["ram_avg"])
        for p in raw
    ]

    # Weekly VM changes from vm_config_changes
    # detected_at is stored as INTEGER unix timestamp
    cutoff_ts = int(time.time()) - 90 * 86400
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT change_type, detected_at FROM vm_config_changes "
            "WHERE change_type IN ('added', 'removed', 'cluster') "
            "AND detected_at >= ? ORDER BY detected_at",
            (cutoff_ts,),
        ).fetchall()

    weekly: dict[str, dict] = {}
    for change_type, detected_at_raw in rows:
        try:
            dt = datetime.utcfromtimestamp(int(detected_at_raw))
        except (ValueError, TypeError, OSError):
            continue
        iso = dt.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        monday_ts = int(_monday_of(dt).timestamp())
        w = weekly.setdefault(
            week_key,
            {"week": week_key, "week_start": monday_ts, "added": 0, "removed": 0, "cluster_changes": 0},
        )
        if change_type == "added":
            w["added"] += 1
        elif change_type == "removed":
            w["removed"] += 1
        elif change_type == "cluster":
            w["cluster_changes"] += 1

    weekly_changes = [
        WeeklyFleetChange(**v)
        for v in sorted(weekly.values(), key=lambda x: x["week_start"])
    ]
    total_migrations_90d = sum(w.cluster_changes for w in weekly_changes)

    result = FleetTrendsResponse(
        daily_perf=daily_perf,
        weekly_changes=weekly_changes,
        total_migrations_90d=total_migrations_90d,
        synced_at=synced_at,
    )
    response_cache.put("fleet_trends", result)
    return result
