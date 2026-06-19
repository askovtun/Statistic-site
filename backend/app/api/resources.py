from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import ResourceHistoryResponse, ResourceResponse
from app.services import analyzer, db, metrics_store
from app.services.sync_service import PERIODS

router = APIRouter(tags=["resources"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."


@router.get("/resources", response_model=ResourceResponse)
async def get_resources(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    """Analyze VM resource utilization based on cached Zabbix metrics."""
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    vms_cached = db.get("vms")
    hostid_map_cached = db.get("vm_hostid_map")
    if vms_cached is None or hostid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, updated_at = vms_cached
    vm_hostid_map, _ = hostid_map_cached
    moid_map_cached = db.get("vm_moid_map")
    vm_moid_map = moid_map_cached[0] if moid_map_cached else {}

    metrics = {
        vm["name"]: metrics_store.get_period_metrics(vm_hostid_map[vm["name"]], period_days)
        for vm in vms
        if vm.get("name") in vm_hostid_map
    }
    vc_metrics = {
        vm["name"]: metrics_store.get_vcenter_period_metrics(vm_moid_map[vm["name"]], period_days)
        for vm in vms
        if vm.get("name") in vm_moid_map
    }

    response = analyzer.build_resources(vms, metrics, vc_metrics)
    response.synced_at = updated_at
    return response


@router.get("/resources/{name}/history", response_model=ResourceHistoryResponse)
async def get_resource_history(
    name: str,
    period_days: int = Query(default=7, description=f"Період: {PERIODS}"),
):
    """Hourly CPU/RAM/Disk history for a single VM, for charting."""
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    hostid_map_cached = db.get("vm_hostid_map")
    if hostid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vm_hostid_map, _ = hostid_map_cached
    moid_map_cached = db.get("vm_moid_map")
    vm_moid_map = moid_map_cached[0] if moid_map_cached else {}

    hostid = vm_hostid_map.get(name)
    moid = vm_moid_map.get(name)
    if hostid is None and moid is None:
        raise HTTPException(status_code=404, detail="ВМ не знайдена або немає метрик Zabbix/vCenter")

    points = metrics_store.get_history(hostid, period_days) if hostid else []
    vcenter_points = metrics_store.get_vcenter_history(moid, period_days) if moid else []
    return ResourceHistoryResponse(name=name, points=points, vcenter_points=vcenter_points)
