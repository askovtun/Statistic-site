"""vCenter VMs and hypervisors not yet in Jira CMDB.

GET  /api/vcenter-new-vms        — list vCenter VMs/hypervisors with no matching CMDB entry
POST /api/vcenter-new-vms/import — create selected VMs in CMDB
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import db, jira_client, response_cache

router = APIRouter(tags=["vcenter-new-vms"])
log = logging.getLogger(__name__)

_CACHE_KEY = "vcenter-new-vms"
_CACHE_TTL = 300

_PREFIX_RE = re.compile(r"^(?:vm|srv|server)-+", re.IGNORECASE)
_CLUSTER_PREFIX_RE = re.compile(r"^(?:CLR|CLUSTER|CL|CLS)-+", re.IGNORECASE)


_HOST_PREFIX_RE = re.compile(r"^(?:esxi|esx|hv|hyp|hypervisor)-+", re.IGNORECASE)


def _norm(name: str | None) -> str:
    if not name:
        return ""
    return name.lower().split(".")[0].strip()


def _norm_stripped(name: str | None) -> str:
    return _PREFIX_RE.sub("", _norm(name))


def _norm_cluster(s: str | None) -> str:
    if not s:
        return ""
    return _CLUSTER_PREFIX_RE.sub("", s.strip()).lower()


def _cmdb_name(vc_name: str) -> str:
    """Generate CMDB-style name from vCenter VM name."""
    short = vc_name.split(".")[0].strip()
    if short.upper().startswith("VM-"):
        return short
    return f"VM-{short}"


def _build_cmdb_host_index(
    cmdb_vms: list[dict],
    phys_servers: list[dict],
) -> dict[str, dict]:
    """Combined short-name index over ALL CMDB objects (VMs + physical servers).
    Used to decide whether a vCenter ESXi host already exists in CMDB under any type.
    Strips common prefixes (VM-, SRV-, ESXi-, HV-) so that
    'VM-bc-vsan-witness' and 'bc-vsan-witness.epicentrk.ua' both resolve to
    the same key 'bc-vsan-witness'.
    """
    index: dict[str, dict] = {}
    for obj in [*cmdb_vms, *phys_servers]:
        name = obj.get("name") or ""
        fqdn = obj.get("fqdn") or ""
        for key in (_norm(name), _norm(fqdn)):
            if key:
                index.setdefault(key, obj)
        # Strip VM-/SRV- and ESXi-/HV- prefixes to get bare short name
        for prefix_re in (_PREFIX_RE, _HOST_PREFIX_RE):
            stripped = prefix_re.sub("", _norm(name))
            if stripped:
                index.setdefault(stripped, obj)
    return index


def _host_in_cmdb(vc_host: dict, cmdb_index: dict[str, dict]) -> bool:
    """Check whether a vCenter ESXi host already exists in CMDB (as VM or physical)."""
    name = vc_host.get("name") or ""
    short = _norm(name)
    for key in (short, _HOST_PREFIX_RE.sub("", short), _PREFIX_RE.sub("", short)):
        if key and key in cmdb_index:
            return True
    return False


def _build_cmdb_indexes(
    cmdb_vms: list[dict],
) -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
    by_norm: dict[str, dict] = {}
    by_stripped: dict[str, dict] = {}
    by_ip: dict[str, dict] = {}
    for vm in cmdb_vms:
        name = vm.get("name") or ""
        fqdn = vm.get("fqdn") or ""
        ip   = vm.get("primary_ip") or ""
        for key in (_norm(name), _norm(fqdn)):
            if key:
                by_norm.setdefault(key, vm)
        key_s = _norm_stripped(name)
        if key_s:
            by_stripped.setdefault(key_s, vm)
        if ip:
            by_ip[ip] = vm
    return by_norm, by_stripped, by_ip


def _in_cmdb(
    vc_vm: dict,
    by_norm: dict,
    by_stripped: dict,
    by_ip: dict,
    moid_set: set,
) -> bool:
    if vc_vm.get("moid") in moid_set:
        return True
    name     = vc_vm.get("name") or ""
    hostname = vc_vm.get("guest_hostname") or ""
    ip       = vc_vm.get("guest_ip") or ""
    for key in (_norm(name), _norm(hostname)):
        if key and key in by_norm:
            return True
    stripped = _norm_stripped(name)
    if stripped and (stripped in by_stripped or stripped in by_norm):
        return True
    if ip and ip in by_ip:
        return True
    return False


@router.get("/vcenter-new-vms")
async def get_vcenter_new_vms():
    """Return vCenter VMs and hypervisors that have no matching entry in the Jira CMDB."""
    cached = response_cache.get(_CACHE_KEY, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached      = db.get("vms")
    vc_vms_cached   = db.get("vcenter_vms")
    vc_hosts_cached = db.get("vcenter_hosts")
    moid_map_cached = db.get("vm_moid_map")
    phys_cached     = db.get("physical_servers")

    if not vms_cached:
        raise HTTPException(
            status_code=503,
            detail="Дані ще не синхронізовано. Натисніть «Оновити дані».",
        )
    if not vc_vms_cached:
        raise HTTPException(
            status_code=503,
            detail="vCenter дані відсутні. Перевірте підключення до vCenter.",
        )

    cmdb_vms: list[dict]     = vms_cached[0]
    synced_at: str | None    = vms_cached[1]
    vc_vms: list[dict]       = vc_vms_cached[0]
    vc_hosts: list[dict]     = vc_hosts_cached[0] if vc_hosts_cached else []
    moid_map: dict[str, str] = moid_map_cached[0] if moid_map_cached else {}
    phys_servers: list[dict] = phys_cached[0] if phys_cached else []

    by_norm, by_stripped, by_ip = _build_cmdb_indexes(cmdb_vms)
    moid_set = set(moid_map.values())
    host_cmdb_index = _build_cmdb_host_index(cmdb_vms, phys_servers)

    host_cluster: dict[str, str] = {
        h["moid"]: h["cluster"]
        for h in vc_hosts
        if h.get("moid") and h.get("cluster")
    }

    one_week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    items = []

    # VMs not in CMDB
    for vc_vm in vc_vms:
        if _in_cmdb(vc_vm, by_norm, by_stripped, by_ip, moid_set):
            continue
        created_at = vc_vm.get("created_at")
        if created_at:
            try:
                cd = datetime.fromisoformat(created_at)
                if cd.tzinfo is None:
                    cd = cd.replace(tzinfo=timezone.utc)
                if cd > one_week_ago:
                    continue
            except Exception:
                pass
        runtime_host = vc_vm.get("runtime_host")
        cluster      = host_cluster.get(runtime_host) if runtime_host else None
        vc_name      = vc_vm.get("name") or ""
        items.append({
            "kind":          "vm",
            "moid":          vc_vm.get("moid", ""),
            "vc_name":       vc_name,
            "cmdb_name":     _cmdb_name(vc_name),
            "guest_hostname": vc_vm.get("guest_hostname"),
            "guest_ip":      vc_vm.get("guest_ip"),
            "power_state":   vc_vm.get("power_state"),
            "vcpu":          vc_vm.get("vcpu"),
            "vram_gb":       vc_vm.get("vram_gb"),
            "cluster":       cluster,
            "os_full_name":  vc_vm.get("os_full_name"),
            "created_at":    created_at,
        })

    # Hypervisors (ESXi hosts) not in CMDB (VM or physical server)
    total_hosts = len(vc_hosts)
    new_hosts = 0
    for vc_host in vc_hosts:
        if _host_in_cmdb(vc_host, host_cmdb_index):
            continue
        new_hosts += 1
        host_name = vc_host.get("name") or ""
        items.append({
            "kind":          "hypervisor",
            "moid":          vc_host.get("moid", ""),
            "vc_name":       host_name,
            "cmdb_name":     host_name,
            "guest_hostname": host_name if "." in host_name else None,
            "guest_ip":      vc_host.get("management_ip"),
            "all_ips":       vc_host.get("all_ips") or [],
            "power_state":   vc_host.get("power_state"),
            "vcpu":          vc_host.get("num_cpu_cores"),
            "vram_gb":       vc_host.get("memory_gb"),
            "cluster":       vc_host.get("cluster"),
            "os_full_name":  vc_host.get("os_version"),
            "storage_tb":    vc_host.get("storage_tb"),
            "created_at":    None,
        })

    items.sort(key=lambda x: (
        x["kind"] != "hypervisor",  # hypervisors first
        x["power_state"] != "poweredOn",
        x["vc_name"].lower(),
    ))

    result = {
        "total_vcenter":       len(vc_vms),
        "total_hosts":         total_hosts,
        "not_in_cmdb":         len([i for i in items if i["kind"] == "vm"]),
        "new_hypervisors":     new_hosts,
        "items":               items,
        "synced_at":           synced_at,
    }
    response_cache.put(_CACHE_KEY, result)
    return result


# ── Import ────────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    moids: list[str]


@router.post("/vcenter-new-vms/import")
async def import_vcenter_vms(req: ImportRequest):
    """Create selected vCenter VMs and/or hypervisors in Jira CMDB."""
    if not req.moids:
        return {"imported": 0, "skipped": 0, "errors": []}

    vms_cached      = db.get("vms")
    phys_cached     = db.get("physical_servers")
    vc_vms_cached   = db.get("vcenter_vms")
    vc_hosts_cached = db.get("vcenter_hosts")
    clusters_cached = db.get("clusters")
    moid_map_cached = db.get("vm_moid_map")

    if not vc_vms_cached:
        raise HTTPException(status_code=503, detail="vCenter дані відсутні.")

    cmdb_vms: list[dict]     = vms_cached[0] if vms_cached else []
    phys_servers: list[dict] = phys_cached[0] if phys_cached else []
    vc_vms: list[dict]       = vc_vms_cached[0]
    vc_hosts: list[dict]     = vc_hosts_cached[0] if vc_hosts_cached else []
    clusters: list[dict]     = clusters_cached[0] if clusters_cached else []
    moid_map: dict[str, str] = moid_map_cached[0] if moid_map_cached else {}

    by_norm, by_stripped, by_ip = _build_cmdb_indexes(cmdb_vms)
    moid_set = set(moid_map.values())
    host_cmdb_index = _build_cmdb_host_index(cmdb_vms, phys_servers)

    # Cluster name → Jira ID index
    cluster_index: dict[str, str] = {}
    for clr in clusters:
        key = _norm_cluster(clr.get("name", ""))
        if key:
            cluster_index[key] = str(clr["jira_id"])

    host_cluster: dict[str, str] = {
        h["moid"]: h["cluster"]
        for h in vc_hosts
        if h.get("moid") and h.get("cluster")
    }

    vc_by_moid: dict[str, dict]      = {v["moid"]: v for v in vc_vms if v.get("moid")}
    vc_host_by_moid: dict[str, dict] = {h["moid"]: h for h in vc_hosts if h.get("moid")}

    # Running name sets to prevent double-import in the same batch
    cmdb_name_set: set[str] = {_norm(vm.get("name", "")) for vm in cmdb_vms}
    phys_name_set: set[str] = {_norm(ps.get("name", "")) for ps in phys_servers}

    imported = 0
    skipped  = 0
    errors: list[dict] = []

    for moid in req.moids:
        # ── Hypervisor import ──────────────────────────────────────────────────
        if moid in vc_host_by_moid and moid not in vc_by_moid:
            vc_host  = vc_host_by_moid[moid]
            host_name = vc_host.get("name") or ""

            if _host_in_cmdb(vc_host, host_cmdb_index):
                log.info("Import: skip hypervisor %s — already in CMDB", host_name)
                skipped += 1
                continue

            # Short name: strip domain, add SRV- prefix (CMDB convention)
            bare_name  = host_name.split(".")[0].strip()
            short_name = f"SRV-{bare_name}" if not bare_name.upper().startswith("SRV-") else bare_name
            fqdn       = host_name if "." in host_name else None
            norm_name  = _norm(short_name)

            if norm_name in phys_name_set or norm_name in cmdb_name_set:
                log.warning("Import: skip hypervisor %s — name collision '%s'", host_name, short_name)
                skipped += 1
                continue

            try:
                os_str = vc_host.get("os_version") or ""
                os_lower = os_str.lower()
                if "esxi 8" in os_lower:
                    os_jira_id = "3231"   # OS-VMware ESXi 8.0 or later
                elif "esxi" in os_lower:
                    os_jira_id = "3230"   # OS-VMware ESXi 6.5 or later
                else:
                    os_jira_id = None
                await jira_client.create_physical_server(
                    name=short_name,
                    fqdn=fqdn,
                    cpu_count=vc_host.get("cpu_packages"),
                    cpu_cores=vc_host.get("cores_per_socket"),
                    ram_gb=vc_host.get("memory_gb"),
                    manufacturer=vc_host.get("vendor") or None,
                    model=vc_host.get("model") or None,
                    serial_number=vc_host.get("serial_number") or None,
                    primary_ip=vc_host.get("management_ip") or None,
                    cpu_model=vc_host.get("cpu_model") or None,
                    os_jira_id=os_jira_id,
                    bios_version=vc_host.get("bios_version") or None,
                    nic_count=vc_host.get("nic_count"),
                )
                log.info("Import: created physical server '%s' in CMDB", short_name)
                imported += 1
                phys_name_set.add(norm_name)
                host_cmdb_index[norm_name] = vc_host  # prevent re-import in same batch
            except Exception as exc:
                log.exception("Import: failed to create hypervisor '%s'", short_name)
                errors.append({"name": short_name, "error": str(exc)[:200]})
            continue

        # ── VM import ─────────────────────────────────────────────────────────
        vc_vm = vc_by_moid.get(moid)
        if not vc_vm:
            log.warning("Import: MOID %s not found in vCenter cache", moid)
            skipped += 1
            continue

        # Re-check: might have been matched after last GET
        if _in_cmdb(vc_vm, by_norm, by_stripped, by_ip, moid_set):
            log.info("Import: skip %s — already in CMDB", vc_vm.get("name"))
            skipped += 1
            continue

        vc_name   = vc_vm.get("name") or ""
        new_name  = _cmdb_name(vc_name)
        norm_name = _norm(new_name)

        if norm_name in cmdb_name_set:
            log.warning("Import: skip %s — name collision '%s'", vc_name, new_name)
            skipped += 1
            continue

        runtime_host = vc_vm.get("runtime_host")
        cluster_name = host_cluster.get(runtime_host) if runtime_host else None
        cluster_jira = cluster_index.get(_norm_cluster(cluster_name)) if cluster_name else None

        fqdn = vc_vm.get("guest_hostname") or (vc_name if "." in vc_name else None)

        try:
            await jira_client.create_vm(
                name=new_name,
                vcpu=vc_vm.get("vcpu"),
                vram_gb=vc_vm.get("vram_gb"),
                cluster_jira_id=cluster_jira,
                fqdn=fqdn,
            )
            log.info("Import: created VM '%s' in CMDB", new_name)
            imported += 1
            cmdb_name_set.add(norm_name)
        except Exception as exc:
            log.exception("Import: failed to create VM '%s'", new_name)
            errors.append({"name": new_name, "error": str(exc)[:200]})

    # Invalidate GET cache so next request returns fresh data
    response_cache.invalidate_prefix(_CACHE_KEY)

    return {"imported": imported, "skipped": skipped, "errors": errors}
