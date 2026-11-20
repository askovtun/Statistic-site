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
from pyVmomi import vim, vmodl

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


def _fetch_create_dates_batch(content, vm_objects: list) -> dict[str, str]:
    """Batch-fetch config.createDate for all VMs in a single PropertyCollector call."""
    if not vm_objects:
        return {}
    try:
        collector = content.propertyCollector
        obj_specs = [
            vmodl.query.PropertyCollector.ObjectSpec(obj=vm, skip=False)
            for vm in vm_objects
        ]
        prop_spec = vmodl.query.PropertyCollector.PropertySpec(
            type=vim.VirtualMachine,
            all=False,
            pathSet=["config.createDate"],
        )
        filter_spec = vmodl.query.PropertyCollector.FilterSpec(
            objectSet=obj_specs,
            propSet=[prop_spec],
        )
        result = collector.RetrieveContents([filter_spec])
        dates: dict[str, str] = {}
        for obj_content in result:
            for prop in (obj_content.propSet or []):
                if prop.name == "config.createDate" and prop.val:
                    try:
                        dates[obj_content.obj._moId] = prop.val.isoformat()
                    except Exception:
                        pass
        return dates
    except Exception:
        log.exception("Failed to batch-fetch VM create dates")
        return {}


def _list_vms_sync() -> list[dict]:
    """VM inventory: name/guest identity + current disk-space usage % + power state."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        vm_list = list(view.view)
        create_dates = _fetch_create_dates_batch(content, vm_list)
        out = []
        for vm in vm_list:
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
            # numCpu/memorySizeMB are on ConfigSummary; .hardware is only on ConfigInfo
            num_cpu = getattr(s.config, "numCpu", None) if s.config else None
            mem_mb = getattr(s.config, "memorySizeMB", None) if s.config else None
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
                "vcpu": num_cpu or None,
                "vram_gb": round(mem_mb / 1024) if mem_mb else None,
                "created_at": create_dates.get(vm._moId),
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

        # Pass 3: ESXi host hardware + quickStats + network + OS version
        host_filter = vim.PropertyFilterSpec(
            objectSet=[obj_spec],
            propSet=[vim.PropertySpec(
                type=vim.HostSystem, all=False,
                pathSet=[
                    "name",
                    "summary.hardware.numCpuCores",
                    "summary.hardware.numCpuPkgs",
                    "summary.hardware.cpuMhz",
                    "summary.hardware.memorySize",
                    "summary.hardware.vendor",
                    "summary.hardware.model",
                    "summary.hardware.cpuModel",
                    "summary.hardware.numNics",
                    "summary.runtime.powerState",
                    "summary.quickStats.overallCpuUsage",
                    "summary.quickStats.overallMemoryUsage",
                    "summary.config.product.fullName",
                    "hardware.systemInfo.serialNumber",
                    "hardware.biosInfo.biosVersion",
                    "hardware.biosInfo.releaseDate",
                    "config.network.vnic",
                ],
            )],
        )

        host_storage_bytes: dict[str, int] = {}  # placeholder; storage not fetched to avoid SOAP overhead

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

            # Primary IP: Management Network vmkernel → fallback vmk0
            vnics = pd.get("config.network.vnic") or []
            primary_ip: str | None = None
            all_ips: list[str] = []
            for vnic in vnics:
                ip = (vnic.spec.ip.ipAddress if vnic.spec and vnic.spec.ip else None)
                if ip and ip not in all_ips:
                    all_ips.append(ip)
                pg = (vnic.spec.portgroup or "") if vnic.spec else ""
                if primary_ip is None and "management" in pg.lower() and ip:
                    primary_ip = ip
            if primary_ip is None:
                for vnic in vnics:
                    if getattr(vnic, "device", "") == "vmk0":
                        primary_ip = (vnic.spec.ip.ipAddress if vnic.spec and vnic.spec.ip else None)
                        break

            # OS / ESXi version string
            os_version = pd.get("summary.config.product.fullName")

            # Hardware make/model/serial/cpu
            vendor        = pd.get("summary.hardware.vendor") or ""
            model         = pd.get("summary.hardware.model") or ""
            cpu_model     = pd.get("summary.hardware.cpuModel") or ""
            serial_number = pd.get("hardware.systemInfo.serialNumber") or ""
            num_pkgs      = pd.get("summary.hardware.numCpuPkgs")
            nic_count     = pd.get("summary.hardware.numNics")
            cores_per_socket = (num_cores // num_pkgs) if num_cores and num_pkgs else None

            # BIOS version + date
            bios_ver      = pd.get("hardware.biosInfo.biosVersion") or ""
            bios_date_raw = pd.get("hardware.biosInfo.releaseDate")
            if bios_ver and bios_date_raw:
                try:
                    bios_version = f"{bios_ver} ({bios_date_raw.strftime('%Y-%m-%d')})"
                except Exception:
                    bios_version = bios_ver
            else:
                bios_version = bios_ver or ""

            # Total accessible storage in TB
            ds_bytes = host_storage_bytes.get(moid, 0)
            storage_tb = round(ds_bytes / (1024 ** 4), 1) if ds_bytes else None

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
                "management_ip": primary_ip,
                "all_ips": all_ips,
                "os_version": os_version,
                "vendor": vendor,
                "model": model,
                "cpu_model": cpu_model,
                "serial_number": serial_number,
                "cpu_packages": num_pkgs,
                "cores_per_socket": cores_per_socket,
                "nic_count": nic_count,
                "bios_version": bios_version,
                "storage_tb": storage_tb,
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


def _list_cluster_storage_sync() -> dict[str, dict]:
    """Per-cluster datastore capacity and free space (bytes → GB).

    Uses PropertyCollector for a single batch SOAP call: first fetch
    ClusterComputeResource → datastore refs, then fetch datastore summaries.
    Only accessible datastores are counted.
    """
    si = _connect()
    if si is None:
        return {}
    try:
        content = si.RetrieveContent()
        pc = content.propertyCollector

        traversal = [
            vim.TraversalSpec(
                name="visitFolders", type=vim.Folder, path="childEntity", skip=False,
                selectSet=[
                    vim.SelectionSpec(name="visitFolders"),
                    vim.SelectionSpec(name="visitDC"),
                ],
            ),
            vim.TraversalSpec(
                name="visitDC", type=vim.Datacenter, path="hostFolder", skip=False,
                selectSet=[vim.SelectionSpec(name="visitFolders")],
            ),
        ]
        obj_spec = vim.ObjectSpec(obj=content.rootFolder, skip=True, selectSet=traversal)

        cl_filter = vim.PropertyFilterSpec(
            objectSet=[obj_spec],
            propSet=[vim.PropertySpec(
                type=vim.ClusterComputeResource, all=False, pathSet=["name", "datastore"]
            )],
        )

        cluster_ds_refs: dict[str, list[str]] = {}
        all_ds_moids: set[str] = set()
        for obj in pc.RetrieveContents([cl_filter]):
            pd = {p.name: p.val for p in obj.propSet}
            cl_name = pd.get("name", "")
            moids = [ds._moId for ds in (pd.get("datastore") or [])]
            cluster_ds_refs[cl_name] = moids
            all_ds_moids.update(moids)

        if not all_ds_moids:
            return {}

        ds_obj_specs = [vim.ObjectSpec(obj=vim.Datastore(m, si._stub)) for m in all_ds_moids]
        ds_filter = vim.PropertyFilterSpec(
            objectSet=ds_obj_specs,
            propSet=[vim.PropertySpec(
                type=vim.Datastore, all=False,
                pathSet=["summary.capacity", "summary.freeSpace", "summary.accessible"],
            )],
        )
        ds_info: dict[str, dict] = {}
        for obj in pc.RetrieveContents([ds_filter]):
            pd2 = {p.name: p.val for p in obj.propSet}
            if pd2.get("summary.accessible", True):
                ds_info[obj.obj._moId] = {
                    "capacity": pd2.get("summary.capacity") or 0,
                    "free": pd2.get("summary.freeSpace") or 0,
                }

        result: dict[str, dict] = {}
        for cl_name, ds_moids in cluster_ds_refs.items():
            total = sum(ds_info.get(m, {}).get("capacity", 0) for m in ds_moids)
            free = sum(ds_info.get(m, {}).get("free", 0) for m in ds_moids)
            if total:
                result[cl_name] = {
                    "total_storage_gb": round(total / (1024 ** 3)),
                    "free_storage_gb": round(free / (1024 ** 3)),
                    "storage_used_pct": round((total - free) / total * 100, 1),
                }
        return result
    finally:
        Disconnect(si)


async def list_cluster_storage() -> dict[str, dict]:
    try:
        return await asyncio.to_thread(_list_cluster_storage_sync)
    except Exception:
        log.exception("vCenter list_cluster_storage failed")
        return {}


def _list_datastores_sync() -> list[dict]:
    """Enumerate all datastores: name, type, capacity/free/used%, accessible, cluster."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        pc = content.propertyCollector

        # Build cluster → datastore moid mapping
        traversal = [
            vim.TraversalSpec(
                name="visitFolders", type=vim.Folder, path="childEntity", skip=False,
                selectSet=[
                    vim.SelectionSpec(name="visitFolders"),
                    vim.SelectionSpec(name="visitDC"),
                    vim.SelectionSpec(name="visitCCR"),
                ],
            ),
            vim.TraversalSpec(
                name="visitDC", type=vim.Datacenter, path="datastoreFolder", skip=False,
                selectSet=[vim.SelectionSpec(name="visitFolders")],
            ),
            vim.TraversalSpec(
                name="visitCCR", type=vim.ClusterComputeResource, path="datastore", skip=False,
            ),
        ]

        # First get cluster→datastore associations
        cl_traversal = [
            vim.TraversalSpec(
                name="vF", type=vim.Folder, path="childEntity", skip=False,
                selectSet=[vim.SelectionSpec(name="vF"), vim.SelectionSpec(name="vDC"), vim.SelectionSpec(name="vCCR")],
            ),
            vim.TraversalSpec(name="vDC", type=vim.Datacenter, path="hostFolder", skip=False,
                selectSet=[vim.SelectionSpec(name="vF")]),
            vim.TraversalSpec(name="vCCR", type=vim.ClusterComputeResource, path="host", skip=False),
        ]
        cl_spec = vim.PropertyFilterSpec(
            objectSet=[vim.ObjectSpec(obj=content.rootFolder, skip=True, selectSet=cl_traversal)],
            propSet=[vim.PropertySpec(type=vim.ClusterComputeResource, all=False, pathSet=["name", "datastore"])],
        )
        ds_to_cluster: dict[str, str] = {}
        for obj in pc.RetrieveContents([cl_spec]):
            pd = {p.name: p.val for p in obj.propSet}
            cl_name = pd.get("name", "")
            for ds_ref in (pd.get("datastore") or []):
                ds_to_cluster[ds_ref._moId] = cl_name

        # Then enumerate all datastores
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.Datastore], True)
        ds_list = list(view.view)
        view.Destroy()

        obj_specs = [vim.ObjectSpec(obj=ds) for ds in ds_list]
        ds_filter = vim.PropertyFilterSpec(
            objectSet=obj_specs,
            propSet=[vim.PropertySpec(
                type=vim.Datastore, all=False,
                pathSet=[
                    "summary.name", "summary.type",
                    "summary.capacity", "summary.freeSpace",
                    "summary.accessible",
                ],
            )],
        )

        out = []
        for obj in pc.RetrieveContents([ds_filter]):
            pd = {p.name: p.val for p in obj.propSet}
            cap = pd.get("summary.capacity") or 0
            free = pd.get("summary.freeSpace") or 0
            accessible = pd.get("summary.accessible", True)
            cap_gb = round(cap / (1024 ** 3), 1) if cap else None
            free_gb = round(free / (1024 ** 3), 1) if free else None
            used_pct = round((cap - free) / cap * 100, 1) if cap else None
            out.append({
                "name": pd.get("summary.name", ""),
                "datastore_type": pd.get("summary.type"),
                "capacity_gb": cap_gb,
                "free_gb": free_gb,
                "used_pct": used_pct,
                "accessible": bool(accessible),
                "cluster": ds_to_cluster.get(obj.obj._moId),
            })
        out.sort(key=lambda d: (d["cluster"] or "", d["name"]))
        return out
    finally:
        Disconnect(si)


async def list_datastores() -> list[dict]:
    try:
        return await asyncio.to_thread(_list_datastores_sync)
    except Exception:
        log.exception("vCenter list_datastores failed")
        return []
