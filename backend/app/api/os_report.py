from fastapi import APIRouter
from app.models.schemas import OsReportResponse, OsServerItem, OsSummaryItem
from app.services import db, os_lifecycle

router = APIRouter(tags=["os-report"])

_STATUS_ORDER = {"eol": 0, "ending_soon": 1, "supported": 2, "unknown": 3}


@router.get("/os-report", response_model=OsReportResponse)
async def get_os_report():
    """OS lifecycle report: per-VM OS status (supported / ending soon / EOL).

    OS source priority:
      1. vm.guest.guestFullName from vCenter (VMware Tools, OS from inside the VM)
      2. vm.config.guestFullName from vCenter (vmx config file, fallback)
      3. os_family from Jira CMDB (last resort, often lacks version info)
    """
    vms_cached       = db.get("vms")
    phys_cached      = db.get("physical_servers")
    vc_vms_cached    = db.get("vcenter_vms")
    moid_map_cached  = db.get("vm_moid_map")

    if vms_cached is None:
        return OsReportResponse(
            total_servers=0, supported=0, ending_soon=0, eol=0, unknown=0,
            os_types=[], servers=[], synced_at=None,
        )

    vms, updated_at = vms_cached
    physical_servers: list[dict] = phys_cached[0] if phys_cached else []

    # Build lookup: MOID → vCenter VM dict (has os_full_name, os_from_tools)
    vc_by_moid: dict[str, dict] = {}
    if vc_vms_cached:
        for v in vc_vms_cached[0]:
            vc_by_moid[v["moid"]] = v

    # Build lookup: CMDB VM name → MOID
    vm_moid_map: dict[str, str] = moid_map_cached[0] if moid_map_cached else {}

    servers: list[OsServerItem] = []

    # ── Virtual Machines ──────────────────────────────────────────────────────
    for vm in vms:
        name = vm.get("name", "")

        # Resolve OS: vCenter (Tools) > vCenter (config) > CMDB
        moid    = vm_moid_map.get(name)
        vc_vm   = vc_by_moid.get(moid) if moid else None

        if vc_vm and vc_vm.get("os_full_name"):
            os_raw      = vc_vm["os_full_name"]
            from_tools  = bool(vc_vm.get("os_from_tools"))
        else:
            os_raw      = vm.get("os_family")   # CMDB fallback
            from_tools  = False

        entry  = os_lifecycle.match_os(os_raw)
        status, days = os_lifecycle.get_status(entry)

        servers.append(OsServerItem(
            name=name,
            ci_type="vm",
            os_raw=os_raw,
            os_product=entry["product"] if entry else None,
            os_vendor=entry["vendor"] if entry else None,
            os_status=status,
            eol_date=entry["eol_date"] if entry else None,
            days_until_eol=days,
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            os_from_tools=from_tools,
        ))

    # ── Physical servers (OS not tracked in current CMDB data pull) ───────────
    for srv in physical_servers:
        servers.append(OsServerItem(
            name=srv.get("name", ""),
            ci_type="physical",
            os_raw=None,
            os_product=None,
            os_vendor=None,
            os_status="unknown",
            eol_date=None,
            days_until_eol=None,
            cluster=None,
            fqdn=srv.get("fqdn"),
            primary_ip=srv.get("primary_ip"),
            os_from_tools=False,
        ))

    # ── Group by OS name → summary ────────────────────────────────────────────
    os_groups: dict[str, list[OsServerItem]] = {}
    for s in servers:
        key = s.os_raw or "Невідомо"
        os_groups.setdefault(key, []).append(s)

    os_types: list[OsSummaryItem] = []
    for os_raw_key, items in os_groups.items():
        sample = items[0]
        os_types.append(OsSummaryItem(
            os_raw=os_raw_key,
            os_product=sample.os_product,
            os_vendor=sample.os_vendor,
            os_status=sample.os_status,
            eol_date=sample.eol_date,
            days_until_eol=sample.days_until_eol,
            server_count=len(items),
        ))

    os_types.sort(key=lambda x: (
        _STATUS_ORDER.get(x.os_status, 4),
        x.days_until_eol if x.days_until_eol is not None else 999_999,
    ))

    return OsReportResponse(
        total_servers=len(servers),
        supported=sum(1 for s in servers if s.os_status == "supported"),
        ending_soon=sum(1 for s in servers if s.os_status == "ending_soon"),
        eol=sum(1 for s in servers if s.os_status == "eol"),
        unknown=sum(1 for s in servers if s.os_status == "unknown"),
        os_types=os_types,
        servers=servers,
        synced_at=updated_at,
    )
