"""Fetches CMDB/Zabbix data and stores it in the local cache (db.py).

This is the only place that performs live Jira/Zabbix calls; API routers
read the results back from db.get(...).
"""
from __future__ import annotations

import asyncio
import logging
import time

from app.services import analyzer, db, jira_client, metrics_store, vcenter_client, zabbix_client

log = logging.getLogger(__name__)

# Resource periods offered in the UI — period stats are computed on-the-fly
# from metric_hourly for any of these.
PERIODS = (7, 14, 30, 90)

_BACKFILL_DAYS = 7  # raw history retention on this Zabbix instance is ~7 days
_HISTORY_LOOKBACK_SECONDS = 5 * 3600  # covers the 4h sync interval + margin

_VC_BACKFILL_DAYS = 90  # Level-1 daily archive retention (default 1 year)
_VC_INCREMENTAL_DAYS = 2

_in_progress = False


def is_in_progress() -> bool:
    return _in_progress


def get_synced_at() -> str | None:
    cached = db.get("vms")
    return cached[1] if cached else None


def _bucket_history(
    history: dict[str, list[tuple[int, float]]],
    item_meta: dict[str, tuple[str, str, str]],
) -> list[tuple[str, str, str, int, float, float, float, float]]:
    """Group raw (itemid -> [(clock, value), ...]) points into hourly buckets."""
    buckets: dict[tuple[str, str, int], list[float]] = {}
    for itemid, points in history.items():
        hid, key, _ = item_meta[itemid]
        for clock, value in points:
            hour_clock = clock - (clock % 3600)
            buckets.setdefault((hid, key, hour_clock), []).append(value)

    return [
        ("zabbix", hid, key, hour_clock, sum(vals) / len(vals), min(vals), max(vals), float(len(vals)))
        for (hid, key, hour_clock), vals in buckets.items()
    ]


async def _sync_metrics(hostids: list[str]) -> None:
    """Bring `metric_hourly` up to date for the given Zabbix hostids.

    New hosts (no stored history yet) are backfilled with ~7 days of raw
    history (the retention limit on this Zabbix instance). All hosts then
    get an incremental update from the last few hours of raw history.
    """
    if not hostids:
        return

    items = await zabbix_client.get_metric_items(hostids)
    if not items:
        return
    # Normalize all vfs.fs.size[*,pfree] variants (C:, /var, /home, …) to a
    # single canonical key so _bucket_history aggregates them per host/hour.
    def _normalize_key(key: str) -> str:
        if zabbix_client._DISK_FREE_SEARCH in key:
            return zabbix_client.ITEM_DISK_FREE_PCT
        for prefix in zabbix_client._VMWARE_HV_PREFIXES:
            if key.startswith(prefix):
                return prefix
        return key

    item_meta = {
        i["itemid"]: (i["hostid"], _normalize_key(i["key_"]), i["value_type"])
        for i in items
    }

    itemids_by_type: dict[str, list[str]] = {}
    for iid, (_, _, vt) in item_meta.items():
        itemids_by_type.setdefault(vt, []).append(iid)

    time_till = int(time.time())

    # Hosts with VMware HV items in Zabbix but no VMware CPU data in DB yet
    # (e.g. VMware item support was added after initial sync populated only disk data)
    host_has_vmware = {
        hid for _, (hid, key, _) in item_meta.items()
        if key == zabbix_client.ITEM_VMWARE_CPU_PCT
    }
    new_hostids = {
        h for h in set(hostids)
        if not metrics_store.has_data(h)
        or (h in host_has_vmware and not metrics_store.has_metric_data(h, zabbix_client.ITEM_VMWARE_CPU_PCT))
    }
    if new_hostids:
        backfill_by_type: dict[str, list[str]] = {}
        for iid, (hid, _, vt) in item_meta.items():
            if hid in new_hostids:
                backfill_by_type.setdefault(vt, []).append(iid)
        history = await zabbix_client.get_recent_history(
            backfill_by_type, time_till - _BACKFILL_DAYS * 86400, time_till
        )
        metrics_store.record_hours(_bucket_history(history, item_meta))
        log.info("Backfilled %d days of history for %d hosts (%d vmware-triggered)", _BACKFILL_DAYS, len(new_hostids), len(new_hostids & host_has_vmware))

    # Incremental update for everyone: bucket the last few hours of raw
    # history into metric_hourly (small window, fast).
    history = await zabbix_client.get_recent_history(
        itemids_by_type, time_till - _HISTORY_LOOKBACK_SECONDS, time_till
    )
    metrics_store.record_hours(_bucket_history(history, item_meta))

    metrics_store.prune()


def _vcenter_perf_rows(perf: dict[str, list[dict]]) -> list[tuple[str, str, str, int, float, float, float, float]]:
    """Flatten vCenter daily perf points into metric_hourly rows."""
    rows: list[tuple[str, str, str, int, float, float, float, float]] = []
    for moid, points in perf.items():
        for p in points:
            for metric, a, lo, hi in (
                (vcenter_client.ITEM_VC_CPU, "cpu_avg", "cpu_min", "cpu_max"),
                (vcenter_client.ITEM_VC_MEM, "mem_avg", "mem_min", "mem_max"),
                (vcenter_client.ITEM_VC_DISK_IO, "disk_io_avg", "disk_io_min", "disk_io_max"),
            ):
                avg = p.get(a)
                if avg is None:
                    continue
                lo_val = p.get(lo)
                hi_val = p.get(hi)
                rows.append((
                    "vcenter", moid, metric, p["timestamp"], avg,
                    lo_val if lo_val is not None else avg,
                    hi_val if hi_val is not None else avg,
                    1.0,
                ))
    return rows


async def _sync_vcenter_metrics(vm_moids: dict[str, str], vcenter_vms: list[dict]) -> None:
    """Bring `metric_hourly` (source='vcenter') up to date for matched VMs.

    New VMs (no stored history yet) are backfilled with the full Level-1
    daily archive (~90 days). All VMs then get a short incremental refresh,
    plus a point-in-time disk-space-used % sample for this sync cycle.
    """
    if not vm_moids:
        return

    moids = list(set(vm_moids.values()))

    new_moids = [m for m in moids if not metrics_store.has_data(m, source="vcenter")]
    if new_moids:
        perf = await vcenter_client.query_perf(new_moids, _VC_BACKFILL_DAYS)
        metrics_store.record_hours(_vcenter_perf_rows(perf))
        log.info("Backfilled %d days of vCenter perf for %d VMs", _VC_BACKFILL_DAYS, len(new_moids))

    perf = await vcenter_client.query_perf(moids, _VC_INCREMENTAL_DAYS)
    metrics_store.record_hours(_vcenter_perf_rows(perf))

    # Point-in-time disk-space-used % sample for this sync cycle.
    now_bucket = int(time.time()) // 3600 * 3600
    vc_by_moid = {v["moid"]: v for v in vcenter_vms}
    rows = []
    for moid in moids:
        pct = vc_by_moid.get(moid, {}).get("disk_used_pct")
        if pct is not None:
            rows.append(("vcenter", moid, vcenter_client.ITEM_VC_DISK_SPACE, now_bucket, pct, pct, pct, 1.0))
    metrics_store.record_hours(rows)


async def sync_all() -> dict:
    global _in_progress
    if _in_progress:
        return {"status": "already_running"}

    _in_progress = True
    try:
        vms, clusters, zabbix_hosts, vcenter_vms, physical_servers = await asyncio.gather(
            jira_client.get_all_vms(),
            jira_client.get_all_clusters(),
            zabbix_client.get_all_hosts(),
            vcenter_client.list_vms(),
            jira_client.get_all_physical_servers(),
        )

        zabbix_index = analyzer.build_zabbix_index(zabbix_hosts)

        # VM ↔ Zabbix matching
        vm_hostids: dict[str, str] = {}
        for vm in vms:
            zhost = analyzer.match_zabbix_host(vm, zabbix_index)
            if zhost:
                vm_hostids[vm["name"]] = zhost["hostid"]

        # Physical server ↔ Zabbix matching (same logic)
        phys_hostids: dict[str, str] = {}
        for srv in physical_servers:
            zhost = analyzer.match_zabbix_host(srv, zabbix_index)
            if zhost:
                phys_hostids[srv["name"]] = zhost["hostid"]

        # VM ↔ vCenter matching
        vcenter_index = analyzer.build_vcenter_index(vcenter_vms)
        ambiguous_keys, ambiguous_ips = analyzer.find_ambiguous_identifiers(vms)
        vm_moids: dict[str, str] = {}
        for vm in vms:
            vcvm = analyzer.match_vcenter_vm(vm, vcenter_index, ambiguous_keys, ambiguous_ips)
            if vcvm:
                vm_moids[vm["name"]] = vcvm["moid"]

        # Sync Zabbix metrics for VMs + physical servers together
        all_hostids = list(set(list(vm_hostids.values()) + list(phys_hostids.values())))
        await _sync_metrics(all_hostids)
        await _sync_vcenter_metrics(vm_moids, vcenter_vms)

        updated_at = db.set("vms", vms)
        db.set("clusters", clusters)
        db.set("zabbix_hosts", zabbix_hosts)
        db.set("vm_hostid_map", vm_hostids)
        db.set("vm_moid_map", vm_moids)
        db.set("physical_servers", physical_servers)
        db.set("phys_hostid_map", phys_hostids)

        log.info(
            "Sync completed: %d VMs, %d clusters, %d Zabbix hosts, %d VM-matched, "
            "%d vCenter-matched, %d phys-servers, %d phys-matched",
            len(vms), len(clusters), len(zabbix_hosts), len(vm_hostids),
            len(vm_moids), len(physical_servers), len(phys_hostids),
        )
        return {
            "status": "ok",
            "updated_at": updated_at,
            "vms": len(vms),
            "clusters": len(clusters),
            "zabbix_hosts": len(zabbix_hosts),
            "matched": len(vm_hostids),
            "vcenter_matched": len(vm_moids),
            "physical_servers": len(physical_servers),
            "phys_matched": len(phys_hostids),
        }
    except Exception:
        log.exception("Sync failed")
        raise
    finally:
        _in_progress = False
