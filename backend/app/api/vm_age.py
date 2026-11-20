"""VM Age: VMs sorted by vCenter creation date."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import VmAgeItem, VmAgeResponse
from app.services import db, response_cache

router = APIRouter(tags=["vcenter"])

_CACHE_TTL = 1800


@router.get("/vm/age", response_model=VmAgeResponse)
async def get_vm_age() -> VmAgeResponse:
    """VMs with creation date from vCenter, sorted oldest first."""
    cached = response_cache.get("vm-age", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vcenter_cached = db.get("vcenter_vms")
    vms_cached = db.get("vms")
    synced_at: str | None = vms_cached[1] if vms_cached else None

    if not vcenter_cached:
        result = VmAgeResponse(vms=[], total=0, with_create_date=0, synced_at=synced_at)
        response_cache.put("vm-age", result)
        return result

    vc_vms: list[dict] = vcenter_cached[0]
    cmdb_by_name: dict[str, dict] = {}
    if vms_cached:
        for vm in vms_cached[0]:
            if vm.get("name"):
                cmdb_by_name[vm["name"].lower()] = vm

    now = datetime.now(timezone.utc)
    items: list[VmAgeItem] = []
    with_create_date = 0

    for v in vc_vms:
        name = v.get("name") or ""
        cmdb = cmdb_by_name.get(name.lower())
        created_at = v.get("created_at")
        age_days: int | None = None
        if created_at:
            try:
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                age_days = (now - dt).days
                with_create_date += 1
            except Exception:
                pass

        items.append(VmAgeItem(
            name=name,
            cluster=cmdb.get("cluster") if cmdb else None,
            cmdb_status=cmdb.get("status") if cmdb else None,
            power_state=v.get("power_state"),
            created_at=created_at,
            age_days=age_days,
            vcpu=v.get("vcpu") or (cmdb.get("vcpu") if cmdb else None),
            vram_gb=v.get("vram_gb") or (cmdb.get("vram_gb") if cmdb else None),
        ))

    # Oldest first; VMs without creation date go to the end
    items.sort(key=lambda x: (x.age_days is None, -(x.age_days or 0)))
    oldest = max((x.age_days for x in items if x.age_days is not None), default=None)

    result = VmAgeResponse(
        vms=items,
        total=len(items),
        with_create_date=with_create_date,
        oldest_days=oldest,
        synced_at=synced_at,
    )
    response_cache.put("vm-age", result)
    return result
