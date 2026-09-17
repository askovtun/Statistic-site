"""Security / Risk Dashboard — aggregates EOL, unmonitored, and OS-unknown servers."""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import SecurityDashboardResponse, SecurityServerItem
from app.services import db, os_lifecycle, response_cache

router = APIRouter(tags=["security"])

_CACHE_TTL = 300


@router.get("/security-dashboard", response_model=SecurityDashboardResponse)
async def get_security_dashboard() -> SecurityDashboardResponse:
    cached = response_cache.get("security-dashboard", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached          = db.get("vms")
    phys_cached         = db.get("physical_servers")
    vm_hostid_cached    = db.get("vm_hostid_map")
    phys_hostid_cached  = db.get("phys_hostid_map")
    vc_vms_cached       = db.get("vcenter_vms")
    moid_map_cached     = db.get("vm_moid_map")

    vms:    list[dict] = vms_cached[0]   if vms_cached   else []
    phys:   list[dict] = phys_cached[0]  if phys_cached  else []
    synced_at: str | None = vms_cached[1] if vms_cached  else None

    vm_hostid_map:   dict[str, str] = vm_hostid_cached[0]   if vm_hostid_cached   else {}
    phys_hostid_map: dict[str, str] = phys_hostid_cached[0] if phys_hostid_cached else {}
    vc_vms:          list[dict]     = vc_vms_cached[0]      if vc_vms_cached      else []
    moid_map:        dict[str, str] = moid_map_cached[0]    if moid_map_cached    else {}

    vc_by_moid = {v["moid"]: v for v in vc_vms}

    eol_items: list[SecurityServerItem] = []
    ending_soon_items: list[SecurityServerItem] = []
    unknown_os_items: list[SecurityServerItem] = []
    no_version_items: list[SecurityServerItem] = []

    for vm in vms:
        name = vm.get("name", "")
        moid = moid_map.get(name)
        vc_vm = vc_by_moid.get(moid) if moid else None

        os_raw = (vc_vm["os_full_name"] if vc_vm and vc_vm.get("os_full_name")
                  else vm.get("os_family"))

        entry = os_lifecycle.match_os(os_raw)
        status, days = os_lifecycle.get_status(entry)

        item = SecurityServerItem(
            name=name,
            ci_type="vm",
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            os_raw=os_raw,
            os_product=entry["product"] if entry else None,
            os_status=status,
            eol_date=entry["eol_date"] if entry else None,
            days_until_eol=days,
        )
        if status == "eol":
            eol_items.append(item)
        elif status == "ending_soon":
            ending_soon_items.append(item)
        elif status == "unknown":
            if os_lifecycle.is_known_brand(os_raw):
                no_version_items.append(item)
            else:
                unknown_os_items.append(item)

    eol_items.sort(key=lambda x: (x.days_until_eol is None, x.days_until_eol or 0))
    ending_soon_items.sort(key=lambda x: (x.days_until_eol is None, x.days_until_eol or 0))
    unknown_os_items.sort(key=lambda x: x.name)
    no_version_items.sort(key=lambda x: x.name)

    monitored_vm_names   = set(vm_hostid_map.keys())
    monitored_phys_names = set(phys_hostid_map.keys())

    unmonitored_vms = [
        SecurityServerItem(
            name=vm.get("name", ""),
            ci_type="vm",
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            os_raw=vm.get("os_family"),
        )
        for vm in vms
        if vm.get("name") and vm["name"] not in monitored_vm_names
    ]
    unmonitored_phys = [
        SecurityServerItem(
            name=s.get("name", ""),
            ci_type="physical",
            fqdn=s.get("fqdn"),
            primary_ip=s.get("primary_ip"),
        )
        for s in phys
        if s.get("name") and s["name"] not in monitored_phys_names
    ]

    result = SecurityDashboardResponse(
        eol_count=len(eol_items),
        ending_soon_count=len(ending_soon_items),
        unmonitored_vm_count=len(unmonitored_vms),
        unmonitored_phys_count=len(unmonitored_phys),
        unknown_os_count=len(unknown_os_items),
        no_version_count=len(no_version_items),
        eol_items=eol_items,
        ending_soon_items=ending_soon_items,
        unmonitored_vms=unmonitored_vms,
        unmonitored_phys=unmonitored_phys,
        unknown_os_items=unknown_os_items,
        no_version_items=no_version_items,
        synced_at=synced_at,
    )
    response_cache.put("security-dashboard", result)
    return result
