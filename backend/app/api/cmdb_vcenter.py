"""CMDB vs vCenter parameter comparison: detect config drift.

Covers both VMs and physical servers. Name matching strips common
prefixes (vm-, srv-, server-) before comparing, so CMDB 'VM-foo'
matches vCenter 'foo'.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException

from app.models.schemas import CmdbVcenterDiffItem, CmdbVcenterDiffResponse
from app.services import db

router = APIRouter(tags=["cmdb-vcenter"])

# Prefixes to strip when normalising names for fallback matching
_PREFIX_RE = re.compile(r"^(?:vm|srv|server)-+", re.IGNORECASE)


def _norm(name: str | None) -> str:
    """Lowercase + strip domain suffix."""
    if not name:
        return ""
    return name.lower().split(".")[0].strip()


def _norm_stripped(name: str | None) -> str:
    """Lowercase + strip domain suffix + strip vm-/srv- prefix."""
    return _PREFIX_RE.sub("", _norm(name))


def _int_ne(a: int | None, b: int | None) -> bool:
    """True only when BOTH values present AND they differ (missing = no diff)."""
    if a is None or b is None:
        return False
    return int(a) != int(b)


_CLUSTER_PREFIX_RE = re.compile(r"^(?:CLR|CLUSTER|CL|CLS)-+", re.IGNORECASE)


def _norm_cluster(s: str | None) -> str:
    if not s:
        return ""
    return _CLUSTER_PREFIX_RE.sub("", s.strip()).lower()


def _str_ne(a: str | None, b: str | None) -> bool:
    """True only when BOTH values present AND they differ after normalisation."""
    na, nb = _norm_cluster(a), _norm_cluster(b)
    if not na or not nb:
        return False
    return na != nb


@router.get("/cmdb-vcenter-diff", response_model=CmdbVcenterDiffResponse)
async def get_cmdb_vcenter_diff() -> CmdbVcenterDiffResponse:
    vms_cached      = db.get("vms")
    phys_cached     = db.get("physical_servers")
    moid_map_cached = db.get("vm_moid_map")
    vc_vms_cached   = db.get("vcenter_vms")
    vc_hosts_cached = db.get("vcenter_hosts")

    if not vms_cached:
        raise HTTPException(
            status_code=503,
            detail="Дані ще не синхронізовано. Натисніть «Оновити дані».",
        )

    vms: list[dict]              = vms_cached[0]
    synced_at: str | None        = vms_cached[1]
    phys: list[dict]             = phys_cached[0] if phys_cached else []
    vm_moid_map: dict[str, str]  = moid_map_cached[0] if moid_map_cached else {}
    vc_vms: list[dict]           = vc_vms_cached[0] if vc_vms_cached else []
    vc_hosts: list[dict]         = vc_hosts_cached[0] if vc_hosts_cached else []

    # ── vCenter lookups ───────────────────────────────────────────────────────
    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vc_vms if v.get("moid")}

    # Fallback: normalised name → vCenter VM (for vm-/srv- prefix stripping)
    vc_by_norm: dict[str, dict] = {}
    for v in vc_vms:
        key = _norm(v.get("name"))
        if key:
            vc_by_norm.setdefault(key, v)
    # Also index by stripped name so CMDB 'VM-foo' finds vCenter 'foo'
    vc_by_stripped: dict[str, dict] = {}
    for v in vc_vms:
        key = _norm_stripped(v.get("name"))
        if key:
            vc_by_stripped.setdefault(key, v)

    # Host MOID → cluster name
    host_cluster: dict[str, str] = {
        h["moid"]: h["cluster"]
        for h in vc_hosts
        if h.get("moid") and h.get("cluster")
    }

    # ── Process records ───────────────────────────────────────────────────────
    items: list[CmdbVcenterDiffItem] = []
    matched          = 0
    with_diff        = 0
    vcpu_diff_count  = 0
    vram_diff_count  = 0
    cluster_diff_count = 0

    def _find_vc_vm(name: str, ci_type: str, fqdn: str | None, primary_ip: str | None) -> dict | None:
        """Try vm_moid_map first, then normalised-name fallback."""
        moid = vm_moid_map.get(name)
        if moid and moid in vc_by_moid:
            return vc_by_moid[moid]
        # Fallback 1: exact normalised name match (FQDN → short name)
        for candidate in (name, fqdn):
            key = _norm(candidate)
            if key and key in vc_by_norm:
                return vc_by_norm[key]
        # Fallback 2: strip vm-/srv- prefix from CMDB name, look for bare name in vCenter
        stripped = _norm_stripped(name)
        if stripped and stripped in vc_by_stripped:
            return vc_by_stripped[stripped]
        # Fallback 3: strip prefix from CMDB, try norm index (covers vCenter FQDN entries)
        if stripped and stripped in vc_by_norm:
            return vc_by_norm[stripped]
        return None

    def _process(record: dict, ci_type: str) -> None:
        nonlocal matched, with_diff, vcpu_diff_count, vram_diff_count, cluster_diff_count

        name = record.get("name")
        if not name:
            return

        fqdn       = record.get("fqdn")
        primary_ip = record.get("primary_ip")

        # CMDB hardware values
        if ci_type == "vm":
            cmdb_vcpu    = record.get("vcpu")
            cmdb_vram_gb = record.get("vram_gb")
            cmdb_cluster = record.get("cluster")
        else:
            # Physical: cpu_cores → vcpu equivalent, ram_gb → vram_gb
            cmdb_vcpu    = record.get("cpu_cores")
            cmdb_vram_gb = record.get("ram_gb")
            cmdb_cluster = None

        cmdb_status = record.get("cmdb_status") or record.get("status")
        cmdb_os     = record.get("os_raw") or record.get("os_family")

        vc_vm = _find_vc_vm(name, ci_type, fqdn, primary_ip)

        if vc_vm:
            matched += 1
            vc_vcpu      = vc_vm.get("vcpu")
            vc_vram_gb   = vc_vm.get("vram_gb")
            runtime_host = vc_vm.get("runtime_host")
            vc_cluster   = host_cluster.get(runtime_host) if runtime_host else None

            vcpu_diff    = _int_ne(cmdb_vcpu, vc_vcpu)
            vram_diff    = _int_ne(cmdb_vram_gb, vc_vram_gb)
            cluster_diff = _str_ne(cmdb_cluster, vc_cluster)

            if vcpu_diff:    vcpu_diff_count    += 1
            if vram_diff:    vram_diff_count    += 1
            if cluster_diff: cluster_diff_count += 1

            diff_count = sum([vcpu_diff, vram_diff, cluster_diff])
            if diff_count > 0:
                with_diff += 1

            items.append(CmdbVcenterDiffItem(
                name=name, ci_type=ci_type,
                fqdn=fqdn, primary_ip=primary_ip,
                in_vcenter=True,
                cmdb_vcpu=cmdb_vcpu, cmdb_vram_gb=cmdb_vram_gb,
                cmdb_cluster=cmdb_cluster, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
                vc_vcpu=vc_vcpu, vc_vram_gb=vc_vram_gb,
                vc_cluster=vc_cluster,
                vc_power_state=vc_vm.get("power_state"),
                vc_os=vc_vm.get("os_full_name"),
                vcpu_diff=vcpu_diff, vram_diff=vram_diff, cluster_diff=cluster_diff,
                diff_count=diff_count,
            ))
        else:
            items.append(CmdbVcenterDiffItem(
                name=name, ci_type=ci_type,
                fqdn=fqdn, primary_ip=primary_ip,
                in_vcenter=False,
                cmdb_vcpu=cmdb_vcpu, cmdb_vram_gb=cmdb_vram_gb,
                cmdb_cluster=cmdb_cluster, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
            ))

    for vm in vms:
        _process(vm, "vm")
    for srv in phys:
        _process(srv, "physical")

    # Sort: diffs first, then CMDB-only, then OK — alphabetically within each group
    items.sort(key=lambda i: (-i.diff_count, not i.in_vcenter, i.name.lower()))

    return CmdbVcenterDiffResponse(
        total=len(items),
        matched=matched,
        cmdb_only=sum(1 for i in items if not i.in_vcenter),
        with_diff=with_diff,
        vcpu_diff_count=vcpu_diff_count,
        vram_diff_count=vram_diff_count,
        cluster_diff_count=cluster_diff_count,
        items=items,
        synced_at=synced_at,
    )
