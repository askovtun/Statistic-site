"""Fetches CMDB/Zabbix data and stores it in the local cache (db.py).

This is the only place that performs live Jira/Zabbix calls; API routers
read the results back from db.get(...).

Sync strategy:
- CMDB/Zabbix/vCenter *inventory* (VMs, hosts, clusters) is re-fetched only
  when the cached copy is older than _METADATA_TTL_SECONDS (12 h by default),
  or when force_metadata=True (manual "Оновити дані" button).
- Zabbix *metrics* (metric_hourly) are always synced incrementally: new hosts
  get a 7-day backfill once, then every sync adds only the last 5 hours of
  raw history — one small Zabbix.history.get call per value type.
- vCenter *perf* is also incremental: new VMs get a 90-day backfill, then
  every metadata-refresh sync queries the last 2 days of daily rollups.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from app.services import analyzer, cmdb_tracker, db, jira_client, metrics_store, vcenter_client, zabbix_client

log = logging.getLogger(__name__)

# Resource periods offered in the UI — period stats are computed on-the-fly
# from metric_hourly for any of these.
PERIODS = (7, 14, 30, 90)

_BACKFILL_DAYS = 7  # raw history retention on this Zabbix instance is ~7 days
_HISTORY_LOOKBACK_SECONDS = 5 * 3600  # covers the 4h sync interval + margin

_VC_BACKFILL_DAYS = 90  # Level-1 daily archive retention (default 1 year)
_VC_INCREMENTAL_DAYS = 2

# CMDB/Zabbix/vCenter inventory is re-fetched at most this often.
# Between metadata refreshes, only Zabbix metric_hourly is updated (fast).
_METADATA_TTL_SECONDS = 12 * 3600

_in_progress = False


def _metadata_age_seconds() -> float:
    """Seconds since CMDB/Zabbix inventory was last fetched, or +inf if never."""
    cached = db.get("vms")
    if cached is None:
        return float("inf")
    _, updated_at_str = cached
    updated_at = datetime.fromisoformat(updated_at_str)
    return (datetime.now(timezone.utc) - updated_at).total_seconds()


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
    # Hosts that use vm.memory.utilization (direct %) instead of used/total pair
    # and haven't had it collected yet
    host_has_mem_util = {
        hid for _, (hid, key, _) in item_meta.items()
        if key == zabbix_client.ITEM_MEM_UTILIZATION
    }
    new_hostids = {
        h for h in set(hostids)
        if not metrics_store.has_data(h)
        or (h in host_has_vmware and not metrics_store.has_metric_data(h, zabbix_client.ITEM_VMWARE_CPU_PCT))
        or (h in host_has_mem_util and not metrics_store.has_metric_data(h, zabbix_client.ITEM_MEM_UTILIZATION))
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
        log.info(
            "Backfilled %d days for %d hosts (%d vmware-triggered, %d mem-util-triggered)",
            _BACKFILL_DAYS, len(new_hostids),
            len(new_hostids & host_has_vmware),
            len(new_hostids & host_has_mem_util),
        )

    # Incremental update for everyone: bucket the last few hours of raw
    # history into metric_hourly (small window, fast).
    history = await zabbix_client.get_recent_history(
        itemids_by_type, time_till - _HISTORY_LOOKBACK_SECONDS, time_till
    )
    metrics_store.record_hours(_bucket_history(history, item_meta))

    metrics_store.prune()


def _enrich_vm_clusters(
    vms: list[dict],
    vm_host_map: dict[str, str],
    vcenter_hosts: list[dict],
) -> list[dict]:
    """Fill missing cluster from vCenter host data.

    Priority: CMDB cluster → vCenter cluster → vCenter datacenter.
    """
    host_cluster: dict[str, str] = {}
    host_dc: dict[str, str] = {}
    for h in vcenter_hosts:
        moid = h["moid"]
        if h.get("cluster"):
            host_cluster[moid] = h["cluster"]
        if h.get("datacenter"):
            host_dc[moid] = h["datacenter"]

    result = []
    enriched_cluster = 0
    enriched_dc = 0
    for vm in vms:
        if vm.get("cluster"):
            result.append(vm)
            continue
        host_moid = vm_host_map.get(vm.get("name", ""))
        vc_cluster = host_cluster.get(host_moid) if host_moid else None
        if vc_cluster:
            vm = {**vm, "cluster": vc_cluster}
            enriched_cluster += 1
        else:
            dc = host_dc.get(host_moid) if host_moid else None
            if dc:
                vm = {**vm, "cluster": dc}
                enriched_dc += 1
        result.append(vm)
    if enriched_cluster or enriched_dc:
        log.info(
            "Enriched cluster for %d VMs from vCenter cluster, %d from Datacenter",
            enriched_cluster, enriched_dc,
        )
    return result


def _vcenter_perf_rows(perf: dict[str, list[dict]]) -> list[tuple[str, str, str, int, float, float, float, float]]:
    """Flatten vCenter daily perf points into metric_hourly rows."""
    rows: list[tuple[str, str, str, int, float, float, float, float]] = []
    for moid, points in perf.items():
        for p in points:
            for metric, a, lo, hi in (
                (vcenter_client.ITEM_VC_CPU, "cpu_avg", "cpu_min", "cpu_max"),
                (vcenter_client.ITEM_VC_MEM, "mem_avg", "mem_min", "mem_max"),
                (vcenter_client.ITEM_VC_DISK_IO, "disk_io_avg", "disk_io_min", "disk_io_max"),
                # Health metrics — single value (no meaningful min/max distinction)
                (vcenter_client.ITEM_VC_CPU_READY, "cpu_ready_ms", "cpu_ready_ms", "cpu_ready_ms"),
                (vcenter_client.ITEM_VC_MEM_BALLOON, "mem_balloon_kb", "mem_balloon_kb", "mem_balloon_kb"),
                (vcenter_client.ITEM_VC_MEM_SWAPPED, "mem_swapped_kb", "mem_swapped_kb", "mem_swapped_kb"),
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

    # Backfill if: no vcenter data at all, OR cpu.ready data is missing
    # (the cpu.ready counter was added after the initial backfill for some VMs)
    new_moids = [
        m for m in moids
        if not metrics_store.has_data(m, source="vcenter")
        or not metrics_store.has_metric_data(m, vcenter_client.ITEM_VC_CPU_READY, source="vcenter")
    ]
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


async def sync_all(force_metadata: bool = False) -> dict:
    """Run one sync cycle.

    force_metadata=True  — always re-fetch CMDB/Zabbix/vCenter inventory
                           (used when the user clicks "Оновити дані").
    force_metadata=False — re-fetch inventory only if cached copy is older
                           than _METADATA_TTL_SECONDS; otherwise load from
                           cache and only update metric_hourly (fast path).
    """
    global _in_progress
    if _in_progress:
        return {"status": "already_running"}

    _in_progress = True
    try:
        age = _metadata_age_seconds()
        do_metadata = force_metadata or age > _METADATA_TTL_SECONDS

        if do_metadata:
            vms, clusters, zabbix_hosts, vcenter_vms, vcenter_hosts, physical_servers = await asyncio.gather(
                jira_client.get_all_vms(),
                jira_client.get_all_clusters(),
                zabbix_client.get_all_hosts(),
                vcenter_client.list_vms(),
                vcenter_client.list_hosts(),
                jira_client.get_all_physical_servers(),
            )

            zabbix_index = analyzer.build_zabbix_index(zabbix_hosts)

            vm_hostids: dict[str, str] = {}
            for vm in vms:
                zhost = analyzer.match_zabbix_host(vm, zabbix_index)
                if zhost:
                    vm_hostids[vm["name"]] = zhost["hostid"]

            phys_hostids: dict[str, str] = {}
            for srv in physical_servers:
                zhost = analyzer.match_zabbix_host(srv, zabbix_index)
                if zhost:
                    phys_hostids[srv["name"]] = zhost["hostid"]

            vcenter_index = analyzer.build_vcenter_index(vcenter_vms)
            ambiguous_keys, ambiguous_ips = analyzer.find_ambiguous_identifiers(vms)
            vm_moids: dict[str, str] = {}
            for vm in vms:
                vcvm = analyzer.match_vcenter_vm(vm, vcenter_index, ambiguous_keys, ambiguous_ips)
                if vcvm:
                    vm_moids[vm["name"]] = vcvm["moid"]

            # vm_name → host_moid (where VM is currently running in vCenter)
            vc_by_moid = {v["moid"]: v for v in vcenter_vms}
            vm_host_map: dict[str, str] = {}
            for vm_name, vm_moid in vm_moids.items():
                host_moid = vc_by_moid.get(vm_moid, {}).get("runtime_host")
                if host_moid:
                    vm_host_map[vm_name] = host_moid

            # Enrich VMs: fill missing cluster from vCenter host data
            if vcenter_hosts and vm_host_map:
                vms = _enrich_vm_clusters(vms, vm_host_map, vcenter_hosts)

            # Track CMDB changes vs previous snapshot
            cmdb_tracker.update("vm",       vms)
            cmdb_tracker.update("physical", physical_servers)
            cmdb_tracker.update("cluster",  clusters)

            db.set("vms", vms)
            db.set("clusters", clusters)
            db.set("zabbix_hosts", zabbix_hosts)
            db.set("vm_hostid_map", vm_hostids)
            # Don't overwrite vCenter caches with empty data on transient vCenter failures
            if vcenter_vms:
                db.set("vm_moid_map", vm_moids)
                db.set("vcenter_vms", vcenter_vms)
                db.set("vm_host_map", vm_host_map)
            else:
                log.warning("vCenter list_vms returned empty — keeping previous vm_moid_map/vcenter_vms in cache")
            if vcenter_hosts:
                db.set("vcenter_hosts", vcenter_hosts)
            else:
                log.warning("vCenter list_hosts returned empty — keeping previous vcenter_hosts in cache")
            db.set("physical_servers", physical_servers)
            db.set("phys_hostid_map", phys_hostids)

            log.info(
                "Metadata refresh: %d VMs, %d clusters, %d Zabbix hosts, "
                "%d VM→Zabbix, %d VM→vCenter, %d vCenter hosts, %d VM→host, %d phys, %d phys→Zabbix",
                len(vms), len(clusters), len(zabbix_hosts),
                len(vm_hostids), len(vm_moids), len(vcenter_hosts), len(vm_host_map),
                len(physical_servers), len(phys_hostids),
            )
        else:
            # Cache hit — skip all Jira/Zabbix/vCenter inventory calls.
            # Only metric_hourly will be updated below.
            vms = db.get("vms")[0]  # type: ignore[index]
            vm_hostids = db.get("vm_hostid_map")[0]  # type: ignore[index]
            _phys = db.get("phys_hostid_map")
            phys_hostids = _phys[0] if _phys else {}
            _moids = db.get("vm_moid_map")
            vm_moids = _moids[0] if _moids else {}
            _vm_host = db.get("vm_host_map")
            vm_host_map = _vm_host[0] if _vm_host else {}
            vcenter_hosts = []
            vcenter_vms = []  # point-in-time disk sample skipped; perf still runs
            log.info(
                "Metadata cache hit (age %.1fh < %.0fh TTL) — incremental metric sync only",
                age / 3600, _METADATA_TTL_SECONDS / 3600,
            )

        all_hostids = list(set(list(vm_hostids.values()) + list(phys_hostids.values())))
        await _sync_metrics(all_hostids)
        await _sync_vcenter_metrics(vm_moids, vcenter_vms)

        log.info(
            "Sync done: metadata_refreshed=%s, %d Zabbix hosts, %d vCenter VMs",
            do_metadata, len(all_hostids), len(vm_moids),
        )
        return {
            "status": "ok",
            "metadata_refreshed": do_metadata,
            "vms": len(vms),
            "matched": len(vm_hostids),
            "vcenter_matched": len(vm_moids),
        }
    except Exception:
        log.exception("Sync failed")
        raise
    finally:
        _in_progress = False
