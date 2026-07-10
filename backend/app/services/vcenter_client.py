"""vCenter (vSphere) client via pyVmomi.

pyVmomi is a synchronous SOAP client, so every call here is wrapped in
asyncio.to_thread(...) to match the async style of the other clients.

If settings.vcenter_host is empty, all functions return empty results —
vCenter metrics are then simply absent everywhere downstream.
"""
from __future__ import annotations

import asyncio
import logging
import ssl
from datetime import datetime, timedelta, timezone
from typing import Iterator

from pyVim.connect import Disconnect, SmartConnect
from pyVmomi import vim

from app.config import settings

log = logging.getLogger(__name__)

# Synthetic metric keys stored in metric_hourly (source='vcenter')
ITEM_VC_CPU = "vc.cpu.usage"
ITEM_VC_MEM = "vc.mem.usage"
ITEM_VC_DISK_IO = "vc.disk.usage"
ITEM_VC_DISK_SPACE = "vc.disk.space.used_pct"
ITEM_VC_CPU_READY = "vc.cpu.ready"    # summation ms/day; /864000 → %
ITEM_VC_MEM_BALLOON = "vc.mem.balloon"  # KB (average)
ITEM_VC_MEM_SWAPPED = "vc.mem.swapped"  # KB (average)

_EMPTY_VCENTER_METRICS = {
    "vc_cpu_pct": None, "vc_cpu_pct_max": None,
    "vc_ram_pct": None, "vc_ram_pct_max": None,
    "disk_used_pct": None, "disk_used_pct_max": None,
    "disk_io_kbps": None, "disk_io_kbps_max": None,
    "cpu_ready_pct": None,
    "mem_balloon_kb": None,
    "mem_swapped_kb": None,
}

# cpu.usage/mem.usage are reported in hundredths of a percent (5000 = 50.00%)
_PCT_SCALE = 100.0

_COUNTERS = {
    "cpu.usage": ("average", "minimum", "maximum"),
    "mem.usage": ("average", "minimum", "maximum"),
    "disk.usage": ("average", "minimum", "maximum"),
    # Scheduling contention (summation ms per 20s interval per day)
    "cpu.ready": ("summation",),
    # Memory pressure indicators (KB, average)
    "mem.vmmemctl": ("average",),
    "mem.swapped": ("average",),
}

# vCenter's vpxd.stats.maxQueryMetrics setting (default 64) caps the total
# number of metrics (counters x entities) returned by a single QueryPerf
# call, so the entity batch size must shrink as the metric-id count grows.
_MAX_QUERY_METRICS = 64


def _batched(seq: list, n: int) -> Iterator[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def _connect():
    if not settings.vcenter_host:
        return None
    context = None if settings.vcenter_verify_ssl else ssl._create_unverified_context()
    return SmartConnect(
        host=settings.vcenter_host,
        user=settings.vcenter_user,
        pwd=settings.vcenter_password,
        sslContext=context,
    )


def _list_vms_sync() -> list[dict]:
    """VM inventory: name/guest identity + current disk-space usage % + power state."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        out = []
        for vm in view.view:
            s = vm.summary
            if not s or not s.config:
                continue
            committed = (s.storage.committed or 0) if s.storage else 0
            uncommitted = (s.storage.uncommitted or 0) if s.storage else 0
            total = committed + uncommitted
            guest = vm.guest
            runtime = s.runtime
            boot_time = None
            if runtime and runtime.bootTime is not None:
                try:
                    boot_time = runtime.bootTime.isoformat()
                except Exception:
                    pass
            runtime_host = None
            if runtime and runtime.host is not None:
                try:
                    runtime_host = runtime.host._moId
                except Exception:
                    pass
            # OS: prefer guest-reported (VMware Tools inside VM), fall back to config
            guest_os = (guest.guestFullName or None) if guest else None
            config_os = (s.config.guestFullName or None) if s.config else None
            out.append({
                "moid": vm._moId,
                "name": s.config.name,
                "guest_hostname": guest.hostName if guest else None,
                "guest_ip": guest.ipAddress if guest else None,
                "disk_used_pct": (committed / total * 100) if total else None,
                "power_state": str(runtime.powerState) if runtime else "unknown",
                "boot_time": boot_time,
                "runtime_host": runtime_host,
                "os_full_name": guest_os or config_os,
                "os_from_tools": bool(guest_os),
            })
        view.Destroy()
        return out
    finally:
        Disconnect(si)


def _counter_ids(perf_manager) -> dict[tuple[str, str], int]:
    """Map (counter group.name, rollupType) -> counterId."""
    return {
        (f"{c.groupInfo.key}.{c.nameInfo.key}", c.rollupType): c.key
        for c in perf_manager.perfCounter
    }


def _query_perf_sync(moids: list[str], days: int) -> dict[str, list[dict]]:
    """Daily CPU/RAM/disk.usage/cpu.ready/mem.balloon perf for the last `days` days.

    Uses the Level-1 archive interval (86400s = 1 day), which by default
    retains rollups for 1 year.
    """
    si = _connect()
    if si is None:
        return {}
    try:
        content = si.RetrieveContent()
        pm = content.perfManager
        cids = _counter_ids(pm)
        metric_ids = [
            vim.PerformanceManager.MetricId(counterId=cids[(counter, rollup)], instance="")
            for counter, rollups in _COUNTERS.items()
            for rollup in rollups
            if (counter, rollup) in cids
        ]

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        batch_size = max(1, _MAX_QUERY_METRICS // max(1, len(metric_ids)))

        result: dict[str, list[dict]] = {}
        for chunk in _batched(moids, batch_size):
            specs = [
                vim.PerformanceManager.QuerySpec(
                    entity=vim.VirtualMachine(moid, si._stub),
                    metricId=metric_ids,
                    intervalId=86400,
                    startTime=start,
                    endTime=end,
                )
                for moid in chunk
            ]
            for em in pm.QueryPerf(querySpec=specs):
                timestamps = [int(s.timestamp.timestamp()) for s in em.sampleInfo]
                series = {v.id.counterId: list(v.value) for v in em.value}

                def val(i: int, counter: str, rollup: str, scale: float = 1.0) -> float | None:
                    vals = series.get(cids.get((counter, rollup)))
                    if not vals or vals[i] == -1:
                        return None
                    return vals[i] / scale

                result[em.entity._moId] = [
                    {
                        "timestamp": ts,
                        "cpu_avg": val(i, "cpu.usage", "average", _PCT_SCALE),
                        "cpu_min": val(i, "cpu.usage", "minimum", _PCT_SCALE),
                        "cpu_max": val(i, "cpu.usage", "maximum", _PCT_SCALE),
                        "mem_avg": val(i, "mem.usage", "average", _PCT_SCALE),
                        "mem_min": val(i, "mem.usage", "minimum", _PCT_SCALE),
                        "mem_max": val(i, "mem.usage", "maximum", _PCT_SCALE),
                        "disk_io_avg": val(i, "disk.usage", "average"),
                        "disk_io_min": val(i, "disk.usage", "minimum"),
                        "disk_io_max": val(i, "disk.usage", "maximum"),
                        "cpu_ready_ms": val(i, "cpu.ready", "summation"),
                        "mem_balloon_kb": val(i, "mem.vmmemctl", "average"),
                        "mem_swapped_kb": val(i, "mem.swapped", "average"),
                    }
                    for i, ts in enumerate(timestamps)
                ]
        return result
    finally:
        Disconnect(si)


def _traverse_snapshots(snap_list, vm_name: str) -> list[dict]:
    """Recursively collect all snapshots from a snapshot tree."""
    result = []
    for snap in (snap_list or []):
        result.append({
            "vm_name": vm_name,
            "name": snap.name,
            "description": snap.description or "",
            "created_at": snap.createTime.isoformat(),
        })
        result.extend(_traverse_snapshots(snap.childSnapshotList, vm_name))
    return result


def _list_snapshots_sync() -> list[dict]:
    """Fetch all VM snapshots via PropertyCollector (single batch SOAP call)."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        pc = content.propertyCollector

        # Traverse: rootFolder → DC → vmFolder → Folder → VM (recursive)
        traversal = [
            vim.TraversalSpec(
                name="visitFolders",
                type=vim.Folder,
                path="childEntity",
                skip=False,
                selectSet=[
                    vim.SelectionSpec(name="visitFolders"),
                    vim.SelectionSpec(name="visitDC"),
                    vim.SelectionSpec(name="visitVApp"),
                ],
            ),
            vim.TraversalSpec(
                name="visitDC",
                type=vim.Datacenter,
                path="vmFolder",
                skip=False,
                selectSet=[vim.SelectionSpec(name="visitFolders")],
            ),
            vim.TraversalSpec(
                name="visitVApp",
                type=vim.VirtualApp,
                path="vm",
                skip=False,
            ),
        ]

        filter_spec = vim.PropertyFilterSpec(
            objectSet=[vim.ObjectSpec(obj=content.rootFolder, skip=True, selectSet=traversal)],
            propSet=[vim.PropertySpec(type=vim.VirtualMachine, all=False, pathSet=["name", "snapshot"])],
        )

        props = pc.RetrieveContents([filter_spec])

        now = datetime.now(timezone.utc)
        snapshots: list[dict] = []
        for obj in props:
            vm_name = next((p.val for p in obj.propSet if p.name == "name"), None)
            snap_prop = next((p.val for p in obj.propSet if p.name == "snapshot"), None)
            if not vm_name or not snap_prop or not snap_prop.rootSnapshotList:
                continue
            for s in _traverse_snapshots(snap_prop.rootSnapshotList, vm_name):
                created = datetime.fromisoformat(s["created_at"])
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                snapshots.append({**s, "age_days": (now - created).days})
        return snapshots
    finally:
        Disconnect(si)


async def list_vms() -> list[dict]:
    try:
        return await asyncio.to_thread(_list_vms_sync)
    except Exception:
        log.exception("vCenter list_vms failed")
        return []


async def query_perf(moids: list[str], days: int) -> dict[str, list[dict]]:
    if not moids:
        return {}
    try:
        return await asyncio.to_thread(_query_perf_sync, moids, days)
    except Exception:
        log.exception("vCenter query_perf failed")
        return {}


async def list_snapshots() -> list[dict]:
    try:
        return await asyncio.to_thread(_list_snapshots_sync)
    except Exception:
        log.exception("vCenter list_snapshots failed")
        return []


def _list_hosts_sync() -> list[dict]:
    """ESXi host inventory: name, cluster, CPU cores, RAM, current utilization %."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        pc = content.propertyCollector

        traversal_base = [
            vim.TraversalSpec(
                name="visitFolders", type=vim.Folder, path="childEntity", skip=False,
                selectSet=[
                    vim.SelectionSpec(name="visitFolders"),
                    vim.SelectionSpec(name="visitDC"),
                    vim.SelectionSpec(name="visitCR"),
                    vim.SelectionSpec(name="visitCCR"),
                ],
            ),
            vim.TraversalSpec(
                name="visitDC", type=vim.Datacenter, path="hostFolder", skip=False,
                selectSet=[vim.SelectionSpec(name="visitFolders")],
            ),
            vim.TraversalSpec(name="visitCR", type=vim.ComputeResource, path="host", skip=False),
            vim.TraversalSpec(name="visitCCR", type=vim.ClusterComputeResource, path="host", skip=False),
        ]
        obj_spec = vim.ObjectSpec(obj=content.rootFolder, skip=True, selectSet=traversal_base)

        # Pass 1: cluster names → host moid to cluster name
        cl_filter = vim.PropertyFilterSpec(
            objectSet=[obj_spec],
            propSet=[vim.PropertySpec(
                type=vim.ClusterComputeResource, all=False, pathSet=["name", "host"]
            )],
        )
        host_to_cluster: dict[str, str] = {}
        for obj in pc.RetrieveContents([cl_filter]):
            pd = {p.name: p.val for p in obj.propSet}
            cl_name = pd.get("name", "")
            for href in (pd.get("host") or []):
                host_to_cluster[href._moId] = cl_name

        # Pass 2: datacenter names → host moid to datacenter name (fallback for standalone ESXi)
        host_to_dc: dict[str, str] = {}
        try:
            dc_view = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datacenter], True
            )
            for dc in dc_view.view:
                try:
                    dc_host_view = content.viewManager.CreateContainerView(
                        dc, [vim.HostSystem], True
                    )
                    for h in dc_host_view.view:
                        host_to_dc[h._moId] = dc.name
                    dc_host_view.Destroy()
                except Exception:
                    pass
            dc_view.Destroy()
        except Exception:
            log.warning("Could not fetch Datacenter→host mapping")

        # Pass 3: ESXi host hardware + quickStats
        host_filter = vim.PropertyFilterSpec(
            objectSet=[obj_spec],
            propSet=[vim.PropertySpec(
                type=vim.HostSystem, all=False,
                pathSet=[
                    "name",
                    "summary.hardware.numCpuCores",
                    "summary.hardware.cpuMhz",
                    "summary.hardware.memorySize",
                    "summary.runtime.powerState",
                    "summary.quickStats.overallCpuUsage",
                    "summary.quickStats.overallMemoryUsage",
                ],
            )],
        )
        hosts: list[dict] = []
        for obj in pc.RetrieveContents([host_filter]):
            pd = {p.name: p.val for p in obj.propSet}
            moid = obj.obj._moId
            num_cores = pd.get("summary.hardware.numCpuCores")
            cpu_mhz = pd.get("summary.hardware.cpuMhz")
            mem_bytes = pd.get("summary.hardware.memorySize")
            total_mhz = (num_cores * cpu_mhz) if num_cores and cpu_mhz else None
            mem_total_mb = (mem_bytes / (1024 * 1024)) if mem_bytes else None
            cpu_use_mhz = pd.get("summary.quickStats.overallCpuUsage") or 0
            mem_use_mb = pd.get("summary.quickStats.overallMemoryUsage") or 0
            cluster = host_to_cluster.get(moid)
            datacenter = host_to_dc.get(moid)
            hosts.append({
                "moid": moid,
                "name": pd.get("name", moid),
                "cluster": cluster,
                "datacenter": datacenter,
                "num_cpu_cores": num_cores,
                "memory_gb": round(mem_bytes / (1024 ** 3)) if mem_bytes else None,
                "power_state": str(pd.get("summary.runtime.powerState", "unknown")),
                "cpu_usage_pct": round(cpu_use_mhz / total_mhz * 100, 1) if total_mhz else None,
                "mem_usage_pct": round(mem_use_mb / mem_total_mb * 100, 1) if mem_total_mb else None,
            })
        return hosts
    finally:
        Disconnect(si)


async def list_hosts() -> list[dict]:
    try:
        return await asyncio.to_thread(_list_hosts_sync)
    except Exception:
        log.exception("vCenter list_hosts failed")
        return []
