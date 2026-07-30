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
    ITEM_VC_CPU_READY,
    ITEM_VC_DISK_IO,
    ITEM_VC_DISK_SPACE,
    ITEM_VC_MEM,
    ITEM_VC_MEM_BALLOON,
    ITEM_VC_MEM_SWAPPED,
)
from app.services.zabbix_client import (
    _EMPTY_METRICS,
    ITEM_CPU_UTIL,
    ITEM_DISK_FREE_PCT,
    ITEM_MEM_TOTAL,
    ITEM_MEM_USED,
    ITEM_MEM_UTILIZATION,
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

    # Fallback: vm.memory.utilization — direct % item (used instead of used/total pair
    # on some hosts, e.g. FreeBSD/custom templates that lack vm.memory.size[used])
    if m["ram_pct"] is None and ITEM_MEM_UTILIZATION in vals:
        m["ram_pct"] = vals[ITEM_MEM_UTILIZATION]["avg"]
        m["ram_pct_max"] = vals[ITEM_MEM_UTILIZATION]["max"]

    return m


def get_trends_and_availability_batch(
    hostids: list[str], period_days: int
) -> dict[str, dict]:
    """Batch trend + availability for all matched hosts.

    Returns {hostid: {trend_cpu_delta, trend_ram_delta, availability_pct}}.
    Availability = fraction of expected hourly buckets that actually have CPU data.
    Trend = current-period weighted-avg minus previous-period weighted-avg.
    """
    if not hostids:
        return {}

    now = int(time.time())
    curr_from = now - period_days * 86400
    prev_from = now - period_days * 2 * 86400
    placeholders = ",".join("?" * len(hostids))

    with db._connect() as conn:
        curr_rows = conn.execute(
            f"SELECT hostid, metric, SUM(avg*num)/SUM(num), COUNT(*) "
            f"FROM metric_hourly WHERE source='zabbix' AND hostid IN ({placeholders}) "
            f"AND hour_clock>=? AND num>0 GROUP BY hostid, metric",
            [*hostids, curr_from],
        ).fetchall()
        prev_rows = conn.execute(
            f"SELECT hostid, metric, SUM(avg*num)/SUM(num) "
            f"FROM metric_hourly WHERE source='zabbix' AND hostid IN ({placeholders}) "
            f"AND hour_clock>=? AND hour_clock<? AND num>0 GROUP BY hostid, metric",
            [*hostids, prev_from, curr_from],
        ).fetchall()

    # curr: {hostid: {metric: {"avg": float, "count": int}}}
    curr: dict[str, dict[str, dict]] = {}
    for hostid, metric, w_avg, cnt in curr_rows:
        curr.setdefault(hostid, {})[metric] = {"avg": w_avg, "count": cnt}

    # prev: {hostid: {metric: float}}
    prev: dict[str, dict[str, float]] = {}
    for hostid, metric, w_avg in prev_rows:
        prev.setdefault(hostid, {})[metric] = w_avg

    def _ram_pct(vals: dict[str, dict]) -> float | None:
        used = vals.get(ITEM_MEM_USED)
        total = vals.get(ITEM_MEM_TOTAL)
        if used and total and total.get("avg"):
            return used["avg"] / total["avg"] * 100
        util = vals.get(ITEM_MEM_UTILIZATION)
        return util["avg"] if util else None

    def _ram_pct_prev(vals: dict[str, float]) -> float | None:
        used = vals.get(ITEM_MEM_USED)
        total = vals.get(ITEM_MEM_TOTAL)
        if used is not None and total:
            return used / total * 100
        return vals.get(ITEM_MEM_UTILIZATION)

    result: dict[str, dict] = {}
    expected_buckets = period_days * 24

    for hostid in hostids:
        c = curr.get(hostid, {})
        p = prev.get(hostid, {})

        cpu_info = c.get(ITEM_CPU_UTIL)
        cpu_count = cpu_info["count"] if cpu_info else 0
        avail = round(min(100.0, cpu_count / expected_buckets * 100), 1) if cpu_count else None

        curr_cpu = (cpu_info or {}).get("avg")
        prev_cpu = p.get(ITEM_CPU_UTIL)
        trend_cpu = round(curr_cpu - prev_cpu, 1) if curr_cpu is not None and prev_cpu is not None else None

        curr_ram = _ram_pct(c)
        prev_ram = _ram_pct_prev(p)
        trend_ram = round(curr_ram - prev_ram, 1) if curr_ram is not None and prev_ram is not None else None

        result[hostid] = {
            "trend_cpu_delta": trend_cpu,
            "trend_ram_delta": trend_ram,
            "availability_pct": avail,
        }

    return result


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

    # cpu.ready: daily summation in ms → %
    # Formula: sum_ms_per_day / (4320 samples × 20000ms) × 100 = sum_ms / 864000
    if ITEM_VC_CPU_READY in vals:
        raw = vals[ITEM_VC_CPU_READY]["avg"]
        m["cpu_ready_pct"] = raw / 864000.0 if raw is not None else None

    if ITEM_VC_MEM_BALLOON in vals:
        m["mem_balloon_kb"] = vals[ITEM_VC_MEM_BALLOON]["avg"]

    if ITEM_VC_MEM_SWAPPED in vals:
        m["mem_swapped_kb"] = vals[ITEM_VC_MEM_SWAPPED]["avg"]

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
        if ram_pct is None and ITEM_MEM_UTILIZATION in m:
            ram_pct = m[ITEM_MEM_UTILIZATION]["avg"]

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


def get_vm_cpu_ready_by_host(
    vm_moid_map: dict[str, str],
    vm_host_map: dict[str, str],
    period_days: int,
) -> dict[str, dict]:
    """Aggregate VM CPU Ready % per ESXi host (single SQL query).

    Returns {host_moid: {vm_count, vms_with_data, avg_cpu_ready_pct, max_cpu_ready_pct}}.
    """
    # vm_name → vm_moid, vm_name → host_moid
    moid_to_host: dict[str, str] = {}
    for vm_name, vm_moid in vm_moid_map.items():
        host_moid = vm_host_map.get(vm_name)
        if host_moid:
            moid_to_host[vm_moid] = host_moid

    host_vm_count: dict[str, int] = {}
    for host_moid in moid_to_host.values():
        host_vm_count[host_moid] = host_vm_count.get(host_moid, 0) + 1

    if not moid_to_host:
        return {}

    cutoff = int(time.time()) - period_days * 86400
    moids = list(moid_to_host.keys())
    placeholders = ",".join("?" * len(moids))
    with db._connect() as conn:
        rows = conn.execute(
            f"SELECT hostid, SUM(avg * num) / SUM(num) AS w_avg "
            f"FROM metric_hourly "
            f"WHERE source = 'vcenter' AND metric = ? AND hostid IN ({placeholders}) "
            f"AND hour_clock >= ? AND num > 0 GROUP BY hostid",
            [ITEM_VC_CPU_READY, *moids, cutoff],
        ).fetchall()

    # /864000 converts daily summation ms → %
    vm_ready: dict[str, float] = {r[0]: r[1] / 864000.0 for r in rows}

    host_ready: dict[str, list[float]] = {}
    for vm_moid, host_moid in moid_to_host.items():
        pct = vm_ready.get(vm_moid)
        if pct is not None:
            host_ready.setdefault(host_moid, []).append(pct)

    result: dict[str, dict] = {}
    all_host_moids = set(moid_to_host.values())
    for host_moid in all_host_moids:
        pcts = host_ready.get(host_moid, [])
        result[host_moid] = {
            "vm_count": host_vm_count.get(host_moid, 0),
            "vms_with_data": len(pcts),
            "avg_cpu_ready_pct": round(sum(pcts) / len(pcts), 2) if pcts else None,
            "max_cpu_ready_pct": round(max(pcts), 2) if pcts else None,
        }
    return result


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


def get_cluster_capacity_metrics(moids: list[str], period_days: int) -> dict:
    """Weighted-average and peak CPU/RAM % for a set of vCenter MOIDs over period_days."""
    if not moids:
        return {}
    cutoff = int(time.time()) - period_days * 86400
    placeholders = ",".join("?" * len(moids))
    with db._connect() as conn:
        rows = conn.execute(
            f"SELECT metric, SUM(avg*num)/SUM(num) AS w_avg, MAX(max) AS peak "
            f"FROM metric_hourly WHERE source='vcenter' AND hostid IN ({placeholders}) "
            f"AND hour_clock>=? AND num>0 GROUP BY metric",
            (*moids, cutoff),
        ).fetchall()
    result: dict[str, float | None] = {}
    for metric, w_avg, peak in rows:
        if metric == ITEM_VC_CPU:
            result["avg_cpu_pct"] = round(w_avg, 1) if w_avg is not None else None
            result["peak_cpu_pct"] = round(peak, 1) if peak is not None else None
        elif metric == ITEM_VC_MEM:
            result["avg_ram_pct"] = round(w_avg, 1) if w_avg is not None else None
            result["peak_ram_pct"] = round(peak, 1) if peak is not None else None
    return result


def get_period_metrics_batch(
    hostid_map: dict[str, str],
    period_days: int,
) -> dict[str, dict]:
    """Batch version of get_period_metrics — one SQL query for all VMs.

    Returns {vm_name: dict} with the same keys as get_period_metrics().
    VMs with no data in the period are absent from the result.
    """
    if not hostid_map:
        return {}

    cutoff = int(time.time()) - period_days * 86400
    inv = {v: k for k, v in hostid_map.items()}
    hostids = list(hostid_map.values())
    ph = ",".join("?" * len(hostids))

    with db._connect() as conn:
        rows = conn.execute(
            f"SELECT hostid, metric, SUM(avg*num)/SUM(num), MIN(min), MAX(max) "
            f"FROM metric_hourly "
            f"WHERE source='zabbix' AND hostid IN ({ph}) "
            f"AND hour_clock>=? AND num>0 GROUP BY hostid, metric",
            [*hostids, cutoff],
        ).fetchall()

    by_vm: dict[str, dict[str, dict]] = {}
    for hostid, metric, w_avg, p_min, p_max in rows:
        vm_name = inv.get(hostid)
        if vm_name:
            by_vm.setdefault(vm_name, {})[metric] = {"avg": w_avg, "min": p_min, "max": p_max}

    result: dict[str, dict] = {}
    for vm_name, vals in by_vm.items():
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
            m["ram_pct"] = used["avg"] / total["avg"] * 100
            m["ram_pct_max"] = used["max"] / total["avg"] * 100

        if m["cpu_pct"] is None and ITEM_VMWARE_CPU_PCT in vals:
            m["cpu_pct"] = vals[ITEM_VMWARE_CPU_PCT]["avg"]
            m["cpu_pct_max"] = vals[ITEM_VMWARE_CPU_PCT]["max"]

        if m["ram_pct"] is None:
            vmw_used = vals.get(ITEM_VMWARE_MEM_USED)
            vmw_total = vals.get(ITEM_VMWARE_MEM_TOTAL)
            if vmw_used and vmw_total and vmw_total["avg"]:
                m["ram_pct"] = vmw_used["avg"] / vmw_total["avg"] * 100
                m["ram_pct_max"] = vmw_used["max"] / vmw_total["avg"] * 100

        if m["ram_pct"] is None and ITEM_MEM_UTILIZATION in vals:
            m["ram_pct"] = vals[ITEM_MEM_UTILIZATION]["avg"]
            m["ram_pct_max"] = vals[ITEM_MEM_UTILIZATION]["max"]

        result[vm_name] = m

    return result


def get_vcenter_period_metrics_batch(
    moid_map: dict[str, str],
    period_days: int,
) -> dict[str, dict]:
    """Batch version of get_vcenter_period_metrics — one SQL query for all VMs."""
    if not moid_map:
        return {}

    cutoff = int(time.time()) - period_days * 86400
    inv = {v: k for k, v in moid_map.items()}
    moids = list(moid_map.values())
    ph = ",".join("?" * len(moids))

    with db._connect() as conn:
        rows = conn.execute(
            f"SELECT hostid, metric, SUM(avg*num)/SUM(num), MIN(min), MAX(max) "
            f"FROM metric_hourly "
            f"WHERE source='vcenter' AND hostid IN ({ph}) "
            f"AND hour_clock>=? AND num>0 GROUP BY hostid, metric",
            [*moids, cutoff],
        ).fetchall()

    by_vc: dict[str, dict[str, dict]] = {}
    for moid, metric, w_avg, p_min, p_max in rows:
        vm_name = inv.get(moid)
        if vm_name:
            by_vc.setdefault(vm_name, {})[metric] = {"avg": w_avg, "min": p_min, "max": p_max}

    result: dict[str, dict] = {}
    for vm_name, vals in by_vc.items():
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

        if ITEM_VC_CPU_READY in vals:
            raw = vals[ITEM_VC_CPU_READY]["avg"]
            m["cpu_ready_pct"] = raw / 864000.0 if raw is not None else None

        if ITEM_VC_MEM_BALLOON in vals:
            m["mem_balloon_kb"] = vals[ITEM_VC_MEM_BALLOON]["avg"]

        if ITEM_VC_MEM_SWAPPED in vals:
            m["mem_swapped_kb"] = vals[ITEM_VC_MEM_SWAPPED]["avg"]

        result[vm_name] = m

    return result


def get_zombie_metrics_batch(
    hostid_map: dict[str, str],
    moid_map: dict[str, str],
    period_days: int,
) -> dict[str, dict]:
    """Aggregate Zabbix+vCenter metrics for all VMs in two SQL queries instead of N.

    Returns {vm_name: {
        cpu_avg, cpu_max, ram_avg, ram_max, coverage_pct,   # from Zabbix
        vc_cpu_avg, vc_cpu_max, vc_ram_avg, vc_ram_max,    # from vCenter
    }}.
    Values are floats or absent (key not present in sub-dict).
    """
    cutoff = int(time.time()) - period_days * 86400
    expected_buckets = period_days * 24
    result: dict[str, dict] = {}

    # ── Zabbix: one query for all VMs ─────────────────────────────────────────
    if hostid_map:
        inv = {v: k for k, v in hostid_map.items()}
        hostids = list(hostid_map.values())
        ph = ",".join("?" * len(hostids))
        with db._connect() as conn:
            rows = conn.execute(
                f"SELECT hostid, metric, SUM(avg*num)/SUM(num), MAX(max), COUNT(*) "
                f"FROM metric_hourly "
                f"WHERE source='zabbix' AND hostid IN ({ph}) "
                f"AND hour_clock>=? AND num>0 GROUP BY hostid, metric",
                [*hostids, cutoff],
            ).fetchall()

        by_vm: dict[str, dict[str, tuple]] = {}
        for hostid, metric, w_avg, p_max, cnt in rows:
            vm_name = inv.get(hostid)
            if vm_name:
                by_vm.setdefault(vm_name, {})[metric] = (w_avg, p_max, cnt)

        for vm_name, m in by_vm.items():
            d: dict = {}
            cpu_item = m.get(ITEM_CPU_UTIL) or m.get(ITEM_VMWARE_CPU_PCT)
            if cpu_item:
                d["cpu_avg"] = cpu_item[0]
                d["cpu_max"] = cpu_item[1]
                d["coverage_pct"] = round(min(100.0, cpu_item[2] / expected_buckets * 100), 1)

            used = m.get(ITEM_MEM_USED)
            total = m.get(ITEM_MEM_TOTAL)
            if used and total and total[0]:
                d["ram_avg"] = used[0] / total[0] * 100
                d["ram_max"] = used[1] / total[0] * 100
            elif m.get(ITEM_MEM_UTILIZATION):
                util = m[ITEM_MEM_UTILIZATION]
                d["ram_avg"] = util[0]
                d["ram_max"] = util[1]
            elif m.get(ITEM_VMWARE_MEM_USED) and m.get(ITEM_VMWARE_MEM_TOTAL):
                vmu = m[ITEM_VMWARE_MEM_USED]
                vmt = m[ITEM_VMWARE_MEM_TOTAL]
                if vmt[0]:
                    d["ram_avg"] = vmu[0] / vmt[0] * 100
                    d["ram_max"] = vmu[1] / vmt[0] * 100

            result[vm_name] = d

    # ── vCenter: one query for all VMs ────────────────────────────────────────
    if moid_map:
        inv_vc = {v: k for k, v in moid_map.items()}
        moids = list(moid_map.values())
        ph = ",".join("?" * len(moids))
        with db._connect() as conn:
            rows = conn.execute(
                f"SELECT hostid, metric, SUM(avg*num)/SUM(num), MAX(max) "
                f"FROM metric_hourly "
                f"WHERE source='vcenter' AND hostid IN ({ph}) "
                f"AND hour_clock>=? AND num>0 GROUP BY hostid, metric",
                [*moids, cutoff],
            ).fetchall()

        by_vc: dict[str, dict[str, tuple]] = {}
        for moid, metric, w_avg, p_max in rows:
            vm_name = inv_vc.get(moid)
            if vm_name:
                by_vc.setdefault(vm_name, {})[metric] = (w_avg, p_max)

        for vm_name, m in by_vc.items():
            vc: dict = {}
            if ITEM_VC_CPU in m:
                vc["vc_cpu_avg"] = m[ITEM_VC_CPU][0]
                vc["vc_cpu_max"] = m[ITEM_VC_CPU][1]
            if ITEM_VC_MEM in m:
                vc["vc_ram_avg"] = m[ITEM_VC_MEM][0]
                vc["vc_ram_max"] = m[ITEM_VC_MEM][1]
            result.setdefault(vm_name, {}).update(vc)

    return result


def prune(max_age_days: int = 95) -> None:
    cutoff = int(time.time()) - max_age_days * 86400
    with db._connect() as conn:
        conn.execute("DELETE FROM metric_hourly WHERE hour_clock < ?", (cutoff,))
        conn.commit()
