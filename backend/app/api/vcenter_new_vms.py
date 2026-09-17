"""vCenter VMs not yet in Jira CMDB.

GET  /api/vcenter-new-vms        — list vCenter VMs with no matching CMDB entry
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
    """Return vCenter VMs that have no matching entry in the Jira CMDB."""
    cached = response_cache.get(_CACHE_KEY, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached      = db.get("vms")
    vc_vms_cached   = db.get("vcenter_vms")
    vc_hosts_cached = db.get("vcenter_hosts")
    moid_map_cached = db.get("vm_moid_map")

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

    by_norm, by_stripped, by_ip = _build_cmdb_indexes(cmdb_vms)
    moid_set = set(moid_map.values())

    host_cluster: dict[str, str] = {
        h["moid"]: h["cluster"]
        for h in vc_hosts
        if h.get("moid") and h.get("cluster")
    }

    one_week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    items = []
    for vc_vm in vc_vms:
        if _in_cmdb(vc_vm, by_norm, by_stripped, by_ip, moid_set):
            continue
        # Only show VMs created more than 1 week ago
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

    items.sort(key=lambda x: (x["power_state"] != "poweredOn", x["vc_name"].lower()))

    result = {
        "total_vcenter": len(vc_vms),
        "not_in_cmdb":   len(items),
        "items":         items,
        "synced_at":     synced_at,
    }
    response_cache.put(_CACHE_KEY, result)
    return result


# ── Import ────────────────────────────────────────────────────────────────────

class ImportRequest(BaseModel):
    moids: list[str]


@router.post("/vcenter-new-vms/import")
async def import_vcenter_vms(req: ImportRequest):
    """Create selected vCenter VMs in Jira CMDB."""
    if not req.moids:
        return {"imported": 0, "skipped": 0, "errors": []}

    vms_cached      = db.get("vms")
    vc_vms_cached   = db.get("vcenter_vms")
    vc_hosts_cached = db.get("vcenter_hosts")
    clusters_cached = db.get("clusters")
    moid_map_cached = db.get("vm_moid_map")

    if not vc_vms_cached:
        raise HTTPException(status_code=503, detail="vCenter дані відсутні.")

    cmdb_vms: list[dict]     = vms_cached[0] if vms_cached else []
    vc_vms: list[dict]       = vc_vms_cached[0]
    vc_hosts: list[dict]     = vc_hosts_cached[0] if vc_hosts_cached else []
    clusters: list[dict]     = clusters_cached[0] if clusters_cached else []
    moid_map: dict[str, str] = moid_map_cached[0] if moid_map_cached else {}

    by_norm, by_stripped, by_ip = _build_cmdb_indexes(cmdb_vms)
    moid_set = set(moid_map.values())

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

    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vc_vms if v.get("moid")}

    # Running set of CMDB names to prevent double-import in the same batch
    cmdb_name_set: set[str] = {_norm(vm.get("name", "")) for vm in cmdb_vms}

    imported = 0
    skipped  = 0
    errors: list[dict] = []

    for moid in req.moids:
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
            log.info("Import: created '%s' in CMDB", new_name)
            imported += 1
            cmdb_name_set.add(norm_name)
        except Exception as exc:
            log.exception("Import: failed to create '%s'", new_name)
            errors.append({"name": new_name, "error": str(exc)[:200]})

    # Invalidate GET cache so next request returns fresh data
    response_cache.invalidate_prefix(_CACHE_KEY)

    return {"imported": imported, "skipped": skipped, "errors": errors}
