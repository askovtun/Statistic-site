"""Power State Report: VMs powered off in vCenter but not marked as Decommissioned."""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import PowerStateResponse, PowerStateVm
from app.services import db, response_cache

router = APIRouter(tags=["vcenter"])

_CACHE_TTL = 300

_DECOM_STATUSES = {
    "Decommissioned", "decommissioned", "Decommisioned",
    "Виведено з експлуатації", "Retired", "retired",
    "Disposed", "disposed",
}


@router.get("/power-state", response_model=PowerStateResponse)
async def get_power_state() -> PowerStateResponse:
    """VMs powered off in vCenter but not marked decommissioned in CMDB."""
    cached = response_cache.get("power-state", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vcenter_cached = db.get("vcenter_vms")
    vms_cached = db.get("vms")
    synced_at: str | None = vms_cached[1] if vms_cached else None

    if not vcenter_cached or not vms_cached:
        result = PowerStateResponse(total_off=0, not_decommissioned=0, vms=[], synced_at=synced_at)
        response_cache.put("power-state", result)
        return result

    vc_vms: list[dict] = vcenter_cached[0]
    cmdb_by_name = {vm["name"].lower(): vm for vm in vms_cached[0] if vm.get("name")}

    powered_off = [v for v in vc_vms if v.get("power_state") == "poweredOff"]

    not_decom: list[PowerStateVm] = []
    for v in powered_off:
        name = (v.get("name") or "").lower()
        cmdb = cmdb_by_name.get(name)
        cmdb_status = cmdb.get("status") if cmdb else None
        if cmdb_status in _DECOM_STATUSES:
            continue
        not_decom.append(PowerStateVm(
            name=v.get("name") or "",
            cmdb_status=cmdb_status,
            cluster=cmdb.get("cluster") if cmdb else None,
            vcpu=v.get("vcpu") or (cmdb.get("vcpu") if cmdb else None),
            vram_gb=v.get("vram_gb") or (cmdb.get("vram_gb") if cmdb else None),
            power_state=v.get("power_state", "unknown"),
            boot_time=v.get("boot_time"),
        ))

    by_cluster: dict[str, int] = {}
    for vm in not_decom:
        key = vm.cluster or "—"
        by_cluster[key] = by_cluster.get(key, 0) + 1

    result = PowerStateResponse(
        total_off=len(powered_off),
        not_decommissioned=len(not_decom),
        by_cluster=by_cluster,
        vms=sorted(not_decom, key=lambda v: (v.cluster or "", v.name)),
        synced_at=synced_at,
    )
    response_cache.put("power-state", result)
    return result
