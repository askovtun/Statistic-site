"""Local time-series store for Zabbix and vCenter resource metrics.

Hourly-bucketed (avg/min/max/num) values per (source, hostid, metric) are
kept in the `metric_hourly` table (see db.py). Period stats (7/14/30/90 days)
are computed on-the-fly via SQL aggregation, so the API request path never
makes a live Zabbix/vCenter call.
"""
from __future__ import annotations

import time

from app.services import db
from app.services.vcenter_client import (
    _EMPTY_VCENTER_METRICS,
    ITEM_VC_CPU,
    ITEM_VC_DISK_IO,
    ITEM_VC_DISK_SPACE,
    ITEM_VC_MEM,
)
from app.services.zabbix_client import (
    _EMPTY_METRICS,
    ITEM_CPU_UTIL,
    ITEM_DISK_FREE_PCT,
    ITEM_MEM_TOTAL,
    ITEM_MEM_USED,
    ITEM_VMWARE_CPU_PCT,
    ITEM_VMWARE_MEM_TOTAL,
    ITEM_VMWARE_MEM_USED,
)


def record_hours(rows: list[tuple[str, str, str, int, float, float, float, float]]) -> None:
    """Insert/replace hourly buckets: (source, hostid, metric, hour_clock, avg, min, max, num)."""
    if not rows:
        return
    with db._connect() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO metric_hourly "
            "(source, hostid, metric, hour_clock, avg, min, max, num) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def has_data(hostid: str, source: str = "zabbix") -> bool:
    with db._connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM metric_hourly WHERE source = ? AND hostid = ? LIMIT 1", (source, hostid)
        ).fetchone()
    return row is not None


def has_metric_data(hostid: str, metric: str, source: str = "zabbix") -> bool:
    with db._connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM metric_hourly WHERE source = ? AND hostid = ? AND metric = ? LIMIT 1",
            (source, hostid, metric),
        ).fetchone()
    return row is not None


def _aggregate(hostid: str, period_days: int, source: str) -> dict[str, dict[str, float]]:
    """Aggregate stored buckets into per-metric weighted-avg/min/max over the period."""
    cutoff = int(time.time()) - period_days * 86400
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT metric, SUM(avg * num) / SUM(num) AS w_avg, MIN(min) AS p_min, MAX(max) AS p_max "
            "FROM metric_hourly WHERE source = ? AND hostid = ? AND hour_clock >= ? AND num > 0 "
            "GROUP BY metric",
            (source, hostid, cutoff),
        ).fetchall()
    return {metric: {"avg": w_avg, "min": p_min, "max": p_max} for metric, w_avg, p_min, p_max in rows}


def get_period_metrics(hostid: str, period_days: int) -> dict[str, float | None]:
    """Aggregate stored Zabbix buckets into the period's avg/peak metrics."""
    vals = _aggregate(hostid, period_days, "zabbix")

    m = dict(_EMPTY_METRICS)

    if ITEM_CPU_UTIL in vals:
        m["cpu_pct"] = vals[ITEM_CPU_UTIL]["avg"]
        m["cpu_pct_max"] = vals[ITEM_CPU_UTIL]["max"]

    if ITEM_DISK_FREE_PCT in vals:
        m["disk_free_pct"] = vals[ITEM_DISK_FREE_PCT]["avg"]
        m["disk_free_pct_min"] = vals[ITEM_DISK_FREE_PCT]["min"]

    used = vals.get(ITEM_MEM_USED)
    total = vals.get(ITEM_MEM_TOTAL)
    if used and total and total["avg"]:
        # Total RAM is effectively constant, so the period-average total is
        # used as denominator for both the average and peak percentage.
        m["ram_pct"] = used["avg"] / total["avg"] * 100
        m["ram_pct_max"] = used["max"] / total["avg"] * 100

    # Fallback: VMware HV template items (ESXi/HV hosts monitored via VMware)
    if m["cpu_pct"] is None and ITEM_VMWARE_CPU_PCT in vals:
        m["cpu_pct"] = vals[ITEM_VMWARE_CPU_PCT]["avg"]
        m["cpu_pct_max"] = vals[ITEM_VMWARE_CPU_PCT]["max"]

    if m["ram_pct"] is None:
        vmware_used = vals.get(ITEM_VMWARE_MEM_USED)
        vmware_total = vals.get(ITEM_VMWARE_MEM_TOTAL)
        if vmware_used and vmware_total and vmware_total["avg"]:
            m["ram_pct"] = vmware_used["avg"] / vmware_total["avg"] * 100
            m["ram_pct_max"] = vmware_used["max"] / vmware_total["avg"] * 100

    return m


def get_vcenter_period_metrics(moid: str, period_days: int) -> dict[str, float | None]:
    """Aggregate stored vCenter buckets into the period's avg/peak metrics."""
    vals = _aggregate(moid, period_days, "vcenter")

    m = dict(_EMPTY_VCENTER_METRICS)

    if ITEM_VC_CPU in vals:
        m["vc_cpu_pct"] = vals[ITEM_VC_CPU]["avg"]
        m["vc_cpu_pct_max"] = vals[ITEM_VC_CPU]["max"]

    if ITEM_VC_MEM in vals:
        m["vc_ram_pct"] = vals[ITEM_VC_MEM]["avg"]
        m["vc_ram_pct_max"] = vals[ITEM_VC_MEM]["max"]

    if ITEM_VC_DISK_IO in vals:
        m["disk_io_kbps"] = vals[ITEM_VC_DISK_IO]["avg"]
        m["disk_io_kbps_max"] = vals[ITEM_VC_DISK_IO]["max"]

    if ITEM_VC_DISK_SPACE in vals:
        m["disk_used_pct"] = vals[ITEM_VC_DISK_SPACE]["avg"]
        m["disk_used_pct_max"] = vals[ITEM_VC_DISK_SPACE]["max"]

    return m


def _history_by_hour(hostid: str, period_days: int, source: str) -> dict[int, dict[str, dict[str, float]]]:
    cutoff = int(time.time()) - period_days * 86400
    with db._connect() as conn:
        rows = conn.execute(
            "SELECT hour_clock, metric, avg, min, max FROM metric_hourly "
            "WHERE source = ? AND hostid = ? AND hour_clock >= ? AND num > 0 ORDER BY hour_clock",
            (source, hostid, cutoff),
        ).fetchall()

    by_hour: dict[int, dict[str, dict[str, float]]] = {}
    for hour_clock, metric, avg, p_min, p_max in rows:
        by_hour.setdefault(hour_clock, {})[metric] = {"avg": avg, "min": p_min, "max": p_max}
    return by_hour


def get_history(hostid: str, period_days: int) -> list[dict[str, float | int | None]]:
    """Return hourly Zabbix time series points for charting: timestamp + per-metric %."""
    by_hour = _history_by_hour(hostid, period_days, "zabbix")

    points = []
    for hour_clock in sorted(by_hour):
        m = by_hour[hour_clock]
        cpu = m.get(ITEM_CPU_UTIL)
        used = m.get(ITEM_MEM_USED)
        total = m.get(ITEM_MEM_TOTAL)
        disk = m.get(ITEM_DISK_FREE_PCT)
        disk_free_val = disk["avg"] if disk else None

        # Fallback to VMware HV template items when standard agent items absent
        cpu_pct = cpu["avg"] if cpu else None
        if cpu_pct is None and ITEM_VMWARE_CPU_PCT in m:
            cpu_pct = m[ITEM_VMWARE_CPU_PCT]["avg"]

        ram_pct = used["avg"] / total["avg"] * 100 if used and total and total["avg"] else None
        if ram_pct is None:
            vmware_used = m.get(ITEM_VMWARE_MEM_USED)
            vmware_total = m.get(ITEM_VMWARE_MEM_TOTAL)
            if vmware_used and vmware_total and vmware_total["avg"]:
                ram_pct = vmware_used["avg"] / vmware_total["avg"] * 100

        points.append({
            "timestamp": hour_clock,
            "cpu_pct": cpu_pct,
            "ram_pct": ram_pct,
            "disk_free_pct": disk_free_val,
            "disk_used_pct": (100.0 - disk_free_val) if disk_free_val is not None else None,
        })
    return points


def get_vcenter_history(moid: str, period_days: int) -> list[dict[str, float | int | None]]:
    """Return daily vCenter time series points for charting."""
    by_hour = _history_by_hour(moid, period_days, "vcenter")

    points = []
    for hour_clock in sorted(by_hour):
        m = by_hour[hour_clock]
        cpu = m.get(ITEM_VC_CPU)
        mem = m.get(ITEM_VC_MEM)
        disk_space = m.get(ITEM_VC_DISK_SPACE)
        disk_io = m.get(ITEM_VC_DISK_IO)
        points.append({
            "timestamp": hour_clock,
            "vc_cpu_pct": cpu["avg"] if cpu else None,
            "vc_ram_pct": mem["avg"] if mem else None,
            "disk_used_pct": disk_space["avg"] if disk_space else None,
            "disk_io_kbps": disk_io["avg"] if disk_io else None,
        })
    return points


def get_cluster_daily_trend(moids: list[str], period_days: int) -> list[dict]:
    """Daily avg CPU/RAM % across a set of vCenter MOIDs (cluster-level trend).

    Each returned point is one calendar day; values are weighted averages across
    all VMs in the cluster that have data for that day.
    """
    if not moids:
        return []
    cutoff = int(time.time()) - period_days * 86400
    placeholders = ",".join("?" * len(moids))
    with db._connect() as conn:
        rows = conn.execute(
            f"SELECT (hour_clock / 86400) * 86400 AS day_ts, metric, "
            f"SUM(avg * num) / SUM(num) AS w_avg "
            f"FROM metric_hourly "
            f"WHERE source = 'vcenter' AND hostid IN ({placeholders}) "
            f"AND hour_clock >= ? AND num > 0 "
            f"GROUP BY day_ts, metric "
            f"ORDER BY day_ts",
            (*moids, cutoff),
        ).fetchall()

    by_day: dict[int, dict[str, float]] = {}
    for day_ts, metric, w_avg in rows:
        by_day.setdefault(int(day_ts), {})[metric] = w_avg

    points = []
    for day_ts in sorted(by_day):
        m = by_day[day_ts]
        points.append({
            "timestamp":   day_ts,
            "avg_cpu_pct": m.get(ITEM_VC_CPU),
            "avg_ram_pct": m.get(ITEM_VC_MEM),
        })
    return points


def prune(max_age_days: int = 95) -> None:
    cutoff = int(time.time()) - max_age_days * 86400
    with db._connect() as conn:
        conn.execute("DELETE FROM metric_hourly WHERE hour_clock < ?", (cutoff,))
        conn.commit()
