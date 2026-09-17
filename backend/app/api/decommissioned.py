"""CIs with CMDB status = Decommissioned — dedicated report page."""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import DecommissionedCIItem, DecommissionedResponse
from app.services import db, response_cache

router = APIRouter(tags=["decommissioned"])

_CACHE_TTL = 300


@router.get("/decommissioned", response_model=DecommissionedResponse)
async def get_decommissioned() -> DecommissionedResponse:
    cached = response_cache.get("decommissioned", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    decomm_vms_cached  = db.get("decommissioned_vms")
    decomm_phys_cached = db.get("decommissioned_physical_servers")
    vms_cached         = db.get("vms")  # for synced_at timestamp

    vcenter_vms_cached = db.get("vcenter_vms")
    moid_map_cached    = db.get("vm_moid_map")
    hostid_map_cached  = db.get("vm_hostid_map")
    phys_hostid_cached = db.get("phys_hostid_map")

    decomm_vms:  list[dict] = decomm_vms_cached[0]  if decomm_vms_cached  else []
    decomm_phys: list[dict] = decomm_phys_cached[0] if decomm_phys_cached else []
    synced_at:   str | None = vms_cached[1]          if vms_cached         else None

    vcenter_vms: list[dict]       = vcenter_vms_cached[0] if vcenter_vms_cached else []
    vm_moid_map: dict[str, str]   = moid_map_cached[0]    if moid_map_cached    else {}
    vm_hostid_map: dict[str, str] = hostid_map_cached[0]  if hostid_map_cached  else {}
    phys_hostid_map: dict[str, str] = phys_hostid_cached[0] if phys_hostid_cached else {}

    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vcenter_vms}

    items: list[DecommissionedCIItem] = []

    for vm in decomm_vms:
        name   = vm.get("name", "")
        moid   = vm_moid_map.get(name)
        vc_vm  = vc_by_moid.get(moid) if moid else None
        items.append(DecommissionedCIItem(
            name=name,
            ci_type="vm",
            cmdb_status=vm.get("status"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            os_family=vm.get("os_family"),
            cluster=vm.get("cluster"),
            power_state=vc_vm.get("power_state", "unknown") if vc_vm else "unknown",
            in_zabbix=name in vm_hostid_map,
            jira_updated=vm.get("jira_updated"),
        ))

    for srv in decomm_phys:
        name = srv.get("name", "")
        items.append(DecommissionedCIItem(
            name=name,
            ci_type="physical",
            cmdb_status=srv.get("status"),
            fqdn=srv.get("fqdn"),
            primary_ip=srv.get("primary_ip"),
            os_family=None,
            cluster=srv.get("location"),
            power_state="unknown",
            in_zabbix=name in phys_hostid_map,
            jira_updated=srv.get("jira_updated"),
        ))

    items.sort(key=lambda x: (x.ci_type, x.name))

    result = DecommissionedResponse(
        total_vms=len(decomm_vms),
        total_physical=len(decomm_phys),
        items=items,
        synced_at=synced_at,
    )
    response_cache.put("decommissioned", result)
    return result
