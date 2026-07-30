"""CMDB change tracking: diff CI snapshots and store daily statistics.

On each metadata sync, compares the current CMDB pull with the previously
stored snapshot to detect added/updated/removed CIs. Changes are accumulated
into today's row in cmdb_daily_stats; the snapshot is then updated.

First-ever sync: no previous snapshot exists → baseline is established,
stats row for today shows only the current total (added/updated/removed = 0).
"""
from __future__ import annotations

import logging
from datetime import date

from app.services import db

log = logging.getLogger(__name__)


def update(ci_type: str, current_items: list[dict]) -> dict:
    """Compute diff vs stored snapshot, write daily stats, update snapshot.

    Args:
        ci_type:       Label for this CI type ("vm", "physical", "cluster").
        current_items: List of dicts, each must have "jira_id", "name",
                       and optionally "jira_updated".

    Returns:
        dict with added/updated/removed/total counts from this sync's diff.
    """
    today = date.today().isoformat()

    # Build current state map: {jira_id: {name, updated}}
    curr: dict[str, dict] = {}
    for item in current_items:
        jid = str(item.get("jira_id") or "")
        if not jid:
            continue
        curr[jid] = {
            "name":    item.get("name") or "",
            "updated": item.get("jira_updated"),
        }

    with db._connect() as conn:
        # Load previous snapshot
        rows = conn.execute(
            "SELECT ci_id, ci_name, jira_updated FROM cmdb_ci_snapshot WHERE ci_type = ?",
            (ci_type,),
        ).fetchall()

    prev: dict[str, dict] = {
        r[0]: {"name": r[1], "updated": r[2]} for r in rows
    }

    is_first_sync = not prev

    if is_first_sync:
        # First run: just establish the baseline, don't record changes
        added = updated = removed = 0
    else:
        curr_ids  = set(curr)
        prev_ids  = set(prev)
        added     = len(curr_ids - prev_ids)
        removed   = len(prev_ids - curr_ids)
        updated   = sum(
            1 for cid in (curr_ids & prev_ids)
            if (
                curr[cid]["updated"] is not None
                and curr[cid]["updated"] != prev[cid]["updated"]
            )
        )

    total = len(curr)

    with db._connect() as conn:
        if not is_first_sync:
            # Accumulate today's changes (multiple syncs within a day sum up)
            conn.execute(
                "INSERT INTO cmdb_daily_stats (date, ci_type, added, updated, removed, total) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(date, ci_type) DO UPDATE SET "
                "added   = added   + excluded.added, "
                "updated = updated + excluded.updated, "
                "removed = removed + excluded.removed, "
                "total   = excluded.total",
                (today, ci_type, added, updated, removed, total),
            )
        else:
            # First sync: write baseline row (zero changes, just the total)
            conn.execute(
                "INSERT INTO cmdb_daily_stats (date, ci_type, added, updated, removed, total) "
                "VALUES (?, ?, 0, 0, 0, ?) "
                "ON CONFLICT(date, ci_type) DO UPDATE SET total = excluded.total",
                (today, ci_type, total),
            )

        # Update snapshot to current state
        conn.execute("DELETE FROM cmdb_ci_snapshot WHERE ci_type = ?", (ci_type,))
        if curr:
            conn.executemany(
                "INSERT INTO cmdb_ci_snapshot (ci_type, ci_id, ci_name, jira_updated) "
                "VALUES (?, ?, ?, ?)",
                [(ci_type, cid, d["name"], d["updated"]) for cid, d in curr.items()],
            )
        conn.commit()

    if not is_first_sync and (added or updated or removed):
        log.info(
            "CMDB diff [%s]: +%d added, ~%d updated, -%d removed, total=%d",
            ci_type, added, updated, removed, total,
        )

    return {"added": added, "updated": updated, "removed": removed, "total": total}


def get_stats(days: int = 90) -> list[dict]:
    """Return daily stats for the last `days` days, newest first."""
    from datetime import timedelta
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT date, ci_type, added, updated, removed, total "
            "FROM cmdb_daily_stats WHERE date >= ? ORDER BY date DESC",
            (cutoff,),
        ).fetchall()
    return [
        {"date": r[0], "ci_type": r[1], "added": r[2],
         "updated": r[3], "removed": r[4], "total": r[5]}
        for r in rows
    ]


def get_current_totals() -> dict[str, int]:
    """Return current snapshot counts per CI type."""
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT ci_type, COUNT(*) FROM cmdb_ci_snapshot GROUP BY ci_type"
        ).fetchall()
    return {r[0]: r[1] for r in rows}


def record_coverage(
    vm_total: int,
    vm_monitored: int,
    phys_total: int,
    phys_monitored: int,
) -> None:
    """Upsert today's monitoring coverage snapshot (called after each metadata sync)."""
    today = date.today().isoformat()
    with db._connect() as conn:
        conn.execute(
            "INSERT INTO monitoring_coverage_history "
            "(date, vm_total, vm_monitored, phys_total, phys_monitored) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET "
            "vm_total = excluded.vm_total, vm_monitored = excluded.vm_monitored, "
            "phys_total = excluded.phys_total, phys_monitored = excluded.phys_monitored",
            (today, vm_total, vm_monitored, phys_total, phys_monitored),
        )
        conn.commit()


def get_coverage_history(days: int = 90) -> list[dict]:
    """Return monitoring coverage history, newest first."""
    from datetime import timedelta
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT date, vm_total, vm_monitored, phys_total, phys_monitored "
            "FROM monitoring_coverage_history WHERE date >= ? ORDER BY date DESC",
            (cutoff,),
        ).fetchall()
    return [
        {
            "date": r[0],
            "vm_total": r[1],
            "vm_monitored": r[2],
            "phys_total": r[3],
            "phys_monitored": r[4],
        }
        for r in rows
    ]
