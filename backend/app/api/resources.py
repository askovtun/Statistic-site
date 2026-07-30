from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import ResourceHistoryResponse, ResourceResponse
from app.services import analyzer, db, metrics_store, response_cache
from app.services.sync_service import PERIODS

router = APIRouter(tags=["resources"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."
_CACHE_TTL  = 300  # 5 minutes


@router.get("/resources", response_model=ResourceResponse)
async def get_resources(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    cache_key = f"resources:{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    hostid_map_cached = db.get("vm_hostid_map")
    if vms_cached is None or hostid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, updated_at = vms_cached
    vm_hostid_map, _ = hostid_map_cached
    moid_map_cached = db.get("vm_moid_map")
    vm_moid_map = moid_map_cached[0] if moid_map_cached else {}

    # ── Batch metric fetch (2 SQL queries instead of N per-VM) ───────────────
    matched_hostid_map = {
        vm["name"]: vm_hostid_map[vm["name"]]
        for vm in vms if vm.get("name") in vm_hostid_map
    }
    matched_moid_map = {
        vm["name"]: vm_moid_map[vm["name"]]
        for vm in vms if vm.get("name") in vm_moid_map
    }

    metrics    = metrics_store.get_period_metrics_batch(matched_hostid_map, period_days)
    vc_metrics = metrics_store.get_vcenter_period_metrics_batch(matched_moid_map, period_days)

    # Trend analysis: batch, one SQL per period window
    trend_by_hostid = metrics_store.get_trends_and_availability_batch(
        list(matched_hostid_map.values()), period_days
    )
    trend_data = {
        name: trend_by_hostid[hid]
        for name, hid in matched_hostid_map.items()
        if hid in trend_by_hostid
    }

    response = analyzer.build_resources(vms, metrics, vc_metrics, trend_data)
    response.synced_at = updated_at

    response_cache.put(cache_key, response)
    return response


@router.get("/resources/{name}/history", response_model=ResourceHistoryResponse)
async def get_resource_history(
    name: str,
    period_days: int = Query(default=7, description=f"Період: {PERIODS}"),
):
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    hostid_map_cached = db.get("vm_hostid_map")
    if hostid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vm_hostid_map, _ = hostid_map_cached
    moid_map_cached = db.get("vm_moid_map")
    vm_moid_map = moid_map_cached[0] if moid_map_cached else {}

    hostid = vm_hostid_map.get(name)
    moid   = vm_moid_map.get(name)

    if hostid is None and moid is None:
        vms_cached = db.get("vms")
        if vms_cached is None:
            raise HTTPException(status_code=503, detail=_NOT_SYNCED)
        vms, _ = vms_cached
        if not any(vm.get("name") == name for vm in vms):
            raise HTTPException(status_code=404, detail="ВМ не знайдена в CMDB")
        return ResourceHistoryResponse(name=name, points=[], vcenter_points=[])

    points         = metrics_store.get_history(hostid, period_days) if hostid else []
    vcenter_points = metrics_store.get_vcenter_history(moid, period_days) if moid else []
    return ResourceHistoryResponse(name=name, points=points, vcenter_points=vcenter_points)
