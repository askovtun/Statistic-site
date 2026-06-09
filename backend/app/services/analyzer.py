"""Business logic: CMDB vs Zabbix comparison, VM resource analysis, cluster licensing."""
from __future__ import annotations

import math
from typing import Any

from app.config import settings
from app.models.schemas import (
    ClusterItem,
    ClusterResponse,
    ComparisonItem,
    ComparisonResponse,
    ResourceItem,
    ResourceResponse,
)

# ── Comparison ────────────────────────────────────────────────────────────────

def _normalize(name: str | None) -> str:
    """Lowercase + strip domain suffix for matching."""
    if not name:
        return ""
    return name.lower().split(".")[0].strip()


def build_comparison(vms: list[dict], zabbix_hosts: list[dict]) -> ComparisonResponse:
    zabbix_by_name: dict[str, dict] = {
        _normalize(h.get("host") or h.get("name")): h
        for h in zabbix_hosts
    }
    zabbix_all_names = set(zabbix_by_name.keys())
    matched: set[str] = set()

    items: list[ComparisonItem] = []

    for vm in vms:
        key = _normalize(vm.get("name")) or _normalize(vm.get("fqdn"))
        fqdn_key = _normalize(vm.get("fqdn"))
        zhost = zabbix_by_name.get(key) or (zabbix_by_name.get(fqdn_key) if fqdn_key else None)

        if zhost:
            matched.add(_normalize(zhost.get("host") or zhost.get("name")))
            status = "both"
            zbx_status = "enabled" if zhost.get("status") == "0" else "disabled"
        else:
            status = "cmdb_only"
            zbx_status = None

        items.append(ComparisonItem(
            name=vm.get("name", ""),
            fqdn=vm.get("fqdn"),
            cmdb_status=vm.get("status"),
            zabbix_status=zbx_status,
            comparison_status=status,
        ))

    # Hosts in Zabbix but not CMDB
    for name, zhost in zabbix_by_name.items():
        if name not in matched:
            items.append(ComparisonItem(
                name=zhost.get("name") or zhost.get("host", ""),
                fqdn=None,
                cmdb_status=None,
                zabbix_status="enabled" if zhost.get("status") == "0" else "disabled",
                comparison_status="zabbix_only",
            ))

    monitored = sum(1 for i in items if i.comparison_status == "both")
    cmdb_only = sum(1 for i in items if i.comparison_status == "cmdb_only")
    zabbix_only = sum(1 for i in items if i.comparison_status == "zabbix_only")

    return ComparisonResponse(
        total=len(items),
        monitored=monitored,
        cmdb_only=cmdb_only,
        zabbix_only=zabbix_only,
        items=items,
    )


# ── Resource Analysis ─────────────────────────────────────────────────────────

def _resource_status_and_recommendations(
    cpu_pct: float | None,
    ram_pct: float | None,
    vcpu: int | None,
    vram_gb: int | None,
) -> tuple[str, list[str]]:
    if cpu_pct is None and ram_pct is None:
        return "no_data", []

    recs: list[str] = []
    statuses: list[str] = []

    if cpu_pct is not None:
        if cpu_pct < settings.cpu_oversized_threshold:
            statuses.append("oversized")
            suggested = max(1, math.ceil((vcpu or 2) * cpu_pct / 60))
            recs.append(
                f"Зменшити vCPU: середнє використання {cpu_pct:.1f}% — "
                f"рекомендовано {suggested} vCPU"
                + (f" (зараз {vcpu})" if vcpu else "")
            )
        elif cpu_pct > settings.cpu_undersized_threshold:
            statuses.append("undersized")
            suggested = math.ceil((vcpu or 2) * 1.5)
            recs.append(
                f"Збільшити vCPU: середнє використання {cpu_pct:.1f}% — "
                f"рекомендовано {suggested} vCPU"
                + (f" (зараз {vcpu})" if vcpu else "")
            )

    if ram_pct is not None:
        if ram_pct < settings.ram_oversized_threshold:
            statuses.append("oversized")
            suggested = max(1, math.ceil((vram_gb or 4) * ram_pct / 60))
            recs.append(
                f"Зменшити vRAM: середнє використання {ram_pct:.1f}% — "
                f"рекомендовано {suggested} GB"
                + (f" (зараз {vram_gb} GB)" if vram_gb else "")
            )
        elif ram_pct > settings.ram_undersized_threshold:
            statuses.append("undersized")
            suggested = math.ceil((vram_gb or 4) * 1.5)
            recs.append(
                f"Збільшити vRAM: середнє використання {ram_pct:.1f}% — "
                f"рекомендовано {suggested} GB"
                + (f" (зараз {vram_gb} GB)" if vram_gb else "")
            )

    if "undersized" in statuses:
        final_status = "undersized"
    elif "oversized" in statuses:
        final_status = "oversized"
    else:
        final_status = "optimal"

    return final_status, recs


def build_resources(
    vms: list[dict],
    metrics: dict[str, dict[str, float | None]],
) -> ResourceResponse:
    items: list[ResourceItem] = []

    for vm in vms:
        name = vm.get("name", "")
        key = _normalize(name) or _normalize(vm.get("fqdn"))
        # Try exact then normalized
        m = metrics.get(name) or metrics.get(key) or {}

        cpu_pct = m.get("cpu_pct")
        ram_pct = m.get("ram_pct")
        disk_free = m.get("disk_free_pct")

        status, recs = _resource_status_and_recommendations(
            cpu_pct, ram_pct, vm.get("vcpu"), vm.get("vram_gb")
        )

        items.append(ResourceItem(
            name=name,
            fqdn=vm.get("fqdn"),
            cluster=vm.get("cluster"),
            os_family=vm.get("os_family"),
            vcpu=vm.get("vcpu"),
            vram_gb=vm.get("vram_gb"),
            avg_cpu_pct=round(cpu_pct, 1) if cpu_pct is not None else None,
            avg_ram_pct=round(ram_pct, 1) if ram_pct is not None else None,
            avg_disk_free_pct=round(disk_free, 1) if disk_free is not None else None,
            resource_status=status,
            recommendations=recs,
        ))

    cnt = lambda s: sum(1 for i in items if i.resource_status == s)
    return ResourceResponse(
        total=len(items),
        optimal=cnt("optimal"),
        oversized=cnt("oversized"),
        undersized=cnt("undersized"),
        no_data=cnt("no_data"),
        items=items,
    )


# ── Cluster Optimization ──────────────────────────────────────────────────────

# Windows Datacenter: sold in 2-core packs, minimum 16 cores per physical server
_CORES_PER_PACK = 2
_MIN_CORES_PER_HOST = 16


def _dc_licenses_for_host(cores_per_host: int) -> int:
    """Number of 2-core packs needed to license one physical host."""
    effective = max(cores_per_host, _MIN_CORES_PER_HOST)
    return math.ceil(effective / _CORES_PER_PACK)


def _is_windows(os_family: str | None) -> bool:
    if not os_family:
        return False
    return "windows" in os_family.lower()


def _is_linux(os_family: str | None) -> bool:
    if not os_family:
        return False
    o = os_family.lower()
    return any(x in o for x in ("linux", "unix", "freebsd", "esxi", "vmware"))


def build_clusters(
    clusters: list[dict],
    vms: list[dict],
) -> ClusterResponse:
    # Group VMs by cluster name
    vms_by_cluster: dict[str, list[dict]] = {}
    for vm in vms:
        cluster_name = vm.get("cluster") or "__no_cluster__"
        vms_by_cluster.setdefault(cluster_name, []).append(vm)

    items: list[ClusterItem] = []
    threshold = settings.cluster_split_threshold

    for cl in clusters:
        name = cl.get("name", "")
        host_count = cl.get("host_count") or 1
        total_cores = cl.get("total_cpu_cores") or (host_count * _MIN_CORES_PER_HOST)
        cores_per_host = max(_MIN_CORES_PER_HOST, total_cores // host_count)

        cluster_vms = vms_by_cluster.get(name, [])
        total_vms = len(cluster_vms)
        windows_vms = sum(1 for v in cluster_vms if _is_windows(v.get("os_family")))
        linux_vms = sum(1 for v in cluster_vms if _is_linux(v.get("os_family")))
        other_vms = total_vms - windows_vms - linux_vms

        win_pct = windows_vms / total_vms * 100 if total_vms else 0
        lin_pct = linux_vms / total_vms * 100 if total_vms else 0

        # Current: license ALL hosts in the cluster (needed if any Windows VM present)
        if windows_vms > 0:
            current_licenses = host_count * _dc_licenses_for_host(cores_per_host)
        else:
            current_licenses = 0

        # Optimized: split → Windows cluster needs only its own hosts
        # Assume proportional host split by Windows VM ratio
        recommendation: str | None = None
        if windows_vms > 0 and linux_vms > 0 and win_pct >= threshold and lin_pct >= threshold:
            win_hosts = max(1, round(host_count * win_pct / 100))
            optimized_licenses = win_hosts * _dc_licenses_for_host(cores_per_host)
            recommendation = (
                f"Розбити на 2 кластери: Windows ({windows_vms} ВМ, ~{win_hosts} хостів) "
                f"та Linux ({linux_vms} ВМ). "
                f"Економія: {current_licenses - optimized_licenses} ліцензій DC."
            )
        else:
            optimized_licenses = current_licenses

        items.append(ClusterItem(
            name=name,
            host_count=host_count,
            total_cpu_cores=total_cores,
            total_vms=total_vms,
            windows_vms=windows_vms,
            linux_vms=linux_vms,
            other_vms=other_vms,
            windows_pct=round(win_pct, 1),
            linux_pct=round(lin_pct, 1),
            current_dc_licenses=current_licenses,
            optimized_dc_licenses=optimized_licenses,
            license_savings=current_licenses - optimized_licenses,
            recommendation=recommendation,
        ))

    mixed = sum(1 for i in items if i.recommendation is not None)
    total_cur = sum(i.current_dc_licenses for i in items)
    total_opt = sum(i.optimized_dc_licenses for i in items)

    return ClusterResponse(
        total_clusters=len(items),
        mixed_clusters=mixed,
        total_current_licenses=total_cur,
        total_optimized_licenses=total_opt,
        total_savings=total_cur - total_opt,
        items=items,
    )
