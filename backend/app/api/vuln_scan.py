"""
CVE Vulnerability Scanner API.

Endpoints:
  GET  /api/vuln/status          — NVD DB stats
  GET  /api/vuln/servers         — list VMs from vCenter with OS info
  POST /api/vuln/scan            — start async scan job
  GET  /api/vuln/scan/{job_id}   — poll scan progress + results
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import db, nvd_store

router = APIRouter(tags=["vuln-scan"])
log = logging.getLogger(__name__)

# In-memory job store (survives only while the process is running)
_jobs: dict[str, dict] = {}

# NVD download job (only one at a time)
_nvd_job: dict | None = None


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CveItem(BaseModel):
    id: str
    description: str
    cvss_score: Optional[float]
    cvss_severity: Optional[str]
    cvss_vector: Optional[str]
    attack_vector: Optional[str]
    published: Optional[str]
    modified: Optional[str]


class ScanServerResult(BaseModel):
    server_name: str
    os_string: Optional[str]
    matched_tokens: list[str]
    cve_count: int
    cves: list[CveItem]


class ScanJobStatus(BaseModel):
    job_id: str
    status: Literal["running", "done", "error"]
    progress: int
    total: int
    results: list[ScanServerResult]
    error: Optional[str]
    created_at: str
    finished_at: Optional[str]


class StartScanRequest(BaseModel):
    server_names: list[str]
    min_score: float = 0.0


class StartScanResponse(BaseModel):
    job_id: str
    total: int


class VulnServerItem(BaseModel):
    name: str
    os_string: Optional[str]
    cluster: Optional[str]
    fqdn: Optional[str]
    primary_ip: Optional[str]


class VulnServersResponse(BaseModel):
    total: int
    items: list[VulnServerItem]
    synced_at: Optional[str]


class StartNvdUpdateRequest(BaseModel):
    mode: Literal["update", "full"] = "update"
    days: int = 30


class NvdUpdateStatus(BaseModel):
    status: Literal["idle", "running", "done", "error"]
    mode: Optional[str]
    page: int
    total_pages: Optional[int]
    cves_done: int
    total_results: Optional[int]
    message: Optional[str]
    error: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    result: Optional[dict]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_vc_vms() -> tuple[list[dict], dict[str, str], str | None]:
    """Return (vc_vms, moid_map, synced_at_iso)."""
    vc_cached   = db.get("vcenter_vms")
    moid_cached = db.get("vm_moid_map")
    vms_cached  = db.get("vms")

    vc_vms: list[dict] = vc_cached[0] if vc_cached else []
    moid_map: dict[str, str] = moid_cached[0] if moid_cached else {}
    synced_at = None
    if vms_cached:
        _, ts = vms_cached
        synced_at = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)

    return vc_vms, moid_map, synced_at


def _build_server_list(server_names: list[str] | None = None) -> list[dict]:
    """
    Build list of {name, os_string} from CMDB VMs + vCenter OS data.
    If server_names is given, filter to those names only.
    """
    vms_cached  = db.get("vms")
    vc_vms, moid_map, _ = _get_vc_vms()

    if vms_cached is None:
        return []

    vms, _ = vms_cached
    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vc_vms}

    servers = []
    for vm in vms:
        name = vm.get("name", "")
        if server_names and name not in server_names:
            continue

        moid  = moid_map.get(name)
        vc_vm = vc_by_moid.get(moid) if moid else None

        if vc_vm and vc_vm.get("os_full_name"):
            os_string = vc_vm["os_full_name"]
        else:
            os_string = vm.get("os_family")

        servers.append({
            "name": name,
            "os_string": os_string,
            "cluster": vm.get("cluster"),
            "fqdn": vm.get("fqdn"),
            "primary_ip": vm.get("primary_ip"),
        })

    return servers


async def _run_scan(job_id: str, servers: list[dict], min_score: float):
    """Background task: scan all servers, update job store."""
    job = _jobs[job_id]
    try:
        results = []
        for i, srv in enumerate(servers):
            # run blocking SQLite query in thread pool
            cves = await asyncio.to_thread(
                nvd_store.search_cves_for_os,
                srv.get("os_string") or "",
                min_score,
            )
            tokens = nvd_store._os_to_cpe_tokens(srv.get("os_string") or "")
            results.append(ScanServerResult(
                server_name=srv["name"],
                os_string=srv.get("os_string"),
                matched_tokens=tokens,
                cve_count=len(cves),
                cves=[CveItem(**c) for c in cves],
            ))
            job["progress"] = i + 1
            job["results"] = results
            # yield control so progress updates are visible
            await asyncio.sleep(0)

        job["status"] = "done"
        job["finished_at"] = datetime.now(timezone.utc).isoformat()
    except Exception as e:
        log.exception("Scan job %s failed", job_id)
        job["status"] = "error"
        job["error"] = str(e)
        job["finished_at"] = datetime.now(timezone.utc).isoformat()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/vuln/status")
async def vuln_status():
    """NVD database statistics."""
    return await asyncio.to_thread(nvd_store.get_db_stats)


@router.get("/vuln/servers", response_model=VulnServersResponse)
async def vuln_servers():
    """List all VMs with their OS info (source: vCenter VMware Tools)."""
    vc_vms, moid_map, synced_at = _get_vc_vms()
    vms_cached = db.get("vms")
    if vms_cached is None:
        return VulnServersResponse(total=0, items=[], synced_at=None)

    vms, _ = vms_cached
    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vc_vms}

    items = []
    for vm in vms:
        name  = vm.get("name", "")
        moid  = moid_map.get(name)
        vc_vm = vc_by_moid.get(moid) if moid else None

        if vc_vm and vc_vm.get("os_full_name"):
            os_string = vc_vm["os_full_name"]
        else:
            os_string = vm.get("os_family")

        items.append(VulnServerItem(
            name=name,
            os_string=os_string,
            cluster=vm.get("cluster"),
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
        ))

    items.sort(key=lambda x: x.name.lower())
    return VulnServersResponse(total=len(items), items=items, synced_at=synced_at)


@router.post("/vuln/scan", response_model=StartScanResponse)
async def start_scan(body: StartScanRequest):
    """Start a CVE scan job for the specified servers."""
    stats = await asyncio.to_thread(nvd_store.get_db_stats)
    if not stats.get("is_ready"):
        raise HTTPException(
            status_code=503,
            detail="NVD database not ready. Run: python download_nvd.py",
        )

    servers = _build_server_list(body.server_names if body.server_names else None)
    if not servers:
        raise HTTPException(status_code=404, detail="No servers found")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "progress": 0,
        "total": len(servers),
        "results": [],
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
    }

    asyncio.create_task(_run_scan(job_id, servers, body.min_score))
    return StartScanResponse(job_id=job_id, total=len(servers))


@router.get("/vuln/scan/{job_id}", response_model=ScanJobStatus)
async def get_scan_job(job_id: str):
    """Poll scan progress and results."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return ScanJobStatus(**job)


# ── NVD download endpoints ────────────────────────────────────────────────────

async def _run_nvd_download(mode: str, days: int):
    global _nvd_job

    def on_progress(p: dict):
        if _nvd_job:
            _nvd_job.update(p)

    try:
        result = await nvd_store.run_nvd_download(mode=mode, days=days, on_progress=on_progress)
        if _nvd_job:
            _nvd_job["status"]      = "done"
            _nvd_job["finished_at"] = datetime.now(timezone.utc).isoformat()
            _nvd_job["result"]      = result
            _nvd_job["message"]     = (
                f"Готово: {result['total_inserted']} CVE за {result['pages']} сторінок"
            )
    except Exception as e:
        log.exception("NVD download failed")
        if _nvd_job:
            _nvd_job["status"]      = "error"
            _nvd_job["error"]       = str(e)
            _nvd_job["finished_at"] = datetime.now(timezone.utc).isoformat()


@router.post("/vuln/nvd-update", response_model=NvdUpdateStatus)
async def start_nvd_update(body: StartNvdUpdateRequest):
    """Start NVD database download/update job (one at a time)."""
    global _nvd_job
    if _nvd_job and _nvd_job.get("status") == "running":
        raise HTTPException(status_code=409, detail="NVD update already in progress")

    _nvd_job = {
        "status":        "running",
        "mode":          body.mode,
        "page":          0,
        "total_pages":   None,
        "cves_done":     0,
        "total_results": None,
        "message":       "Запуск…",
        "error":         None,
        "started_at":    datetime.now(timezone.utc).isoformat(),
        "finished_at":   None,
        "result":        None,
    }
    asyncio.create_task(_run_nvd_download(body.mode, body.days))
    return NvdUpdateStatus(**_nvd_job)


@router.get("/vuln/nvd-update", response_model=NvdUpdateStatus)
async def get_nvd_update_status():
    """Poll NVD download job status."""
    if _nvd_job is None:
        return NvdUpdateStatus(
            status="idle", mode=None, page=0, total_pages=None,
            cves_done=0, total_results=None, message=None,
            error=None, started_at=None, finished_at=None, result=None,
        )
    return NvdUpdateStatus(**_nvd_job)
