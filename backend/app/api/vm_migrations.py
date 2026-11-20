"""VM DRS/Cluster Migration report from vm_config_changes (change_type='cluster')."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Query

from app.models.schemas import (
    ClusterFlowItem,
    TopMigratedVm,
    VmMigrationItem,
    VmMigrationsResponse,
    WeeklyMigrationCount,
)
from app.services import db, response_cache

router = APIRouter(tags=["vm-migrations"])
_CACHE_TTL = 600


def _monday_of(dt: datetime) -> datetime:
    return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("/vm-migrations", response_model=VmMigrationsResponse)
async def get_vm_migrations(
    days: int = Query(default=90, description="Lookback period in days"),
) -> VmMigrationsResponse:
    cache_key = f"vm_migrations:{days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    cutoff_dt = datetime.utcfromtimestamp(int(time.time()) - days * 86400).strftime("%Y-%m-%dT%H:%M:%S")
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT id, name, old_value, new_value, detected_at "
            "FROM vm_config_changes "
            "WHERE change_type = 'cluster' AND detected_at >= ? "
            "ORDER BY detected_at DESC",
            (cutoff_dt,),
        ).fetchall()

    items: list[VmMigrationItem] = []
    vm_move_count: dict[str, int] = defaultdict(int)
    vm_clusters: dict[str, list[str]] = defaultdict(list)
    cluster_flow: dict[tuple[str, str], int] = defaultdict(int)
    weekly: dict[str, dict] = {}

    for row_id, name, old_val, new_val, detected_at_str in rows:
        items.append(VmMigrationItem(
            id=row_id,
            vm_name=name,
            from_cluster=old_val,
            to_cluster=new_val,
            detected_at=detected_at_str,
        ))
        vm_move_count[name] += 1
        if new_val and new_val not in vm_clusters[name]:
            vm_clusters[name].append(new_val)
        if old_val and old_val != new_val:
            cluster_flow[(old_val or "?", new_val or "?")] += 1

        try:
            dt = datetime.fromisoformat(detected_at_str)
        except (ValueError, TypeError):
            continue
        iso = dt.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        monday_ts = int(_monday_of(dt).timestamp())
        w = weekly.setdefault(week_key, {"week": week_key, "week_start": monday_ts, "count": 0})
        w["count"] += 1

    top_vms = [
        TopMigratedVm(
            name=vm_name,
            migration_count=count,
            clusters=vm_clusters.get(vm_name, []),
        )
        for vm_name, count in sorted(vm_move_count.items(), key=lambda x: -x[1])
    ][:20]

    flow = [
        ClusterFlowItem(from_cluster=k[0], to_cluster=k[1], count=v)
        for k, v in sorted(cluster_flow.items(), key=lambda x: -x[1])
    ][:30]

    weekly_counts = [
        WeeklyMigrationCount(**v)
        for v in sorted(weekly.values(), key=lambda x: x["week_start"])
    ]

    result = VmMigrationsResponse(
        total=len(items),
        period_days=days,
        top_migrated_vms=top_vms,
        cluster_flow=flow,
        weekly_counts=weekly_counts,
        items=items,
    )
    response_cache.put(cache_key, result)
    return result
