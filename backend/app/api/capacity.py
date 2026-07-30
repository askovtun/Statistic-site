"""Capacity Planning: per-cluster physical resources vs allocated vs actual usage."""
from __future__ import annotations

import re
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import CapacityClusterItem, CapacityResponse
from app.services import db, metrics_store, response_cache

_WITNESS_RE = re.compile(r"witness", re.IGNORECASE)


def _standalone_group(hostname: str) -> str | None:
    """Return pseudo-cluster name for a standalone host, None for witness nodes."""
    if _WITNESS_RE.search(hostname):
        return None
    m = re.match(r"^([A-Za-z0-9]+)-", hostname)
    return m.group(1).upper() if m else hostname.split(".")[0].upper()

router = APIRouter(tags=["capacity"])

_TARGET_PCT = 80.0
_STD_VM_VCPU = 4
_STD_VM_RAM_GB = 8
_STATUS_ORDER = {"critical": 0, "warning": 1, "ok": 2, "unknown": 3}


def _weighted_avg(hosts: list[dict], key: str) -> float | None:
    vals = [h[key] for h in hosts if h.get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


_CACHE_TTL = 300


@router.get("/capacity", response_model=CapacityResponse)
async def get_capacity(
    period_days: int = Query(default=30, description="Кількість днів для аналізу метрик"),
) -> CapacityResponse:
    cache_key = f"capacity:{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vcenter_hosts_cached = db.get("vcenter_hosts")
    vms_cached = db.get("vms")
    moid_map_cached = db.get("vm_moid_map")
    vcenter_vms_cached = db.get("vcenter_vms")
    cluster_storage_cached = db.get("vcenter_cluster_storage")

    if not vcenter_hosts_cached:
        raise HTTPException(status_code=503, detail="Дані ще не синхронізовано. Натисніть «Оновити дані».")

    vm_host_map_cached = db.get("vm_host_map")

    hosts: list[dict] = vcenter_hosts_cached[0]
    synced_at: str | None = vcenter_hosts_cached[1]
    vms: list[dict] = vms_cached[0] if vms_cached else []
    vm_moid_map: dict[str, str] = moid_map_cached[0] if moid_map_cached else {}
    vcenter_vms: list[dict] = vcenter_vms_cached[0] if vcenter_vms_cached else []
    vm_host_map: dict[str, str] = vm_host_map_cached[0] if vm_host_map_cached else {}
    cluster_storage: dict[str, dict] = cluster_storage_cached[0] if cluster_storage_cached else {}

    vc_power = {v["name"]: v.get("power_state", "unknown") for v in vcenter_vms}

    # Group ESXi hosts by cluster (real) or by hostname prefix (standalone pseudo-clusters).
    # Witness nodes (vSAN witnesses) are excluded — they're auxiliary and have no VMs.
    hosts_by_cluster: dict[str, list[dict]] = defaultdict(list)
    for h in hosts:
        cl = h.get("cluster")
        if cl:
            hosts_by_cluster[cl].append(h)
        else:
            grp = _standalone_group(h.get("name", ""))
            if grp:
                hosts_by_cluster[grp].append(h)

    # Build host moid → cluster/group name (covers both real clusters and pseudo-clusters).
    host_to_cluster: dict[str, str] = {}
    for h in hosts:
        moid = h.get("moid")
        if not moid:
            continue
        cl = h.get("cluster")
        if cl:
            host_to_cluster[moid] = cl
        else:
            grp = _standalone_group(h.get("name", ""))
            if grp:
                host_to_cluster[moid] = grp
    vm_to_vc_cluster: dict[str, str] = {
        vm_name: host_to_cluster[host_moid]
        for vm_name, host_moid in vm_host_map.items()
        if host_moid in host_to_cluster
    }

    # Group CMDB VMs by their vCenter cluster (resolved via vm_host_map)
    vms_by_cluster: dict[str, list[dict]] = defaultdict(list)
    for v in vms:
        cl = vm_to_vc_cluster.get(v.get("name", ""))
        if cl:
            vms_by_cluster[cl].append(v)

    items: list[CapacityClusterItem] = []

    for cl_name, cl_hosts in hosts_by_cluster.items():
        cl_vms = vms_by_cluster.get(cl_name, [])

        physical_cpu_cores = sum(h.get("num_cpu_cores") or 0 for h in cl_hosts) or None
        physical_ram_gb = sum(h.get("memory_gb") or 0 for h in cl_hosts) or None
        host_cpu_pct = _weighted_avg(cl_hosts, "cpu_usage_pct")
        host_ram_pct = _weighted_avg(cl_hosts, "mem_usage_pct")

        total_vms = len(cl_vms)
        powered_on_vms = sum(1 for v in cl_vms if vc_power.get(v.get("name")) == "poweredOn")
        allocated_vcpu = sum(v.get("vcpu") or 0 for v in cl_vms)
        allocated_vram_gb = sum(v.get("vram_gb") or 0 for v in cl_vms)

        vcpu_ratio = (
            round(allocated_vcpu / physical_cpu_cores, 1)
            if physical_cpu_cores and allocated_vcpu
            else None
        )
        vram_ratio = (
            round(allocated_vram_gb / physical_ram_gb, 1)
            if physical_ram_gb and allocated_vram_gb
            else None
        )

        # Historical metrics (30d avg/peak from vCenter perf data)
        cl_moids = [vm_moid_map[v["name"]] for v in cl_vms if v.get("name") in vm_moid_map]
        hist = metrics_store.get_cluster_capacity_metrics(cl_moids, period_days) if cl_moids else {}
        avg_cpu_pct = hist.get("avg_cpu_pct")
        avg_ram_pct = hist.get("avg_ram_pct")
        peak_cpu_pct = hist.get("peak_cpu_pct")
        peak_ram_pct = hist.get("peak_ram_pct")

        # Free capacity uses host-level quickStats (host_cpu_pct / host_ram_pct).
        # "free" = literally free (total − used), matching vCenter "Capacity and Usage".
        # "safe headroom" to the 80% ceiling is used only for std_vms_can_fit planning.
        free_cpu_cores: int | None = None
        free_ram_gb: int | None = None
        std_vms_can_fit: int | None = None

        if physical_cpu_cores and host_cpu_pct is not None:
            free_cpu_cores = max(0, int(physical_cpu_cores * (100.0 - host_cpu_pct) / 100))
            safe_cpu = max(0, int(physical_cpu_cores * (_TARGET_PCT - host_cpu_pct) / 100))
        else:
            safe_cpu = 0
        if physical_ram_gb and host_ram_pct is not None:
            free_ram_gb = max(0, int(physical_ram_gb * (100.0 - host_ram_pct) / 100))
            safe_ram = max(0, int(physical_ram_gb * (_TARGET_PCT - host_ram_pct) / 100))
        else:
            safe_ram = 0
        if free_cpu_cores is not None and free_ram_gb is not None:
            std_vms_can_fit = min(safe_cpu // _STD_VM_VCPU, safe_ram // _STD_VM_RAM_GB)

        # Status based on host-level quickStats
        cpu_val = host_cpu_pct or 0
        ram_val = host_ram_pct or 0
        if cpu_val >= 80 or ram_val >= 80:
            status = "critical"
        elif cpu_val >= 65 or ram_val >= 65:
            status = "warning"
        elif cpu_val > 0 or ram_val > 0:
            status = "ok"
        else:
            status = "unknown"

        stor = cluster_storage.get(cl_name, {})
        total_storage_gb = stor.get("total_storage_gb")
        free_storage_gb = stor.get("free_storage_gb")
        storage_used_pct = stor.get("storage_used_pct")

        items.append(CapacityClusterItem(
            name=cl_name,
            host_count=len(cl_hosts),
            physical_cpu_cores=physical_cpu_cores,
            physical_ram_gb=physical_ram_gb,
            host_cpu_pct=host_cpu_pct,
            host_ram_pct=host_ram_pct,
            allocated_vcpu=allocated_vcpu,
            allocated_vram_gb=allocated_vram_gb,
            total_vms=total_vms,
            powered_on_vms=powered_on_vms,
            vcpu_ratio=vcpu_ratio,
            vram_ratio=vram_ratio,
            avg_cpu_pct=avg_cpu_pct,
            avg_ram_pct=avg_ram_pct,
            peak_cpu_pct=peak_cpu_pct,
            peak_ram_pct=peak_ram_pct,
            free_cpu_cores=free_cpu_cores,
            free_ram_gb=free_ram_gb,
            std_vms_can_fit=std_vms_can_fit,
            total_storage_gb=total_storage_gb,
            free_storage_gb=free_storage_gb,
            storage_used_pct=storage_used_pct,
            status=status,
        ))

    items.sort(key=lambda x: (_STATUS_ORDER.get(x.status, 3), -(x.physical_ram_gb or 0)))

    result = CapacityResponse(
        total_clusters=len(items),
        total_physical_cpu_cores=sum(i.physical_cpu_cores or 0 for i in items),
        total_physical_ram_gb=sum(i.physical_ram_gb or 0 for i in items),
        total_storage_gb=sum(i.total_storage_gb or 0 for i in items),
        critical_count=sum(1 for i in items if i.status == "critical"),
        warning_count=sum(1 for i in items if i.status == "warning"),
        items=items,
        synced_at=synced_at,
        period_days=period_days,
    )
    response_cache.put(cache_key, result)
    return result
