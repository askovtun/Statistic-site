from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query
from app.models.schemas import (
    OsProgressItem, OsProgressResponse, OsUpgradedServerItem,
    OsReportResponse, OsServerItem, OsSummaryItem,
)
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

    # ── Group by product+status+eol → summary ────────────────────────────────
    # Merge variants that resolve to the same product (e.g. "Windows Server 2016 (64-bit)"
    # and "Windows Server 2016 or later (64-bit)" both map to "Windows Server 2016").
    os_groups: dict[str, list[OsServerItem]] = {}
    for s in servers:
        if s.os_product:
            group_key = f"{s.os_product}|{s.os_status}|{s.eol_date or ''}"
        else:
            group_key = s.os_raw or "Невідомо"
        os_groups.setdefault(group_key, []).append(s)

    os_types: list[OsSummaryItem] = []
    for _key, items in os_groups.items():
        sample = items[0]
        # Use most-frequent raw name as the representative display string
        raw_freq: dict[str, int] = {}
        for i in items:
            if i.os_raw:
                raw_freq[i.os_raw] = raw_freq.get(i.os_raw, 0) + 1
        display_raw = max(raw_freq, key=raw_freq.__getitem__) if raw_freq else _key
        os_types.append(OsSummaryItem(
            os_raw=display_raw,
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


# ── OS Progress baseline ───────────────────────────────────────────────────────

@router.post("/os-progress/baseline")
async def set_os_baseline(label: str = Query(default="")):
    """Save the current OS distribution as a progress baseline snapshot."""
    report = await get_os_report()

    payload = {
        "taken_at": datetime.now(timezone.utc).isoformat(),
        "label": label or None,
        "total": report.total_servers,
        "supported": report.supported,
        "ending_soon": report.ending_soon,
        "eol": report.eol,
        "unknown": report.unknown,
        "os_types": [
            {
                "os_raw":       item.os_raw,
                "os_product":   item.os_product,
                "os_vendor":    item.os_vendor,
                "os_status":    item.os_status,
                "server_count": item.server_count,
            }
            for item in report.os_types
        ],
        # Per-server snapshot: name → os_status (used for upgrade tracking)
        "servers": {s.name: s.os_status for s in report.servers if s.os_raw is not None},
    }
    db.set("os_baseline", payload)
    return {"taken_at": payload["taken_at"], "total": payload["total"]}


@router.get("/os-progress", response_model=OsProgressResponse)
async def get_os_progress():
    """Compare current OS distribution against the saved baseline."""
    baseline_cached = db.get("os_baseline")
    current = await get_os_report()

    if baseline_cached is None:
        return OsProgressResponse(
            current_total=current.total_servers,
            current_eol=current.eol,
            current_ending_soon=current.ending_soon,
            current_supported=current.supported,
            current_unknown=current.unknown,
            items=[
                OsProgressItem(
                    os_raw=t.os_raw,
                    os_product=t.os_product,
                    os_vendor=t.os_vendor,
                    eol_date=t.eol_date,
                    current_status=t.os_status,
                    current_count=t.server_count,
                )
                for t in current.os_types
            ],
        )

    baseline = baseline_cached[0]
    base_by_raw: dict[str, dict] = {
        item["os_raw"]: item for item in baseline.get("os_types", [])
    }
    current_by_raw: dict[str, OsSummaryItem] = {t.os_raw: t for t in current.os_types}

    def _sort_key(k: str) -> tuple:
        if k in current_by_raw:
            return (_STATUS_ORDER.get(current_by_raw[k].os_status, 4), -current_by_raw[k].server_count)
        return (_STATUS_ORDER.get(base_by_raw[k].get("os_status", "unknown"), 4), 0)

    all_keys = sorted(set(base_by_raw) | set(current_by_raw), key=_sort_key)

    items: list[OsProgressItem] = []
    for key in all_keys:
        cur = current_by_raw.get(key)
        bas = base_by_raw.get(key)
        current_count  = cur.server_count if cur else 0
        current_status = cur.os_status if cur else bas.get("os_status", "unknown")  # type: ignore[union-attr]
        baseline_count  = bas["server_count"] if bas else None
        baseline_status = bas["os_status"]    if bas else None
        items.append(OsProgressItem(
            os_raw=key,
            os_product=cur.os_product if cur else (bas.get("os_product") if bas else None),
            os_vendor=cur.os_vendor if cur else (bas.get("os_vendor") if bas else None),
            eol_date=cur.eol_date if cur else None,
            current_status=current_status,   # type: ignore[arg-type]
            current_count=current_count,
            baseline_status=baseline_status,  # type: ignore[arg-type]
            baseline_count=baseline_count,
            delta=(current_count - baseline_count) if baseline_count is not None else None,
        ))

    # Upgraded servers: those that improved their OS status since baseline
    baseline_server_statuses: dict[str, str] = baseline.get("servers", {})
    current_server_map: dict[str, OsServerItem] = {s.name: s for s in current.servers}
    upgraded: list[OsUpgradedServerItem] = []
    if baseline_server_statuses:
        for name, b_status in baseline_server_statuses.items():
            srv = current_server_map.get(name)
            if srv is None:
                continue
            if _STATUS_ORDER.get(srv.os_status, 4) < _STATUS_ORDER.get(b_status, 4):
                upgraded.append(OsUpgradedServerItem(
                    name=name,
                    old_status=b_status,      # type: ignore[arg-type]
                    new_status=srv.os_status,
                    os_product=srv.os_product,
                    os_raw=srv.os_raw,
                    cluster=srv.cluster,
                    fqdn=srv.fqdn,
                    primary_ip=srv.primary_ip,
                ))
    upgraded.sort(key=lambda x: (x.new_status, x.name))

    b_eol  = baseline.get("eol")
    b_soon = baseline.get("ending_soon")
    b_supp = baseline.get("supported")
    return OsProgressResponse(
        baseline_taken_at=baseline.get("taken_at"),
        baseline_label=baseline.get("label"),
        baseline_total=baseline.get("total"),
        baseline_eol=b_eol,
        baseline_ending_soon=b_soon,
        baseline_supported=b_supp,
        baseline_unknown=baseline.get("unknown"),
        current_total=current.total_servers,
        current_eol=current.eol,
        current_ending_soon=current.ending_soon,
        current_supported=current.supported,
        current_unknown=current.unknown,
        eol_delta=(current.eol - b_eol) if b_eol is not None else None,
        ending_soon_delta=(current.ending_soon - b_soon) if b_soon is not None else None,
        supported_delta=(current.supported - b_supp) if b_supp is not None else None,
        items=items,
        upgraded_servers=upgraded,
    )
