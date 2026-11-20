"""CMDB vs vCenter parameter comparison: detect config drift.

Covers both VMs and physical servers. Name matching strips common
prefixes (vm-, srv-, server-) before comparing, so CMDB 'VM-foo'
matches vCenter 'foo'.
"""
from __future__ import annotations

import re

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import CmdbVcenterDiffItem, CmdbVcenterDiffResponse
from app.services import db, jira_client, response_cache

log = logging.getLogger(__name__)

router = APIRouter(tags=["cmdb-vcenter"])

_CACHE_TTL = 300

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


def _ip_ne(a: str | None, b: str | None) -> bool:
    """True only when BOTH IPs are present AND differ (stripped comparison)."""
    na = (a or "").strip()
    nb = (b or "").strip()
    if not na or not nb:
        return False
    return na != nb


def _is_ipv4(ip: str | None) -> bool:
    """True for a non-empty string that looks like an IPv4 address."""
    s = (ip or "").strip()
    return bool(s) and ":" not in s and "." in s


def _ip_should_sync(cmdb_ip: str | None, vc_ip: str | None) -> bool:
    """True when vCenter has a valid IPv4 and CMDB is empty or different.

    This covers both 'fill in missing IP' and 'update changed IP' cases.
    IPv6 addresses (including link-local fe80::) are excluded.
    """
    if not _is_ipv4(vc_ip):
        return False
    return (vc_ip or "").strip() != (cmdb_ip or "").strip()


def _fqdn_ne(a: str | None, b: str | None) -> bool:
    """True only when BOTH hostnames present AND differ after normalisation (short name only)."""
    na = _norm(a)
    nb = _norm(b)
    if not na or not nb:
        return False
    return na != nb


def _fqdn_should_sync(cmdb_fqdn: str | None, vc_hostname: str | None) -> bool:
    """True when vCenter has a hostname and CMDB is empty or has a different short name."""
    nb = _norm(vc_hostname)
    if not nb:
        return False
    return _norm(cmdb_fqdn) != nb


@router.get("/cmdb-vcenter-diff", response_model=CmdbVcenterDiffResponse)
async def get_cmdb_vcenter_diff() -> CmdbVcenterDiffResponse:
    cached = response_cache.get("cmdb-vcenter-diff", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

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

    # ESXi host indexes: normalised name → host dict
    vc_host_by_norm: dict[str, dict] = {}
    for h in vc_hosts:
        for candidate in (h.get("name"), ):
            key = _norm(candidate)
            if key:
                vc_host_by_norm.setdefault(key, h)
    _HOST_PREFIX_RE = re.compile(r"^(?:esxi|esx|hv|hyp|hypervisor)-+", re.IGNORECASE)
    vc_host_by_stripped: dict[str, dict] = {}
    for h in vc_hosts:
        key = _HOST_PREFIX_RE.sub("", _norm(h.get("name")))
        if key:
            vc_host_by_stripped.setdefault(key, h)

    # ── Process records ───────────────────────────────────────────────────────
    items: list[CmdbVcenterDiffItem] = []
    matched            = 0
    with_diff          = 0
    vcpu_diff_count    = 0
    vram_diff_count    = 0
    cluster_diff_count = 0
    ip_diff_count      = 0
    fqdn_diff_count    = 0

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

    def _find_vc_host(name: str, fqdn: str | None) -> dict | None:
        """Try to match CMDB physical server against ESXi hosts."""
        for candidate in (name, fqdn):
            key = _norm(candidate)
            if key and key in vc_host_by_norm:
                return vc_host_by_norm[key]
        stripped = _HOST_PREFIX_RE.sub("", _norm(name))
        if stripped and stripped in vc_host_by_stripped:
            return vc_host_by_stripped[stripped]
        if stripped and stripped in vc_host_by_norm:
            return vc_host_by_norm[stripped]
        return None

    def _process(record: dict, ci_type: str) -> None:
        nonlocal matched, with_diff, vcpu_diff_count, vram_diff_count, cluster_diff_count, ip_diff_count, fqdn_diff_count

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
            # Physical: total_cores = cpu_count (sockets) × cpu_cores (cores per socket)
            cpu_count = record.get("cpu_count")
            cpu_cores = record.get("cpu_cores")
            if cpu_count and cpu_cores:
                cmdb_vcpu = int(cpu_count) * int(cpu_cores)
            else:
                cmdb_vcpu = cpu_cores  # fallback if only cores known
            cmdb_vram_gb = record.get("ram_gb")
            cmdb_cluster = None

        cmdb_status = record.get("cmdb_status") or record.get("status")
        cmdb_os     = record.get("os_raw") or record.get("os_family")

        vc_vm = _find_vc_vm(name, ci_type, fqdn, primary_ip)

        # Extra fields for physical breakdown display
        cmdb_cpu_count = record.get("cpu_count") if ci_type == "physical" else None
        cmdb_cpu_cores = record.get("cpu_cores") if ci_type == "physical" else None

        if vc_vm:
            matched += 1
            vc_vcpu      = vc_vm.get("vcpu")
            vc_vram_gb   = vc_vm.get("vram_gb")
            vc_ip        = vc_vm.get("guest_ip")
            vc_hostname  = vc_vm.get("guest_hostname")
            runtime_host = vc_vm.get("runtime_host")
            vc_cluster   = host_cluster.get(runtime_host) if runtime_host else None

            vcpu_diff    = _int_ne(cmdb_vcpu, vc_vcpu)
            vram_diff    = _int_ne(cmdb_vram_gb, vc_vram_gb)
            cluster_diff = _str_ne(cmdb_cluster, vc_cluster)
            ip_diff      = _ip_should_sync(primary_ip, vc_ip)
            fqdn_diff    = _fqdn_should_sync(fqdn, vc_hostname)

            if vcpu_diff:    vcpu_diff_count    += 1
            if vram_diff:    vram_diff_count    += 1
            if cluster_diff: cluster_diff_count += 1
            if ip_diff:      ip_diff_count      += 1
            if fqdn_diff:    fqdn_diff_count    += 1

            diff_count = sum([vcpu_diff, vram_diff, cluster_diff, ip_diff, fqdn_diff])
            if diff_count > 0:
                with_diff += 1

            items.append(CmdbVcenterDiffItem(
                name=name, ci_type=ci_type,
                jira_id=record.get("jira_id"),
                fqdn=fqdn, primary_ip=primary_ip,
                in_vcenter=True,
                cmdb_vcpu=cmdb_vcpu, cmdb_cpu_count=cmdb_cpu_count, cmdb_cpu_cores=cmdb_cpu_cores,
                cmdb_vram_gb=cmdb_vram_gb,
                cmdb_cluster=cmdb_cluster, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
                vc_vcpu=vc_vcpu, vc_vram_gb=vc_vram_gb,
                vc_cluster=vc_cluster,
                vc_power_state=vc_vm.get("power_state"),
                vc_os=vc_vm.get("os_full_name"),
                vc_ip=vc_ip, vc_hostname=vc_hostname,
                vcpu_diff=vcpu_diff, vram_diff=vram_diff, cluster_diff=cluster_diff,
                ip_diff=ip_diff, fqdn_diff=fqdn_diff,
                diff_count=diff_count,
            ))
        elif ci_type == "physical":
            # For physical servers not found in vcenter_vms, try ESXi host match
            vc_host = _find_vc_host(name, fqdn)
            if vc_host:
                matched += 1
                vc_vcpu     = vc_host.get("num_cpu_cores")
                vc_vram_gb  = vc_host.get("memory_gb")
                vc_cluster  = vc_host.get("cluster")
                vc_ip       = vc_host.get("management_ip")
                vc_hostname = vc_host.get("name")

                vcpu_diff    = _int_ne(cmdb_vcpu, vc_vcpu)
                vram_diff    = _int_ne(cmdb_vram_gb, vc_vram_gb)
                cluster_diff = False  # physical servers have no cluster in CMDB
                ip_diff      = _ip_should_sync(primary_ip, vc_ip)
                fqdn_diff    = _fqdn_should_sync(fqdn, vc_hostname)

                if vcpu_diff:  vcpu_diff_count  += 1
                if vram_diff:  vram_diff_count  += 1
                if ip_diff:    ip_diff_count    += 1
                if fqdn_diff:  fqdn_diff_count  += 1

                diff_count = sum([vcpu_diff, vram_diff, ip_diff, fqdn_diff])
                if diff_count > 0:
                    with_diff += 1

                items.append(CmdbVcenterDiffItem(
                    name=name, ci_type="hypervisor",
                    jira_id=record.get("jira_id"),
                    fqdn=fqdn, primary_ip=primary_ip,
                    in_vcenter=True,
                    cmdb_vcpu=cmdb_vcpu, cmdb_cpu_count=cmdb_cpu_count, cmdb_cpu_cores=cmdb_cpu_cores,
                    cmdb_vram_gb=cmdb_vram_gb,
                    cmdb_cluster=None, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
                    vc_vcpu=vc_vcpu, vc_vram_gb=vc_vram_gb,
                    vc_cluster=vc_cluster,
                    vc_power_state=vc_host.get("power_state"),
                    vc_os=vc_host.get("os_version"),
                    vc_ip=vc_ip, vc_hostname=vc_hostname,
                    vcpu_diff=vcpu_diff, vram_diff=vram_diff, cluster_diff=False,
                    ip_diff=ip_diff, fqdn_diff=fqdn_diff,
                    diff_count=diff_count,
                ))
            else:
                items.append(CmdbVcenterDiffItem(
                    name=name, ci_type=ci_type,
                    jira_id=record.get("jira_id"),
                    fqdn=fqdn, primary_ip=primary_ip,
                    in_vcenter=False,
                    cmdb_vcpu=cmdb_vcpu, cmdb_cpu_count=cmdb_cpu_count, cmdb_cpu_cores=cmdb_cpu_cores,
                    cmdb_vram_gb=cmdb_vram_gb,
                    cmdb_cluster=cmdb_cluster, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
                ))
        else:
            items.append(CmdbVcenterDiffItem(
                name=name, ci_type=ci_type,
                jira_id=record.get("jira_id"),
                fqdn=fqdn, primary_ip=primary_ip,
                in_vcenter=False,
                cmdb_vcpu=cmdb_vcpu, cmdb_cpu_count=cmdb_cpu_count, cmdb_cpu_cores=cmdb_cpu_cores,
                cmdb_vram_gb=cmdb_vram_gb,
                cmdb_cluster=cmdb_cluster, cmdb_status=cmdb_status, cmdb_os=cmdb_os,
            ))

    for vm in vms:
        _process(vm, "vm")
    for srv in phys:
        _process(srv, "physical")

    # Sort: diffs first, then CMDB-only, then OK — alphabetically within each group
    items.sort(key=lambda i: (-i.diff_count, not i.in_vcenter, i.name.lower()))

    result = CmdbVcenterDiffResponse(
        total=len(items),
        matched=matched,
        cmdb_only=sum(1 for i in items if not i.in_vcenter),
        with_diff=with_diff,
        vcpu_diff_count=vcpu_diff_count,
        vram_diff_count=vram_diff_count,
        cluster_diff_count=cluster_diff_count,
        ip_diff_count=ip_diff_count,
        fqdn_diff_count=fqdn_diff_count,
        items=items,
        synced_at=synced_at,
    )
    response_cache.put("cmdb-vcenter-diff", result)
    return result


# ── Sync vCenter → CMDB ───────────────────────────────────────────────────────

@router.post("/cmdb-vcenter-sync")
async def sync_cmdb_from_vcenter():
    """For every VM with parameter diffs, write vCenter values into Jira CMDB.

    Only fields that actually differ are updated (vcpu, vram_gb, cluster).
    Physical servers are skipped — vCenter is not authoritative for their hw.
    """
    # Build diff data (uses cache when fresh)
    diff_data = await get_cmdb_vcenter_diff()

    # Build cluster name (normalised) → Jira object ID map
    clusters_cached = db.get("clusters")
    clusters: list[dict] = clusters_cached[0] if clusters_cached else []
    cluster_jira_map: dict[str, str] = {}
    for c in clusters:
        key = _norm_cluster(c.get("name", ""))
        jid = str(c.get("jira_id", "")).strip()
        if key and jid:
            cluster_jira_map[key] = jid

    updated = 0
    skipped = 0
    cluster_skipped = 0
    clusters_created = 0
    errors: list[dict] = []

    # ── Load vCenter hosts for cluster data ──────────────────────────────────
    vc_hosts_cached = db.get("vcenter_hosts")
    vc_hosts: list[dict] = vc_hosts_cached[0] if vc_hosts_cached else []
    # cluster_name → list of vCenter host dicts
    vc_cluster_hosts: dict[str, list[dict]] = {}
    for h in vc_hosts:
        cl = h.get("cluster")
        if cl:
            vc_cluster_hosts.setdefault(cl, []).append(h)

    # ── Step 1: Create missing clusters ──────────────────────────────────────
    # Collect unique vCenter cluster names that have no CMDB counterpart
    missing_clusters: dict[str, str] = {}  # norm_name → original_name
    for item in diff_data.items:
        if item.ci_type != "vm" or not item.cluster_diff or not item.vc_cluster:
            continue
        norm = _norm_cluster(item.vc_cluster)
        if norm not in cluster_jira_map and norm not in missing_clusters:
            missing_clusters[norm] = item.vc_cluster

    newly_created: dict[str, str] = {}  # norm_name → new jira_id
    for norm, vc_cluster_name in missing_clusters.items():
        try:
            # Check if cluster already exists in Jira (avoid duplicates on repeated sync)
            existing_jira_id = await jira_client.find_cluster_by_name(vc_cluster_name)
            if existing_jira_id:
                log.info("Sync: cluster '%s' already exists in Jira (jira_id=%s) — skipping create",
                         vc_cluster_name, existing_jira_id)
                cluster_jira_map[norm] = existing_jira_id
                newly_created[norm] = existing_jira_id
                continue

            hosts_for_cluster = vc_cluster_hosts.get(vc_cluster_name, [])
            host_count = len(hosts_for_cluster) or None
            total_cpu_cores = sum(h.get("num_cpu_cores") or 0 for h in hosts_for_cluster) or None
            total_ram_gb = int(sum(h.get("memory_gb") or 0 for h in hosts_for_cluster)) or None
            # Count VMs with this cluster from diff data
            vm_count = sum(
                1 for i in diff_data.items
                if i.ci_type == "vm" and _norm_cluster(i.vc_cluster or "") == norm
            ) or None

            # Detect cluster type from vCenter name
            uname = vc_cluster_name.upper()
            if "VSAN" in uname:
                cluster_type = "VMware vSAN"
            elif "HYPER" in uname or "HV" in uname:
                cluster_type = "Microsoft Hyper-V"
            else:
                cluster_type = "VMware HA/DRS"

            new_obj = await jira_client.create_cluster(
                vcenter_name=vc_cluster_name,
                cluster_type=cluster_type,
                host_count=host_count,
                total_cpu_cores=total_cpu_cores,
                total_ram_gb=total_ram_gb,
                vm_count=vm_count,
            )
            new_jira_id = str(new_obj.get("id", ""))
            if new_jira_id:
                cluster_jira_map[norm] = new_jira_id
                newly_created[norm] = new_jira_id
                clusters_created += 1
                log.info(
                    "Sync: created cluster 'CLR-%s' → jira_id=%s (type=%s, hosts=%s, cores=%s, ram=%sGB, vms=%s)",
                    vc_cluster_name, new_jira_id, cluster_type, host_count, total_cpu_cores, total_ram_gb, vm_count,
                )
        except Exception:
            log.exception("Sync: failed to create cluster '%s'", vc_cluster_name)

    # ── Step 2: Link Hypervisor Platform objects to newly created clusters ────
    # For each new cluster, find its vCenter hosts, search Jira Hypervisor Platform
    # (type 84) by name/FQDN, then update the cluster (Hypervisor Hosts attr) and
    # each hypervisor platform (Cluster attr) bidirectionally.
    if newly_created:
        for norm, cluster_jid in newly_created.items():
            # Find the original vCenter cluster name for this norm key
            vc_cluster_name = missing_clusters.get(norm)
            if not vc_cluster_name:
                continue
            hosts_for_cluster = vc_cluster_hosts.get(vc_cluster_name, [])
            if not hosts_for_cluster:
                continue

            found_hp_ids: list[str] = []
            for h in hosts_for_cluster:
                host_name = h.get("name") or ""
                if not host_name:
                    continue
                try:
                    hp_jira_id = await jira_client.find_hypervisor_platform_by_host_name(host_name)
                    if hp_jira_id:
                        found_hp_ids.append(hp_jira_id)
                        # Update Hypervisor Platform → Cluster (bidirectional)
                        await jira_client.update_hypervisor_platform_cluster(
                            hypervisor_jira_id=hp_jira_id,
                            cluster_jira_id=cluster_jid,
                        )
                        log.info("Sync: linked hypervisor '%s' (jira_id=%s) → cluster jira_id=%s",
                                 host_name, hp_jira_id, cluster_jid)
                        # Also link to Physical Server if serial_number available
                        serial = h.get("serial_number")
                        if serial:
                            ps_jira_id = await jira_client.find_physical_server_by_serial(serial)
                            if ps_jira_id:
                                await jira_client.link_hypervisor_to_physical_server(hp_jira_id, ps_jira_id)
                                log.info("Sync: linked HP jira_id=%s <-> PS jira_id=%s (serial=%s)",
                                         hp_jira_id, ps_jira_id, serial)
                    else:
                        # Host not in CMDB — create it
                        try:
                            new_hp = await jira_client.create_hypervisor_platform(
                                host=h,
                                cluster_jira_id=cluster_jid,
                            )
                            new_hp_id = str(new_hp.get("id", ""))
                            if new_hp_id:
                                found_hp_ids.append(new_hp_id)
                                log.info("Sync: created Hypervisor Platform '%s' (jira_id=%s)",
                                         host_name, new_hp_id)
                            else:
                                log.warning("Sync: create_hypervisor_platform returned no id for '%s': %s",
                                            host_name, new_hp)
                        except Exception:
                            log.exception("Sync: failed to create Hypervisor Platform for '%s'", host_name)
                except Exception:
                    log.exception("Sync: error linking hypervisor '%s'", host_name)

            # Update Cluster → Hypervisor Hosts (multi-value reference)
            if found_hp_ids:
                try:
                    await jira_client.update_cluster_hypervisor_hosts(
                        cluster_jira_id=cluster_jid,
                        hypervisor_jira_ids=found_hp_ids,
                    )
                    log.info("Sync: set Hypervisor Hosts on cluster jira_id=%s → %s",
                             cluster_jid, found_hp_ids)
                except Exception:
                    log.exception("Sync: failed to set Hypervisor Hosts on cluster jira_id=%s", cluster_jid)

    # ── Step 3: Sync VM parameters ───────────────────────────────────────────
    for item in diff_data.items:
        if item.diff_count == 0 or not item.jira_id:
            skipped += 1
            continue

        # ── Hypervisor: sync IP and FQDN (vCenter is authoritative for network config)
        if item.ci_type == "hypervisor":
            if not item.ip_diff and not item.fqdn_diff:
                skipped += 1
                continue
            try:
                await jira_client.update_physical_server(
                    jira_id=item.jira_id,
                    primary_ip=item.vc_ip if item.ip_diff else None,
                    fqdn=item.vc_hostname if item.fqdn_diff else None,
                )
                log.info("Sync: updated hypervisor '%s' (jira_id=%s) ip=%s fqdn=%s",
                         item.name, item.jira_id, item.vc_ip, item.vc_hostname)
                updated += 1
            except Exception:
                log.exception("Sync: failed to update hypervisor '%s'", item.name)
                errors.append({"name": item.name, "error": "Помилка оновлення в Jira"})
            continue

        # ── VM: sync vcpu / vram / cluster / ip
        if item.ci_type != "vm":
            skipped += 1
            continue

        try:
            vcpu         = item.vc_vcpu    if item.vcpu_diff  else None
            vram_gb      = item.vc_vram_gb if item.vram_diff  else None
            primary_ip   = item.vc_ip      if item.ip_diff    else None
            fqdn         = item.vc_hostname if item.fqdn_diff else None
            cluster_jira = None
            if item.cluster_diff and item.vc_cluster:
                cluster_jira = cluster_jira_map.get(_norm_cluster(item.vc_cluster))
                if not cluster_jira:
                    log.warning("Sync: no Jira cluster ID for vCenter '%s' (vm=%s)",
                                item.vc_cluster, item.name)
                    cluster_skipped += 1

            await jira_client.update_vm(
                jira_id=item.jira_id,
                vcpu=vcpu,
                vram_gb=vram_gb,
                cluster_jira_id=cluster_jira,
                primary_ip=primary_ip,
                fqdn=fqdn,
            )
            log.info("Sync: updated '%s' (jira_id=%s) vcpu=%s vram=%s cluster=%s ip=%s fqdn=%s",
                     item.name, item.jira_id, vcpu, vram_gb, cluster_jira, primary_ip, fqdn)
            updated += 1
        except Exception:
            log.exception("Sync: failed to update '%s'", item.name)
            errors.append({"name": item.name, "error": "Помилка оновлення в Jira"})

    # Invalidate diff cache so the next GET reflects the updated values
    response_cache.invalidate_prefix("cmdb-vcenter-diff")

    return {
        "updated": updated,
        "skipped": skipped,
        "cluster_skipped": cluster_skipped,
        "clusters_created": clusters_created,
        "errors": errors,
    }
