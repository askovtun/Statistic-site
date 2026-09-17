"""Disk space forecast: linear regression on Zabbix disk_free_pct daily trend."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import DiskForecastItem, DiskForecastResponse
from app.services import db, metrics_store, response_cache

router = APIRouter(tags=["disk-forecast"])

_CACHE_TTL = 300


def _linear_forecast(
    points: list[tuple[int, float]],
) -> tuple[float | None, float | None, int | None]:
    """Linear regression on (unix_day_ts, free_pct) pairs.

    Returns (current_free_pct, slope_pct_per_day, days_until_full).
    days_until_full is None when trend is flat/positive or > 2 years away.
    """
    if len(points) < 3:
        return (points[-1][1] if points else None), None, None

    x0 = points[0][0]
    xs = [(ts - x0) / 86400.0 for ts, _ in points]
    ys = [v for _, v in points]

    n = len(xs)
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n

    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    den = sum((x - x_mean) ** 2 for x in xs)

    if den == 0:
        return y_mean, None, None

    slope = num / den          # % per day (negative = disk filling)
    intercept = y_mean - slope * x_mean

    x_last = xs[-1]
    y_now = slope * x_last + intercept

    if slope >= -0.01:         # flat or growing — not a concern
        return y_now, slope, None

    # Days from last data point until free_pct = 0
    # 0 = slope * x_full + intercept  →  x_full = -intercept / slope
    x_full = -intercept / slope
    days_from_now = x_full - x_last

    if days_from_now <= 0:
        return y_now, slope, 0
    if days_from_now > 730:    # more than 2 years — not urgent
        return y_now, slope, None

    return y_now, slope, int(days_from_now)


@router.get("/disk-forecast", response_model=DiskForecastResponse)
async def get_disk_forecast(
    period_days: int = Query(default=30, ge=7, le=90, description="Кількість днів для аналізу тренду"),
    warn_days: int = Query(default=90, ge=1, le=365, description="Поріг для попередження (днів до заповнення)"),
) -> DiskForecastResponse:
    """Per-VM disk space trend: linear regression on daily disk_free_pct to forecast when disk fills."""
    cache_key = f"disk-forecast-{period_days}-{warn_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    hostid_cached = db.get("vm_hostid_map")

    synced_at: str | None = vms_cached[1] if vms_cached else None
    vms: list[dict] = vms_cached[0] if vms_cached else []
    vm_hostid_map: dict[str, str] = hostid_cached[0] if hostid_cached else {}

    vm_info: dict[str, dict] = {vm["name"]: vm for vm in vms if vm.get("name")}

    matched_hostid = {
        name: vm_hostid_map[name]
        for name in vm_info
        if name in vm_hostid_map
    }

    daily_trends = metrics_store.get_disk_daily_trend_batch(matched_hostid, period_days)

    items: list[DiskForecastItem] = []
    for vm_name, points in daily_trends.items():
        if not points:
            continue

        current_free, trend_per_day, days_until_full = _linear_forecast(points)
        min_free = min(v for _, v in points)

        if current_free is None:
            continue

        # Only show VMs that are either filling up or already critically low
        if days_until_full is None and current_free > 90:
            continue

        vm = vm_info.get(vm_name, {})
        items.append(DiskForecastItem(
            name=vm_name,
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            current_free_pct=round(current_free, 1),
            min_free_pct=round(min_free, 1),
            days_until_full=days_until_full,
            trend_pct_per_day=round(trend_per_day, 3) if trend_per_day is not None else None,
            data_points=len(points),
        ))

    # Sort: filling soonest first, then by current_free_pct ascending
    items.sort(key=lambda x: (
        x.days_until_full if x.days_until_full is not None else 9_999,
        x.current_free_pct if x.current_free_pct is not None else 100.0,
    ))

    critical = sum(1 for i in items if i.days_until_full is not None and i.days_until_full <= 30)
    warning = sum(
        1 for i in items
        if i.days_until_full is not None and 30 < i.days_until_full <= warn_days
    )

    result = DiskForecastResponse(
        total=len(items),
        critical=critical,
        warning=warning,
        items=items,
        synced_at=synced_at,
        period_days=period_days,
    )
    response_cache.put(cache_key, result)
    return result
