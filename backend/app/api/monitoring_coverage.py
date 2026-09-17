"""Monitoring coverage report: % of CMDB VMs/physical servers monitored in Zabbix."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import CoveragePoint, CoverageResponse
from app.services import cmdb_tracker, db, response_cache

router = APIRouter()

_CACHE_TTL = 300


@router.get("/monitoring-coverage", response_model=CoverageResponse)
async def get_monitoring_coverage(
    days: int = Query(default=90, ge=1, le=365),
) -> CoverageResponse:
    cache_key = f"monitoring-coverage-{days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    # Current state from cache
    vms_cached       = db.get("vms")
    phys_cached      = db.get("physical_servers")
    hostid_cached    = db.get("vm_hostid_map")
    phys_hid_cached  = db.get("phys_hostid_map")
    synced_at: str | None = vms_cached[1] if vms_cached else None

    vm_total       = len(vms_cached[0])        if vms_cached      else 0
    vm_monitored   = len(hostid_cached[0])     if hostid_cached   else 0
    phys_total     = len(phys_cached[0])       if phys_cached     else 0
    phys_monitored = len(phys_hid_cached[0])   if phys_hid_cached else 0

    current_vm_pct   = round(vm_monitored   / vm_total   * 100, 1) if vm_total   else None
    current_phys_pct = round(phys_monitored / phys_total * 100, 1) if phys_total else None

    # Historical data
    raw = cmdb_tracker.get_coverage_history(days)
    history = [
        CoveragePoint(
            date=r["date"],
            vm_total=r["vm_total"],
            vm_monitored=r["vm_monitored"],
            vm_pct=round(r["vm_monitored"] / r["vm_total"] * 100, 1) if r["vm_total"] else 0.0,
            phys_total=r["phys_total"],
            phys_monitored=r["phys_monitored"],
            phys_pct=round(r["phys_monitored"] / r["phys_total"] * 100, 1) if r["phys_total"] else 0.0,
        )
        for r in raw
    ]

    result = CoverageResponse(
        current_vm_pct=current_vm_pct,
        current_phys_pct=current_phys_pct,
        vm_total=vm_total,
        vm_monitored=vm_monitored,
        phys_total=phys_total,
        phys_monitored=phys_monitored,
        history=history,
        synced_at=synced_at,
    )
    response_cache.put(cache_key, result)
    return result
