"""Zabbix Incident Trends: weekly problem counts by severity over N weeks."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.models.schemas import ZabbixTrendWeek, ZabbixTrendsResponse
from app.services import response_cache, zabbix_client

router = APIRouter(tags=["zabbix"])

_CACHE_TTL = 1800  # 30 min

_SEV_MAP = {
    5: "disaster",
    4: "high",
    3: "average",
    2: "warning",
    1: "information",
    0: "not_classified",
}


def _monday_of(dt: datetime) -> datetime:
    return (dt - timedelta(days=dt.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


@router.get("/zabbix/trends", response_model=ZabbixTrendsResponse)
async def get_zabbix_trends(
    weeks: int = Query(default=12, ge=4, le=52, description="Кількість тижнів для аналізу"),
) -> ZabbixTrendsResponse:
    """Weekly Zabbix problem counts grouped by severity."""
    cache_key = f"zabbix-trends-{weeks}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    now = datetime.now(timezone.utc)
    time_from = int((now - timedelta(weeks=weeks)).timestamp())
    time_till = int(now.timestamp())

    raw = await zabbix_client.get_problems_history(time_from, time_till)

    weekly: dict[str, dict] = {}
    for event in raw:
        try:
            clock = int(event.get("lastchange", 0))
            dt = datetime.utcfromtimestamp(clock)
        except (ValueError, TypeError, OSError):
            continue
        iso = dt.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        monday_ts = int(_monday_of(dt).timestamp())
        w = weekly.setdefault(week_key, {
            "week_key": week_key,
            "week_start": monday_ts,
            "disaster": 0,
            "high": 0,
            "average": 0,
            "warning": 0,
            "information": 0,
            "not_classified": 0,
            "total": 0,
        })
        sev_field = _SEV_MAP.get(int(event.get("priority", 0)), "not_classified")
        w[sev_field] += 1
        w["total"] += 1

    week_items = [
        ZabbixTrendWeek(**v)
        for v in sorted(weekly.values(), key=lambda x: x["week_start"])
    ]

    totals: dict[str, int] = {
        "disaster": 0, "high": 0, "average": 0, "warning": 0, "information": 0,
    }
    for w_item in week_items:
        for f in totals:
            totals[f] += getattr(w_item, f)
    total_all = sum(totals.values()) + sum(w.not_classified for w in week_items)

    result = ZabbixTrendsResponse(
        weeks=week_items,
        weeks_requested=weeks,
        total_problems=total_all,
        generated_at=now.isoformat(),
        **totals,
    )
    response_cache.put(cache_key, result)
    return result
