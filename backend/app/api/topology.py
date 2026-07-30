"""Cluster topology: datacenter → cluster → ESXi host → VMs hierarchy."""
from __future__ import annotations

import re
from collections import defaultdict

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    TopologyClusterItem, TopologyHostItem, TopologyResponse, TopologyVmItem,
)
from app.services import db

router = APIRouter(tags=["topology"])

_WITNESS_RE = re.compile(r"witness", re.IGNORECASE)
_STATUS_ORDER = {"critical": 0, "warning": 1, "ok": 2, "unknown": 3}


def _cluster_status(hosts: list[dict]) -> str:
    max_pct = max(
        (max(h.get("cpu_usage_pct") or 0, h.get("mem_usage_pct") or 0) for h in hosts),
        default=0,
    )
    if max_pct >= 80:
        return "critical"
    if max_pct >= 65:
        return "warning"
    if max_pct > 0:
        return "ok"
    return "unknown"


def _wavg(hosts: list[dict], key: str) -> float | None:
    vals = [h[key] for h in hosts if h.get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


@router.get("/topology", response_model=TopologyResponse)
async def get_topology() -> TopologyResponse:
    hosts_cached   = db.get("vcenter_hosts")
    vc_vms_cached  = db.get("vcenter_vms")

    if not hosts_cached:
        raise HTTPException(status_code=503, detail="Дані ще не синхронізовано. Натисніть «Оновити дані».")

    hosts:      list[dict] = hosts_cached[0]
    synced_at:  str | None = hosts_cached[1]
    vcenter_vms: list[dict] = vc_vms_cached[0] if vc_vms_cached else []

    # Group vCenter VMs by host MOID
    vms_by_host: dict[str, list[dict]] = defaultdict(list)
    for v in vcenter_vms:
        host_moid = v.get("runtime_host")
        if host_moid:
            vms_by_host[host_moid].append(v)

    # Group hosts by cluster (exclude witness nodes)
    hosts_by_cluster: dict[str, list[dict]] = defaultdict(list)
    for h in hosts:
        if _WITNESS_RE.search(h.get("name", "")):
            continue
        cl = h.get("cluster")
        if cl:
            hosts_by_cluster[cl].append(h)
        else:
            # Standalone host — use its short name as pseudo-cluster
            short = h.get("name", "").split(".")[0].upper() or h["moid"]
            hosts_by_cluster[short].append(h)

    clusters: list[TopologyClusterItem] = []
    for cl_name, cl_hosts in sorted(hosts_by_cluster.items()):
        host_items: list[TopologyHostItem] = []
        cl_vms_total = 0
        cl_powered_on = 0

        for h in cl_hosts:
            host_vms = vms_by_host.get(h["moid"], [])
            powered = sum(1 for v in host_vms if v.get("power_state") == "poweredOn")
            cl_vms_total += len(host_vms)
            cl_powered_on += powered

            host_items.append(TopologyHostItem(
                moid=h["moid"],
                name=h.get("name", ""),
                num_cpu_cores=h.get("num_cpu_cores"),
                memory_gb=h.get("memory_gb"),
                cpu_usage_pct=h.get("cpu_usage_pct"),
                mem_usage_pct=h.get("mem_usage_pct"),
                vm_count=len(host_vms),
                powered_on=powered,
                vms=[
                    TopologyVmItem(
                        name=v.get("name", ""),
                        power_state=v.get("power_state", "unknown"),
                        vcpu=v.get("vcpu"),
                        vram_gb=v.get("vram_gb"),
                    )
                    for v in sorted(host_vms, key=lambda x: x.get("name", ""))
                ],
            ))

        clusters.append(TopologyClusterItem(
            name=cl_name,
            host_count=len(cl_hosts),
            vm_count=cl_vms_total,
            powered_on=cl_powered_on,
            status=_cluster_status(cl_hosts),
            host_cpu_pct=_wavg(cl_hosts, "cpu_usage_pct"),
            host_ram_pct=_wavg(cl_hosts, "mem_usage_pct"),
            hosts=host_items,
        ))

    clusters.sort(key=lambda c: (_STATUS_ORDER.get(c.status, 3), -(c.vm_count or 0)))

    return TopologyResponse(
        total_clusters=len(clusters),
        total_hosts=sum(c.host_count for c in clusters),
        total_vms=sum(c.vm_count for c in clusters),
        total_powered_on=sum(c.powered_on for c in clusters),
        clusters=clusters,
        synced_at=synced_at,
    )
