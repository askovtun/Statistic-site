"""Windows Server Datacenter vs Standard licensing analysis per ESXi host.

Licensing model (per 2-core packs):
  DC cost per host     = ceil(cpu_cores / 2) * dc_price
  Std cost per host    = ceil(vm_count / 2) * ceil(cpu_cores / 2) * std_price
  Recommendation       = whichever is cheaper
"""
from __future__ import annotations

import math

from fastapi import APIRouter

from app.config import settings
from app.models.schemas import LicenseHostItem, LicenseReportResponse
from app.services import db, response_cache

router = APIRouter(tags=["license"])

_CACHE_KEY = "license-report"
_CACHE_TTL = 600


def _is_windows_server(os_raw: str | None) -> bool:
    if not os_raw:
        return False
    return "windows server" in os_raw.lower()


@router.get("/license-report", response_model=LicenseReportResponse)
async def get_license_report() -> LicenseReportResponse:
    cached = response_cache.get(_CACHE_KEY, ttl=_CACHE_TTL)
    if cached is not None:
        return LicenseReportResponse(**cached)

    vc_vms_row = db.get("vcenter_vms")
    vc_hosts_row = db.get("vcenter_hosts")

    vc_vms: list[dict] = vc_vms_row[0] if vc_vms_row else []
    vc_hosts: list[dict] = vc_hosts_row[0] if vc_hosts_row else []
    synced_at: str | None = vc_vms_row[1] if vc_vms_row else None

    hosts_by_moid: dict[str, dict] = {h["moid"]: h for h in vc_hosts}

    dc_price = settings.dc_license_price_usd
    std_price = settings.standard_license_price_usd

    # Group Windows Server VM names by their ESXi host moid
    host_vm_names: dict[str, list[str]] = {}
    for vm in vc_vms:
        if not _is_windows_server(vm.get("os_full_name")):
            continue
        host_moid = vm.get("runtime_host")
        if not host_moid:
            continue
        host_vm_names.setdefault(host_moid, []).append(vm.get("name", "?"))

    items: list[LicenseHostItem] = []
    for host_moid, vm_names in host_vm_names.items():
        host = hosts_by_moid.get(host_moid, {})
        cores = host.get("num_cpu_cores") or 16  # fallback when host not in cache
        packs = math.ceil(cores / 2)
        vm_count = len(vm_names)

        dc_cost = packs * dc_price
        std_cost = math.ceil(vm_count / 2) * packs * std_price

        if dc_cost <= std_cost:
            recommendation: str = "datacenter"
            savings = 0.0
        else:
            recommendation = "standard"
            savings = round(dc_cost - std_cost, 2)

        items.append(LicenseHostItem(
            host_name=host.get("name", host_moid),
            cluster=host.get("cluster"),
            cpu_cores=cores,
            core_packs=packs,
            windows_vm_count=vm_count,
            windows_vms=sorted(vm_names),
            dc_cost=round(dc_cost, 2),
            std_cost=round(std_cost, 2),
            recommendation=recommendation,
            savings=savings,
        ))

    items.sort(key=lambda x: x.savings, reverse=True)

    result = LicenseReportResponse(
        hosts=items,
        total_hosts=len(items),
        total_dc_cost=round(sum(i.dc_cost for i in items), 2),
        total_standard_cost=round(sum(i.std_cost for i in items), 2),
        total_savings=round(sum(i.savings for i in items), 2),
        dc_price_per_2core=dc_price,
        std_price_per_2core=std_price,
        synced_at=synced_at,
    )
    response_cache.put(_CACHE_KEY, result.model_dump())
    return result
