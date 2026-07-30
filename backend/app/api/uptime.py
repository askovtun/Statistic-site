"""VM uptime report: days since last reboot, long-running and powered-off VMs."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import UptimeItem, UptimeResponse
from app.services import db

router = APIRouter()


@router.get("/uptime", response_model=UptimeResponse)
async def get_uptime() -> UptimeResponse:
    vcenter_vms_cached = db.get("vcenter_vms")
    vms_cached         = db.get("vms")
    moid_map_cached    = db.get("vm_moid_map")

    vcenter_vms: list[dict] = vcenter_vms_cached[0] if vcenter_vms_cached else []
    synced_at: str | None   = vcenter_vms_cached[1] if vcenter_vms_cached else None

    # name → cluster from CMDB
    cmdb_cluster: dict[str, str | None] = {
        vm["name"]: vm.get("cluster")
        for vm in (vms_cached[0] if vms_cached else [])
    }

    # moid → vm_name (reverse of moid_map)
    moid_to_name: dict[str, str] = {
        v: k for k, v in (moid_map_cached[0] if moid_map_cached else {}).items()
    }

    now = datetime.now(timezone.utc)
    items: list[UptimeItem] = []

    for vc_vm in vcenter_vms:
        moid        = vc_vm["moid"]
        name        = vc_vm.get("name") or moid_to_name.get(moid, moid)
        power_state = vc_vm.get("power_state", "unknown")
        boot_time   = vc_vm.get("boot_time")
        cluster     = cmdb_cluster.get(name)

        uptime_days: int | None = None
        if boot_time and power_state == "poweredOn":
            try:
                boot_dt = datetime.fromisoformat(boot_time)
                if boot_dt.tzinfo is None:
                    boot_dt = boot_dt.replace(tzinfo=timezone.utc)
                uptime_days = (now - boot_dt).days
            except Exception:
                pass

        items.append(UptimeItem(
            name=name,
            power_state=power_state,
            boot_time=boot_time,
            uptime_days=uptime_days,
            cluster=cluster,
        ))

    # Powered-on first, then by uptime days descending
    items.sort(key=lambda x: (0 if x.power_state == "poweredOn" else 1, -(x.uptime_days or 0)))

    return UptimeResponse(
        total=len(items),
        powered_on=sum(1 for i in items if i.power_state == "poweredOn"),
        powered_off=sum(1 for i in items if i.power_state == "poweredOff"),
        long_running=sum(1 for i in items if (i.uptime_days or 0) > 365),
        items=items,
        synced_at=synced_at,
    )
