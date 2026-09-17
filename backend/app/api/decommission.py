"""Decommission candidates: VMs meeting 2+ of: powered-off, not in Zabbix, CMDB inactive.

Iterates ALL CMDB VMs (not just those matched in vCenter):
- If a VM has a vCenter match (vm_moid_map), power state is known.
- If a VM has no vCenter match, power_state is set to "unknown" but
  other 2 criteria (Zabbix, CMDB status) can still qualify it.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import DecommissionItem, DecommissionResponse
from app.services import db, response_cache

router = APIRouter()

_ACTIVE_STATUSES = {"Active", "Активний", "active"}
_CACHE_TTL = 300


@router.get("/decommission-candidates", response_model=DecommissionResponse)
async def get_decommission_candidates() -> DecommissionResponse:
    cached = response_cache.get("decommission-candidates", ttl=_CACHE_TTL)
    if cached is not None:
        return cached
    vcenter_vms_cached  = db.get("vcenter_vms")
    vms_cached          = db.get("vms")
    moid_map_cached     = db.get("vm_moid_map")
    hostid_map_cached   = db.get("vm_hostid_map")

    vcenter_vms: list[dict] = vcenter_vms_cached[0] if vcenter_vms_cached else []
    synced_at: str | None   = vms_cached[1] if vms_cached else None

    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vcenter_vms}
    vm_moid_map:   dict[str, str] = moid_map_cached[0]  if moid_map_cached  else {}
    vm_hostid_map: dict[str, str] = hostid_map_cached[0] if hostid_map_cached else {}

    candidates: list[DecommissionItem] = []

    # Iterate ALL CMDB VMs
    for vm in (vms_cached[0] if vms_cached else []):
        name       = vm.get("name", "")
        if not name:
            continue

        cmdb_status = vm.get("status")
        in_zabbix   = name in vm_hostid_map

        # Power state: from vCenter if matched, otherwise unknown
        moid        = vm_moid_map.get(name)
        vc_vm       = vc_by_moid.get(moid) if moid else None
        power_state = vc_vm.get("power_state", "unknown") if vc_vm else "unknown"

        is_powered_off  = power_state == "poweredOff"
        not_monitored   = not in_zabbix
        inactive_status = cmdb_status not in _ACTIVE_STATUSES if cmdb_status else True

        # VMs with unknown power state: only flag if both other criteria are met
        if power_state == "unknown":
            if not (not_monitored and inactive_status):
                continue
            score = 2
        else:
            score = sum([is_powered_off, not_monitored, inactive_status])
            if score < 2:
                continue

        reasons: list[str] = []
        if is_powered_off:
            reasons.append("Вимкнена ВМ")
        elif power_state == "unknown":
            reasons.append("Стан невідомий (немає vCenter-даних)")
        if not_monitored:
            reasons.append("Немає моніторингу Zabbix")
        if inactive_status:
            reasons.append(f"Статус CMDB: {cmdb_status or 'невідомо'}")

        candidates.append(DecommissionItem(
            name=name,
            power_state=power_state,
            cmdb_status=cmdb_status,
            in_zabbix=in_zabbix,
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            decommission_score=score,
            reasons=reasons,
        ))

    candidates.sort(key=lambda x: (-x.decommission_score, x.name))

    result = DecommissionResponse(
        total=len(candidates),
        items=candidates,
        synced_at=synced_at,
    )
    response_cache.put("decommission-candidates", result)
    return result
