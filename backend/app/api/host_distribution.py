"""Host Distribution: VM count and resource usage per ESXi host."""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import HostDistItem, HostDistResponse
from app.services import db, response_cache

router = APIRouter(tags=["vcenter"])

_CACHE_TTL = 300


@router.get("/vcenter/host-distribution", response_model=HostDistResponse)
async def get_host_distribution() -> HostDistResponse:
    """VM count per ESXi host with current CPU/RAM usage."""
    cached = response_cache.get("host-distribution", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    hosts_cached = db.get("vcenter_hosts")
    vm_host_map_cached = db.get("vm_host_map")
    vms_cached = db.get("vms")
    synced_at: str | None = vms_cached[1] if vms_cached else None

    if not hosts_cached:
        result = HostDistResponse(hosts=[], total_vms_mapped=0, synced_at=synced_at)
        response_cache.put("host-distribution", result)
        return result

    hosts: list[dict] = hosts_cached[0]
    vm_host_map: dict = vm_host_map_cached[0] if vm_host_map_cached else {}

    # Count VMs per host moid
    vm_count_by_host: dict[str, int] = {}
    for _vm_name, host_moid in vm_host_map.items():
        vm_count_by_host[host_moid] = vm_count_by_host.get(host_moid, 0) + 1

    items: list[HostDistItem] = []
    for h in hosts:
        moid = h.get("moid", "")
        items.append(HostDistItem(
            host_name=h.get("name") or moid,
            cluster=h.get("cluster"),
            vm_count=vm_count_by_host.get(moid, 0),
            cpu_usage_pct=h.get("cpu_usage_pct"),
            mem_usage_pct=h.get("mem_usage_pct"),
            num_cpu_cores=h.get("num_cpu_cores"),
            memory_gb=h.get("memory_gb"),
        ))

    items.sort(key=lambda h: (h.cluster or "", -h.vm_count))
    total_mapped = sum(vm_count_by_host.values())

    result = HostDistResponse(
        hosts=items,
        total_vms_mapped=total_mapped,
        synced_at=synced_at,
    )
    response_cache.put("host-distribution", result)
    return result
