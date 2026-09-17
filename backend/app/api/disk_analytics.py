"""Disk analytics: reclamation candidates, anomalies, and fleet-level summary.

Endpoint: GET /api/disk-analytics?period_days=30

Returns all VMs that meet broad eligibility criteria; the frontend
applies slider-controlled thresholds client-side so no extra fetches
are needed when the user adjusts filters.

Broad inclusion rules (backend):
  reclamation — avg_free_pct > 20 % AND std_dev < 15 %
  anomaly     — drop_pct (start – end) > 2 %
"""
from __future__ import annotations

import math

from fastapi import APIRouter, Query

from app.models.schemas import (
    DiskAnalyticsResponse,
    DiskAnomalyItem,
    DiskFleetSummary,
    DiskReclamationItem,
)
from app.services import db, metrics_store, response_cache

router = APIRouter(tags=["disk-analytics"])

_CACHE_TTL = 300

# Broad thresholds — frontend sliders refine further
_MIN_FREE_BROAD = 20.0
_MAX_VAR_BROAD = 15.0
_MIN_DROP_BROAD = 2.0

# Default thresholds (used for fleet summary counts only)
_DEFAULT_MIN_FREE = 30.0
_DEFAULT_MAX_VAR = 3.0
_DEFAULT_MIN_DROP = 5.0


def _std_dev(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))


def _slope(points: list[tuple[int, float]]) -> float | None:
    """Linear regression slope in %/day on (unix_ts, free_pct) pairs."""
    if len(points) < 2:
        return None
    x0 = points[0][0]
    xs = [(ts - x0) / 86400.0 for ts, _ in points]
    ys = [v for _, v in points]
    n = len(xs)
    xm = sum(xs) / n
    ym = sum(ys) / n
    num = sum((x - xm) * (y - ym) for x, y in zip(xs, ys))
    den = sum((x - xm) ** 2 for x in xs)
    return num / den if den > 0 else None


@router.get("/disk-analytics", response_model=DiskAnalyticsResponse)
async def get_disk_analytics(
    period_days: int = Query(default=30, ge=7, le=90, description="Кількість днів для аналізу"),
) -> DiskAnalyticsResponse:
    cache_key = f"disk-analytics-{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    hostid_cached = db.get("vm_hostid_map")
    synced_at: str | None = vms_cached[1] if vms_cached else None
    vms: list[dict] = vms_cached[0] if vms_cached else []
    vm_hostid_map: dict[str, str] = hostid_cached[0] if hostid_cached else {}

    vm_info: dict[str, dict] = {vm["name"]: vm for vm in vms if vm.get("name")}
    matched_hostid = {n: vm_hostid_map[n] for n in vm_info if n in vm_hostid_map}

    daily_trends = metrics_store.get_disk_daily_trend_batch(matched_hostid, period_days)

    reclamation: list[DiskReclamationItem] = []
    anomalies: list[DiskAnomalyItem] = []
    critical_count = warning_count = ok_count = 0

    for vm_name, points in daily_trends.items():
        if len(points) < 3:
            continue

        free_pcts = [v for _, v in points]
        avg_free = sum(free_pcts) / len(free_pcts)
        min_free = min(free_pcts)
        current_free = free_pcts[-1]
        start_free = free_pcts[0]
        std = _std_dev(free_pcts)

        # Fleet health counts (based on latest reading)
        if current_free < 10.0:
            critical_count += 1
        elif current_free < 20.0:
            warning_count += 1
        else:
            ok_count += 1

        vm = vm_info.get(vm_name, {})

        # ── Reclamation ────────────────────────────────────────────────────────
        if avg_free >= _MIN_FREE_BROAD and std < _MAX_VAR_BROAD:
            reclamation.append(DiskReclamationItem(
                name=vm_name,
                cluster=vm.get("cluster"),
                fqdn=vm.get("fqdn"),
                primary_ip=vm.get("primary_ip"),
                avg_free_pct=round(avg_free, 1),
                min_free_pct=round(min_free, 1),
                variance_pct=round(std, 2),
                data_points=len(points),
            ))

        # ── Anomaly detection ─────────────────────────────────────────────────
        drop_pct = start_free - current_free  # positive = disk filling up

        if drop_pct >= _MIN_DROP_BROAD:
            # Split: historical = first 2/3 of points, recent = last 1/3
            n = len(points)
            split = max(2, n * 2 // 3)
            hist_slope = _slope(points[:split])
            rec_points = points[split:]
            recent_slope = _slope(rec_points) if len(rec_points) >= 2 else None

            acceleration: float | None = None
            if (
                recent_slope is not None
                and hist_slope is not None
                and hist_slope < -0.01
                and recent_slope < 0
            ):
                acceleration = round(recent_slope / hist_slope, 1)

            anomalies.append(DiskAnomalyItem(
                name=vm_name,
                cluster=vm.get("cluster"),
                fqdn=vm.get("fqdn"),
                primary_ip=vm.get("primary_ip"),
                current_free_pct=round(current_free, 1),
                start_free_pct=round(start_free, 1),
                drop_pct=round(drop_pct, 1),
                recent_slope=round(recent_slope, 3) if recent_slope is not None else None,
                hist_slope=round(hist_slope, 3) if hist_slope is not None else None,
                acceleration=acceleration,
                data_points=len(points),
            ))

    reclamation.sort(key=lambda x: x.avg_free_pct, reverse=True)
    anomalies.sort(key=lambda x: x.drop_pct or 0.0, reverse=True)

    # Fleet summary counts at default slider thresholds
    fleet = DiskFleetSummary(
        total_vms_with_data=len(daily_trends),
        critical_count=critical_count,
        warning_count=warning_count,
        ok_count=ok_count,
        reclamation_count=sum(
            1 for r in reclamation
            if r.avg_free_pct >= _DEFAULT_MIN_FREE and r.variance_pct <= _DEFAULT_MAX_VAR
        ),
        anomaly_count=sum(1 for a in anomalies if (a.drop_pct or 0) >= _DEFAULT_MIN_DROP),
    )

    result = DiskAnalyticsResponse(
        fleet=fleet,
        reclamation=reclamation,
        anomalies=anomalies,
        synced_at=synced_at,
        period_days=period_days,
    )
    response_cache.put(cache_key, result)
    return result
