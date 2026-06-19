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
    PhysicalServerItem,
    PhysicalServerResponse,
    ResourceItem,
    ResourceResponse,
)

# ── Comparison ────────────────────────────────────────────────────────────────

def _normalize(name: str | None) -> str:
    """Lowercase + strip domain suffix for matching."""
    if not name:
        return ""
    return name.lower().split(".")[0].strip()


def build_zabbix_index(zabbix_hosts: list[dict]) -> dict[str, dict]:
    """Index Zabbix hosts by normalized name/DNS and by IP for VM matching."""
    by_key: dict[str, dict] = {}
    by_ip: dict[str, dict] = {}

    for h in zabbix_hosts:
        for key in (_normalize(h.get("host")), _normalize(h.get("name"))):
            if key:
                by_key.setdefault(key, h)
        # Also index Visible Name as full lowercase string — it may contain a
        # DNS name or FQDN that matches the CMDB fqdn/cname field exactly.
        vis = (h.get("name") or "").lower().strip()
        if vis:
            by_key.setdefault(vis, h)
        for iface in h.get("interfaces", []):
            dns = _normalize(iface.get("dns"))
            if dns:
                by_key.setdefault(dns, h)
            ip = (iface.get("ip") or "").strip()
            if ip:
                by_ip.setdefault(ip, h)

    return {"by_key": by_key, "by_ip": by_ip}


def match_zabbix_host(vm: dict, zabbix_index: dict[str, dict]) -> dict | None:
    """Find the Zabbix host matching a CMDB VM by name, FQDN, CNAME or IP.

    Matching order:
    1. Normalized hostname (first segment, case-insensitive) — covers host/Visible Name/DNS.
    2. Full-string match of CMDB fqdn/cname against Zabbix Visible Name
       (catches cases where Visible Name is a full FQDN and CMDB stores the same).
    3. Primary IP.
    """
    by_key = zabbix_index["by_key"]
    by_ip = zabbix_index["by_ip"]

    # Pass 1: normalized hostname segment
    for key in (
        _normalize(vm.get("name")),
        _normalize(vm.get("fqdn")),
        _normalize(vm.get("cname")),
    ):
        if key and key in by_key:
            return by_key[key]

    # Pass 2: full-string match against Zabbix Visible Name (DNS/FQDN stored verbatim)
    for raw in (vm.get("fqdn"), vm.get("cname"), vm.get("name")):
        full = (raw or "").lower().strip()
        if full and full in by_key:
            return by_key[full]

    ip = (vm.get("primary_ip") or "").strip()
    if ip and ip in by_ip:
        return by_ip[ip]

    return None


def build_vcenter_index(vcenter_vms: list[dict]) -> dict[str, dict]:
    """Index vCenter VMs by normalized name/guest hostname and by guest IP."""
    by_key: dict[str, dict] = {}
    by_ip: dict[str, dict] = {}

    for v in vcenter_vms:
        for key in (_normalize(v.get("name")), _normalize(v.get("guest_hostname"))):
            if key:
                by_key.setdefault(key, v)
        ip = (v.get("guest_ip") or "").strip()
        if ip:
            by_ip.setdefault(ip, v)

    return {"by_key": by_key, "by_ip": by_ip}


def find_ambiguous_identifiers(vms: list[dict]) -> tuple[set[str], set[str]]:
    """Normalized name/fqdn/cname keys and raw IPs shared by more than one
    CMDB VM (e.g. templates/proxies cloned with the same placeholder IP or
    hostname like "localhost") can't reliably point to a single external
    VM, so they should be excluded from IP/key-based matching.
    """
    key_counts: dict[str, int] = {}
    ip_counts: dict[str, int] = {}
    for vm in vms:
        for key in (_normalize(vm.get("name")), _normalize(vm.get("fqdn")), _normalize(vm.get("cname"))):
            if key:
                key_counts[key] = key_counts.get(key, 0) + 1
        ip = (vm.get("primary_ip") or "").strip()
        if ip:
            ip_counts[ip] = ip_counts.get(ip, 0) + 1

    ambiguous_keys = {k for k, c in key_counts.items() if c > 1}
    ambiguous_ips = {ip for ip, c in ip_counts.items() if c > 1}
    return ambiguous_keys, ambiguous_ips


def match_vcenter_vm(
    vm: dict,
    vcenter_index: dict[str, dict],
    ambiguous_keys: set[str] = frozenset(),
    ambiguous_ips: set[str] = frozenset(),
) -> dict | None:
    """Find the vCenter VM matching a CMDB VM by name, FQDN, CNAME or IP.

    Identifiers in ambiguous_keys/ambiguous_ips are shared by multiple CMDB
    VMs and are skipped, since they can't disambiguate a single vCenter VM.
    """
    by_key = vcenter_index["by_key"]
    by_ip = vcenter_index["by_ip"]

    for key in (
        _normalize(vm.get("name")),
        _normalize(vm.get("fqdn")),
        _normalize(vm.get("cname")),
    ):
        if key and key not in ambiguous_keys and key in by_key:
            return by_key[key]

    ip = (vm.get("primary_ip") or "").strip()
    if ip and ip not in ambiguous_ips and ip in by_ip:
        return by_ip[ip]

    return None


def build_comparison(vms: list[dict], zabbix_hosts: list[dict]) -> ComparisonResponse:
    zabbix_index = build_zabbix_index(zabbix_hosts)
    matched_hostids: set[str] = set()

    items: list[ComparisonItem] = []

    for vm in vms:
        zhost = match_zabbix_host(vm, zabbix_index)

        if zhost:
            matched_hostids.add(zhost["hostid"])
            status = "both"
            zbx_status = "enabled" if zhost.get("status") == "0" else "disabled"
            zbx_name = zhost.get("name") or None
        else:
            status = "cmdb_only"
            zbx_status = None
            zbx_name = None

        items.append(ComparisonItem(
            name=vm.get("name", ""),
            fqdn=vm.get("fqdn"),
            zabbix_name=zbx_name,
            cmdb_status=vm.get("status"),
            zabbix_status=zbx_status,
            comparison_status=status,
            os_family=vm.get("os_family"),
            cluster=vm.get("cluster"),
            primary_ip=vm.get("primary_ip"),
        ))

    # Hosts in Zabbix but not CMDB (dedupe by hostid — multiple keys can map
    # to the same host in zabbix_index)
    seen_hostids: set[str] = set()
    for h in zabbix_hosts:
        hostid = h["hostid"]
        if hostid in seen_hostids or hostid in matched_hostids:
            continue
        seen_hostids.add(hostid)
        interfaces = h.get("interfaces") or []
        items.append(ComparisonItem(
            name=h.get("host", ""),
            fqdn=None,
            zabbix_name=h.get("name") or None,
            cmdb_status=None,
            zabbix_status="enabled" if h.get("status") == "0" else "disabled",
            comparison_status="zabbix_only",
            os_family=None,
            cluster=None,
            primary_ip=(interfaces[0].get("ip") or None) if interfaces else None,
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

def _eval_metric(
    avg: float | None,
    peak: float | None,
    oversized_th: float,
    undersized_th: float,
) -> str | None:
    """Classify a CPU/RAM metric as "undersized" / "oversized" / None (optimal).

    A peak above the undersized threshold counts as "undersized" even if the
    average is normal — capacity must cover peak load, not just the average.
    """
    if avg is None:
        return None
    peak_high = peak is not None and peak > undersized_th
    if avg > undersized_th or peak_high:
        return "undersized"
    if avg < oversized_th:
        return "oversized"
    return None


def _resource_status_and_recommendations(
    cpu_pct: float | None,
    cpu_max: float | None,
    ram_pct: float | None,
    ram_max: float | None,
    vcpu: int | None,
    vram_gb: int | None,
    disk_used_pct: float | None = None,
    disk_used_max: float | None = None,
    vc_cpu_pct: float | None = None,
    vc_cpu_max: float | None = None,
    vc_ram_pct: float | None = None,
    vc_ram_max: float | None = None,
    zbx_disk_used_pct: float | None = None,
    zbx_disk_used_max: float | None = None,
) -> tuple[str, list[str]]:
    has_any = any(x is not None for x in [
        cpu_pct, ram_pct, vc_cpu_pct, vc_ram_pct, disk_used_pct, zbx_disk_used_pct,
    ])
    if not has_any:
        return "no_data", []

    recs: list[str] = []
    statuses: list[str] = []

    # ── CPU: use Zabbix, vCenter, or both when both available ─────────────────
    both_cpu = cpu_pct is not None and vc_cpu_pct is not None
    cpu_sources: list[tuple[str | None, float, float | None]] = []
    if cpu_pct is not None:
        cpu_sources.append(("Zabbix" if both_cpu else None, cpu_pct, cpu_max))
    if vc_cpu_pct is not None:
        cpu_sources.append(("vCenter" if both_cpu else None, vc_cpu_pct, vc_cpu_max))

    for source, avg, peak in cpu_sources:
        prefix = f"[{source}] " if source else ""
        cpu_status = _eval_metric(avg, peak, settings.cpu_oversized_threshold, settings.cpu_undersized_threshold)
        if cpu_status == "undersized":
            statuses.append("undersized")
            if avg > settings.cpu_undersized_threshold:
                suggested = math.ceil((vcpu or 2) * 1.5)
                recs.append(
                    f"{prefix}Збільшити vCPU: середнє використання {avg:.1f}% — "
                    f"рекомендовано {suggested} vCPU"
                    + (f" (зараз {vcpu})" if vcpu else "")
                )
            else:
                recs.append(
                    f"{prefix}CPU: середнє {avg:.1f}% в нормі, але пік сягав {peak:.1f}% "
                    f"(>{settings.cpu_undersized_threshold:.0f}%) — слідкуйте за навантаженням"
                )
        elif cpu_status == "oversized":
            statuses.append("oversized")
            suggested = max(1, math.ceil((vcpu or 2) * avg / 60))
            recs.append(
                f"{prefix}Зменшити vCPU: середнє використання {avg:.1f}%"
                + (f", пік {peak:.1f}%" if peak is not None else "")
                + f" — рекомендовано {suggested} vCPU"
                + (f" (зараз {vcpu})" if vcpu else "")
            )

    # ── RAM: use Zabbix, vCenter, or both when both available ─────────────────
    both_ram = ram_pct is not None and vc_ram_pct is not None
    ram_sources: list[tuple[str | None, float, float | None]] = []
    if ram_pct is not None:
        ram_sources.append(("Zabbix" if both_ram else None, ram_pct, ram_max))
    if vc_ram_pct is not None:
        ram_sources.append(("vCenter" if both_ram else None, vc_ram_pct, vc_ram_max))

    for source, avg, peak in ram_sources:
        prefix = f"[{source}] " if source else ""
        ram_status = _eval_metric(avg, peak, settings.ram_oversized_threshold, settings.ram_undersized_threshold)
        if ram_status == "undersized":
            statuses.append("undersized")
            if avg > settings.ram_undersized_threshold:
                suggested = math.ceil((vram_gb or 4) * 1.5)
                recs.append(
                    f"{prefix}Збільшити vRAM: середнє використання {avg:.1f}% — "
                    f"рекомендовано {suggested} GB"
                    + (f" (зараз {vram_gb} GB)" if vram_gb else "")
                )
            else:
                recs.append(
                    f"{prefix}RAM: середнє {avg:.1f}% в нормі, але пік сягав {peak:.1f}% "
                    f"(>{settings.ram_undersized_threshold:.0f}%) — слідкуйте за навантаженням"
                )
        elif ram_status == "oversized":
            statuses.append("oversized")
            suggested = max(1, math.ceil((vram_gb or 4) * avg / 60))
            recs.append(
                f"{prefix}Зменшити vRAM: середнє використання {avg:.1f}%"
                + (f", пік {peak:.1f}%" if peak is not None else "")
                + f" — рекомендовано {suggested} GB"
                + (f" (зараз {vram_gb} GB)" if vram_gb else "")
            )

    # ── Disk: vCenter + Zabbix ───────────────────────────────────────────────
    both_disk = disk_used_pct is not None and zbx_disk_used_pct is not None
    disk_sources: list[tuple[str | None, float, float | None]] = []
    if disk_used_pct is not None:
        disk_sources.append(("vCenter" if both_disk else None, disk_used_pct, disk_used_max))
    if zbx_disk_used_pct is not None:
        disk_sources.append(("Zabbix" if both_disk else None, zbx_disk_used_pct, zbx_disk_used_max))

    for source, avg, peak in disk_sources:
        prefix = f"[{source}] " if source else ""
        disk_status = _eval_metric(
            avg, peak, settings.disk_oversized_threshold, settings.disk_undersized_threshold
        )
        if disk_status == "undersized":
            statuses.append("undersized")
            recs.append(
                f"{prefix}Диск: використано {avg:.1f}%"
                + (f", пік {peak:.1f}%" if peak is not None else "")
                + " — розгляньте розширення диску"
            )
        elif disk_status == "oversized":
            statuses.append("oversized")
            recs.append(f"{prefix}Диск: використано лише {avg:.1f}% — можна зменшити виділений простір")

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
    vc_metrics: dict[str, dict[str, float | None]] | None = None,
) -> ResourceResponse:
    items: list[ResourceItem] = []
    vc_metrics = vc_metrics or {}

    for vm in vms:
        name = vm.get("name", "")
        if not name.upper().startswith("VM-"):
            continue

        m = metrics.get(name, {})
        vc = vc_metrics.get(name, {})

        cpu_pct = m.get("cpu_pct")
        cpu_max = m.get("cpu_pct_max")
        ram_pct = m.get("ram_pct")
        ram_max = m.get("ram_pct_max")
        disk_free = m.get("disk_free_pct")
        disk_free_min = m.get("disk_free_pct_min")

        vc_cpu_pct = vc.get("vc_cpu_pct")
        vc_cpu_max = vc.get("vc_cpu_pct_max")
        vc_ram_pct = vc.get("vc_ram_pct")
        vc_ram_max = vc.get("vc_ram_pct_max")
        disk_used_pct = vc.get("disk_used_pct")
        disk_used_max = vc.get("disk_used_pct_max")
        disk_io = vc.get("disk_io_kbps")
        disk_io_max = vc.get("disk_io_kbps_max")

        # Zabbix disk: convert free % → used %
        # disk_free_pct_min = lowest free % seen → highest used % (peak)
        zbx_disk_used_pct = (100.0 - disk_free) if disk_free is not None else None
        zbx_disk_used_max = (100.0 - disk_free_min) if disk_free_min is not None else None

        # Effective disk used % for the display bar:
        # prefer vCenter (storage-level), fall back to Zabbix (guest FS)
        eff_disk_used_pct = disk_used_pct if disk_used_pct is not None else zbx_disk_used_pct
        eff_disk_used_max = disk_used_max if disk_used_max is not None else zbx_disk_used_max

        status, recs = _resource_status_and_recommendations(
            cpu_pct, cpu_max, ram_pct, ram_max, vm.get("vcpu"), vm.get("vram_gb"),
            disk_used_pct, disk_used_max,
            vc_cpu_pct, vc_cpu_max, vc_ram_pct, vc_ram_max,
            zbx_disk_used_pct, zbx_disk_used_max,
        )

        items.append(ResourceItem(
            name=name,
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            cluster=vm.get("cluster"),
            os_family=vm.get("os_family"),
            vcpu=vm.get("vcpu"),
            vram_gb=vm.get("vram_gb"),
            avg_cpu_pct=round(cpu_pct, 1) if cpu_pct is not None else None,
            max_cpu_pct=round(cpu_max, 1) if cpu_max is not None else None,
            avg_ram_pct=round(ram_pct, 1) if ram_pct is not None else None,
            max_ram_pct=round(ram_max, 1) if ram_max is not None else None,
            avg_disk_free_pct=round(disk_free, 1) if disk_free is not None else None,
            min_disk_free_pct=round(disk_free_min, 1) if disk_free_min is not None else None,
            vc_avg_cpu_pct=round(vc_cpu_pct, 1) if vc_cpu_pct is not None else None,
            vc_max_cpu_pct=round(vc_cpu_max, 1) if vc_cpu_max is not None else None,
            vc_avg_ram_pct=round(vc_ram_pct, 1) if vc_ram_pct is not None else None,
            vc_max_ram_pct=round(vc_ram_max, 1) if vc_ram_max is not None else None,
            avg_disk_used_pct=round(eff_disk_used_pct, 1) if eff_disk_used_pct is not None else None,
            max_disk_used_pct=round(eff_disk_used_max, 1) if eff_disk_used_max is not None else None,
            avg_disk_io_kbps=round(disk_io, 1) if disk_io is not None else None,
            max_disk_io_kbps=round(disk_io_max, 1) if disk_io_max is not None else None,
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


# ── Physical Server Analysis ─────────────────────────────────────────────────

def build_physical_servers(
    servers: list[dict],
    metrics: dict[str, dict[str, float | None]],
) -> PhysicalServerResponse:
    """Build PhysicalServerResponse from CMDB physical servers + optional Zabbix metrics."""
    items: list[PhysicalServerItem] = []

    for srv in servers:
        name = srv.get("name", "")
        m = metrics.get(name, {})

        cpu_pct = m.get("cpu_pct")
        cpu_max = m.get("cpu_pct_max")
        ram_pct = m.get("ram_pct")
        ram_max = m.get("ram_pct_max")
        disk_free_pct = m.get("disk_free_pct")
        disk_free_min = m.get("disk_free_pct_min")
        # is_monitored: server exists in Zabbix (has hostid), regardless of
        # whether standard agent CPU/RAM items are present (ESXi hosts use
        # VMware HV template — disk data may exist but cpu/ram may not).
        is_monitored = name in metrics

        if cpu_pct is not None or ram_pct is not None:
            status, _ = _resource_status_and_recommendations(
                cpu_pct, cpu_max, ram_pct, ram_max, None, None
            )
        else:
            status = "no_data"

        items.append(PhysicalServerItem(
            name=name,
            fqdn=srv.get("fqdn"),
            primary_ip=srv.get("primary_ip"),
            location=srv.get("location"),
            manufacturer=srv.get("manufacturer"),
            model=srv.get("model"),
            cpu_count=srv.get("cpu_count"),
            cpu_cores=srv.get("cpu_cores"),
            ram_gb=srv.get("ram_gb"),
            storage_config=srv.get("storage_config"),
            avg_cpu_pct=round(cpu_pct, 1) if cpu_pct is not None else None,
            max_cpu_pct=round(cpu_max, 1) if cpu_max is not None else None,
            avg_ram_pct=round(ram_pct, 1) if ram_pct is not None else None,
            max_ram_pct=round(ram_max, 1) if ram_max is not None else None,
            avg_disk_free_pct=round(disk_free_pct, 1) if disk_free_pct is not None else None,
            min_disk_free_pct=round(disk_free_min, 1) if disk_free_min is not None else None,
            resource_status=status,
            is_monitored=is_monitored,
        ))

    monitored = sum(1 for i in items if i.is_monitored)
    return PhysicalServerResponse(total=len(items), monitored=monitored, items=items)


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

        # Clusters this small are not worth licensing/optimization analysis
        # and are excluded from the report entirely.
        if host_count <= 3:
            continue

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

        price = settings.dc_license_price_usd

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
            current_dc_cost_usd=current_licenses * price,
            optimized_dc_cost_usd=optimized_licenses * price,
            savings_usd=(current_licenses - optimized_licenses) * price,
            recommendation=recommendation,
        ))

    mixed = sum(1 for i in items if i.recommendation is not None)
    total_cur = sum(i.current_dc_licenses for i in items)
    total_opt = sum(i.optimized_dc_licenses for i in items)
    total_cur_cost = sum(i.current_dc_cost_usd for i in items)
    total_opt_cost = sum(i.optimized_dc_cost_usd for i in items)

    return ClusterResponse(
        total_clusters=len(items),
        mixed_clusters=mixed,
        total_current_licenses=total_cur,
        total_optimized_licenses=total_opt,
        total_savings=total_cur - total_opt,
        total_current_cost_usd=total_cur_cost,
        total_optimized_cost_usd=total_opt_cost,
        total_savings_usd=total_cur_cost - total_opt_cost,
        items=items,
    )
