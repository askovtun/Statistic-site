from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import (
    VCenterHealthResponse, VCenterHealthItem,
    VCenterSnapshotsResponse, VCenterSnapshotItem,
    VCenterHostItem, VCenterHostsResponse,
)
from app.services import db, metrics_store, response_cache, vcenter_client
from app.services.sync_service import PERIODS

router = APIRouter(tags=["vcenter"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."
_CACHE_TTL  = 300

_CPU_READY_WARN_PCT = 5.0
_CPU_READY_CRIT_PCT = 10.0
_HOST_READY_WARN_PCT = 3.0
_HOST_READY_CRIT_PCT = 7.0


def _cpu_ready_recommendations(
    cpu_ready_pct: float,
    vcpu: int | None,
    cluster: str | None,
) -> list[str]:
    recs: list[str] = []
    level = "критичний" if cpu_ready_pct >= _CPU_READY_CRIT_PCT else "підвищений"

    recs.append(
        f"CPU Ready {level} ({cpu_ready_pct:.1f}%) — ВМ чекає на вільний фізичний CPU. "
        "Це ознака перевантаженості ESXi-хоста або надмірної кількості vCPU."
    )

    if vcpu and vcpu >= 4:
        reduced = max(1, vcpu // 2)
        recs.append(
            f"Велика кількість vCPU ({vcpu} vCPU) ускладнює планувальнику vSphere знайти "
            f"одночасно вільні фізичні ядра. Якщо пікове CPU % < 50%, зменшіть vCPU до {reduced}."
        )

    recs.append(
        "Мігруйте ВМ на менш завантажений ESXi-хост (vMotion) або переконайтеся що DRS увімкнено."
    )

    if cpu_ready_pct >= _CPU_READY_CRIT_PCT:
        cl = f" кластера {cluster}" if cluster else ""
        recs.append(
            f"Якщо декілька ВМ{cl} мають CPU Ready >10% — кластер перевантажений: "
            "додайте ESXi-хост або мігруйте частину ВМ в інший кластер."
        )

    return recs


@router.get("/vcenter/health", response_model=VCenterHealthResponse)
async def get_vcenter_health(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    """Per-VM vCenter health metrics: CPU Ready, Memory Balloon/Swap, power state."""
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    cache_key = f"vcenter-health-{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    moid_map_cached = db.get("vm_moid_map")
    vcenter_vms_cached = db.get("vcenter_vms")

    if vms_cached is None or moid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, updated_at = vms_cached
    vm_moid_map, _ = moid_map_cached

    vc_by_moid = {v["moid"]: v for v in (vcenter_vms_cached[0] if vcenter_vms_cached else [])}

    snap_cached = db.get("vcenter_snapshots")
    snap_counts: dict[str, int] = {}
    if snap_cached:
        for s in snap_cached[0]:
            snap_counts[s["vm_name"]] = snap_counts.get(s["vm_name"], 0) + 1

    items: list[VCenterHealthItem] = []
    for vm in vms:
        name = vm.get("name", "")
        if not name.upper().startswith("VM-"):
            continue
        moid = vm_moid_map.get(name)
        if not moid:
            continue

        vc = vc_by_moid.get(moid, {})
        m = metrics_store.get_vcenter_period_metrics(moid, period_days)

        cpu_ready = m.get("cpu_ready_pct")
        balloon = m.get("mem_balloon_kb")
        swapped = m.get("mem_swapped_kb")
        disk = m.get("disk_used_pct")
        vcpu = vm.get("vcpu")
        cluster = vm.get("cluster")

        recs: list[str] = []
        if cpu_ready is not None and cpu_ready >= _CPU_READY_WARN_PCT:
            recs = _cpu_ready_recommendations(cpu_ready, vcpu, cluster)

        items.append(VCenterHealthItem(
            name=name,
            moid=moid,
            power_state=vc.get("power_state", "unknown"),
            boot_time=vc.get("boot_time"),
            cluster=cluster,
            vcpu=vcpu,
            vram_gb=vm.get("vram_gb"),
            cpu_ready_pct=round(cpu_ready, 2) if cpu_ready is not None else None,
            mem_balloon_kb=round(balloon, 0) if balloon is not None else None,
            mem_swapped_kb=round(swapped, 0) if swapped is not None else None,
            disk_used_pct=round(disk, 1) if disk is not None else None,
            snapshot_count=snap_counts.get(name, 0),
            recommendations=recs,
        ))

    powered_on = sum(1 for i in items if i.power_state == "poweredOn")
    powered_off = sum(1 for i in items if i.power_state == "poweredOff")
    with_warn = sum(1 for i in items if i.cpu_ready_pct is not None and i.cpu_ready_pct >= _CPU_READY_WARN_PCT)
    with_balloon = sum(1 for i in items if i.mem_balloon_kb is not None and i.mem_balloon_kb > 0)
    with_swap = sum(1 for i in items if i.mem_swapped_kb is not None and i.mem_swapped_kb > 0)
    with_snaps = sum(1 for i in items if i.snapshot_count > 0)

    result = VCenterHealthResponse(
        total_vms=len(items),
        powered_on=powered_on,
        powered_off=powered_off,
        with_cpu_ready_warn=with_warn,
        with_balloon=with_balloon,
        with_swap=with_swap,
        with_snapshots=with_snaps,
        items=items,
        synced_at=updated_at,
    )
    response_cache.put(cache_key, result)
    return result


@router.get("/vcenter/hosts", response_model=VCenterHostsResponse)
async def get_vcenter_hosts(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    """ESXi hypervisor health: CPU Ready aggregated from VMs running on each host."""
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    cache_key = f"vcenter-hosts-{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    hosts_cached = db.get("vcenter_hosts")
    moid_map_cached = db.get("vm_moid_map")
    vm_host_cached = db.get("vm_host_map")

    if vms_cached is None or moid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms_list, updated_at = vms_cached
    vcenter_hosts: list[dict] = hosts_cached[0] if hosts_cached else []
    vm_moid_map: dict[str, str] = moid_map_cached[0]
    vm_host_map: dict[str, str] = vm_host_cached[0] if vm_host_cached else {}

    # Batch SQL: aggregate VM CPU Ready per host (one query)
    host_ready = metrics_store.get_vm_cpu_ready_by_host(vm_moid_map, vm_host_map, period_days)

    # Sum vCPUs per host from CMDB VM data
    host_vcpus: dict[str, int] = {}
    for vm in vms_list:
        name = vm.get("name", "")
        vcpu = vm.get("vcpu") or 0
        if vcpu and name in vm_host_map:
            host_moid = vm_host_map[name]
            host_vcpus[host_moid] = host_vcpus.get(host_moid, 0) + vcpu

    items: list[VCenterHostItem] = []
    for h in vcenter_hosts:
        moid = h["moid"]
        hr = host_ready.get(moid, {})
        avg_ready = hr.get("avg_cpu_ready_pct")
        max_ready = hr.get("max_cpu_ready_pct")
        num_cores = h.get("num_cpu_cores")
        total_vcpus = host_vcpus.get(moid, 0)
        overcommit = round(total_vcpus / num_cores, 2) if num_cores and total_vcpus else None

        if avg_ready is not None and avg_ready >= _HOST_READY_CRIT_PCT:
            status = "critical"
        elif avg_ready is not None and avg_ready >= _HOST_READY_WARN_PCT:
            status = "warning"
        else:
            status = "ok"

        items.append(VCenterHostItem(
            moid=moid,
            name=h["name"],
            cluster=h.get("cluster"),
            num_cpu_cores=num_cores,
            memory_gb=h.get("memory_gb"),
            power_state=h.get("power_state", "unknown"),
            cpu_usage_pct=h.get("cpu_usage_pct"),
            mem_usage_pct=h.get("mem_usage_pct"),
            vm_count=hr.get("vm_count", 0),
            vms_with_data=hr.get("vms_with_data", 0),
            avg_vm_cpu_ready_pct=avg_ready,
            max_vm_cpu_ready_pct=max_ready,
            total_vcpus=total_vcpus,
            cpu_overcommit_ratio=overcommit,
            status=status,
        ))

    # Sort: critical first, then warning, then ok; within group by avg_ready desc
    _order = {"critical": 0, "warning": 1, "ok": 2}
    items.sort(key=lambda x: (_order.get(x.status, 3), -(x.avg_vm_cpu_ready_pct or 0)))

    powered_on = sum(1 for i in items if i.power_state == "poweredOn")
    warn_count = sum(1 for i in items if i.status in ("critical", "warning"))

    result = VCenterHostsResponse(
        total_hosts=len(items),
        powered_on=powered_on,
        hosts_with_ready_warn=warn_count,
        items=items,
        synced_at=updated_at,
    )
    response_cache.put(cache_key, result)
    return result


def _build_vm_cluster_map() -> dict[str, str | None]:
    """Build vm_name → cluster lookup from CMDB cache."""
    vms_cached = db.get("vms")
    if vms_cached is None:
        return {}
    return {vm["name"]: vm.get("cluster") for vm in vms_cached[0]}


def _snap_items(raw: list[dict], vm_cluster: dict[str, str | None]) -> list[VCenterSnapshotItem]:
    return [
        VCenterSnapshotItem(
            vm_name=s["vm_name"],
            name=s["name"],
            description=s.get("description", ""),
            created_at=s["created_at"],
            age_days=s["age_days"],
            cluster=vm_cluster.get(s["vm_name"]),
        )
        for s in raw
    ]


@router.post("/vcenter/snapshots/refresh", response_model=VCenterSnapshotsResponse)
async def refresh_snapshots():
    """Fetch current VM snapshots directly from vCenter (live call, may take ~10s)."""
    if not vcenter_client.settings.vcenter_host:
        raise HTTPException(status_code=503, detail="vCenter не налаштовано (VCENTER_HOST порожній)")

    raw = await vcenter_client.list_snapshots()
    db.set("vcenter_snapshots", raw)

    vm_cluster = _build_vm_cluster_map()
    snapshots = _snap_items(raw, vm_cluster)
    return VCenterSnapshotsResponse(total=len(snapshots), snapshots=snapshots)


@router.get("/vcenter/snapshots", response_model=VCenterSnapshotsResponse)
async def get_snapshots():
    """Return cached snapshot list (populated by /vcenter/snapshots/refresh)."""
    snap_cached = db.get("vcenter_snapshots")
    if snap_cached is None:
        return VCenterSnapshotsResponse(total=0, snapshots=[])

    vm_cluster = _build_vm_cluster_map()
    snapshots = _snap_items(snap_cached[0], vm_cluster)
    return VCenterSnapshotsResponse(total=len(snapshots), snapshots=snapshots)
