from fastapi import APIRouter, Query
from app.models.schemas import CmdbDayStats, CmdbStatsResponse, CmdbTypeStats
from app.services import cmdb_tracker, db

router = APIRouter(tags=["cmdb-stats"])

_CI_TYPE_LABELS = {
    "vm":       "Віртуальні машини",
    "physical": "Фізичні сервери",
    "cluster":  "Кластери",
}


@router.get("/cmdb-stats", response_model=CmdbStatsResponse)
async def get_cmdb_stats(days: int = Query(default=90, ge=1, le=365)):
    """Daily CMDB change statistics: added / updated / removed CIs per day."""
    raw_rows = cmdb_tracker.get_stats(days)

    # Group rows by date; aggregate across CI types into per-day totals
    by_date: dict[str, dict[str, int | list]] = {}
    type_rows: dict[str, list[dict]] = {}

    for row in raw_rows:
        d = row["date"]
        if d not in by_date:
            by_date[d] = {"added": 0, "updated": 0, "removed": 0, "total": 0}
            type_rows[d] = []
        by_date[d]["added"]   += row["added"]
        by_date[d]["updated"] += row["updated"]
        by_date[d]["removed"] += row["removed"]
        # total = sum of per-type counts (VMs + physical + clusters)
        by_date[d]["total"]   += row["total"]
        type_rows[d].append(row)

    days_list: list[CmdbDayStats] = []
    for date_str in sorted(by_date, reverse=True):
        agg = by_date[date_str]
        breakdown = [
            CmdbTypeStats(
                ci_type=r["ci_type"],
                added=r["added"],
                updated=r["updated"],
                removed=r["removed"],
                total=r["total"],
            )
            for r in sorted(type_rows[date_str], key=lambda x: x["ci_type"])
        ]
        days_list.append(CmdbDayStats(
            date=date_str,
            added=agg["added"],
            updated=agg["updated"],
            removed=agg["removed"],
            total=agg["total"],
            breakdown=breakdown,
        ))

    current_totals = cmdb_tracker.get_current_totals()
    synced_at_cached = db.get("vms")
    synced_at = synced_at_cached[1] if synced_at_cached else None

    return CmdbStatsResponse(
        days=days_list,
        current_totals=current_totals,
        synced_at=synced_at,
    )
