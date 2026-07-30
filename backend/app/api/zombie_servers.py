"""Zombie server detection: VMs that are powered on but show no real workload.

Signal logic (each confirmed signal = +1 to zombie_score):
  low_cpu       — avg CPU < 3%  AND  peak CPU < 20%  over the full period
  low_ram       — avg RAM < 10% AND  peak RAM < 30%  over the full period
  no_zabbix     — powered on in vCenter but absent from Zabbix monitoring
  no_metrics    — no data from either Zabbix or vCenter
  wasted_alloc  — ≥8 vCPU allocated + avg CPU < 3%

Using both avg AND max prevents false positives: a VM with avg 2% but a
weekly spike to 60% is NOT a zombie — it just has bursty workload.

All metrics are fetched in two SQL batch queries (not N per-VM queries).
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import ZombieServerItem, ZombieServerResponse
from app.services import db, metrics_store, response_cache

router = APIRouter(tags=["zombie-servers"])

_CACHE_TTL = 300  # 5 minutes

# ── Thresholds ────────────────────────────────────────────────────────────────
CPU_AVG_THRESHOLD  = 3.0    # avg CPU below this → suspect
CPU_PEAK_THRESHOLD = 20.0   # peak CPU below this (combined with avg) → confirmed low_cpu
RAM_AVG_THRESHOLD  = 10.0   # avg RAM below this → suspect
RAM_PEAK_THRESHOLD = 30.0   # peak RAM below this (combined with avg) → confirmed low_ram
BIG_VM_VCPU        = 8      # ≥ this vCPU + low cpu → wasted_alloc


@router.get("/zombie-servers", response_model=ZombieServerResponse)
async def get_zombie_servers(
    period_days: int = Query(default=90, description="Період аналізу в днях (7/14/30/90)"),
    min_score: int   = Query(default=1,  description="Мінімальний zombie-score (1-5)"),
) -> ZombieServerResponse:

    cache_key = f"zombie:{period_days}:{min_score}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached         = db.get("vms")
    hostid_map_cached  = db.get("vm_hostid_map")
    moid_map_cached    = db.get("vm_moid_map")
    vcenter_vms_cached = db.get("vcenter_vms")
    vm_host_map_cached = db.get("vm_host_map")
    vc_hosts_cached    = db.get("vcenter_hosts")

    vms: list[dict]               = vms_cached[0]         if vms_cached         else []
    synced_at: str | None         = vms_cached[1]         if vms_cached         else None
    vm_hostid_map: dict[str, str] = hostid_map_cached[0]  if hostid_map_cached  else {}
    vm_moid_map: dict[str, str]   = moid_map_cached[0]    if moid_map_cached    else {}
    vcenter_vms: list[dict]       = vcenter_vms_cached[0] if vcenter_vms_cached else []
    vm_host_map: dict[str, str]   = vm_host_map_cached[0] if vm_host_map_cached else {}
    vc_hosts: list[dict]          = vc_hosts_cached[0]    if vc_hosts_cached    else []

    if not vms:
        result = ZombieServerResponse(total=0, items=[], synced_at=synced_at, period_days=period_days)
        response_cache.put(cache_key, result)
        return result

    # ── Lookup tables ─────────────────────────────────────────────────────────
    vc_by_moid: dict[str, dict] = {v["moid"]: v for v in vcenter_vms if v.get("moid")}
    host_cluster: dict[str, str] = {
        h["moid"]: h["cluster"]
        for h in vc_hosts
        if h.get("moid") and h.get("cluster")
    }

    # ── Batch metric fetch (2 SQL queries total) ──────────────────────────────
    # Only pass maps for VMs that actually have Zabbix/vCenter entries.
    all_vm_names = {vm.get("name") for vm in vms if vm.get("name")}
    zb_map = {n: vm_hostid_map[n] for n in all_vm_names if n in vm_hostid_map}
    vc_map = {n: vm_moid_map[n]   for n in all_vm_names if n in vm_moid_map}

    metrics_by_vm = metrics_store.get_zombie_metrics_batch(zb_map, vc_map, period_days)

    # ── Analyse each VM ───────────────────────────────────────────────────────
    items: list[ZombieServerItem] = []

    for vm in vms:
        name = vm.get("name", "")
        if not name:
            continue

        hostid = vm_hostid_map.get(name)
        moid   = vm_moid_map.get(name)
        vc_vm  = vc_by_moid.get(moid) if moid else None

        power_state = vc_vm.get("power_state", "unknown") if vc_vm else "unknown"
        if power_state == "poweredOff":
            continue

        # ── Resolve metrics (prefer Zabbix, supplement with vCenter) ─────────
        m = metrics_by_vm.get(name, {})

        # CPU: prefer Zabbix; fall back to vCenter
        cpu_avg  = m.get("cpu_avg")  if m.get("cpu_avg")  is not None else m.get("vc_cpu_avg")
        cpu_max  = m.get("cpu_max")  if m.get("cpu_max")  is not None else m.get("vc_cpu_max")
        ram_avg  = m.get("ram_avg")  if m.get("ram_avg")  is not None else m.get("vc_ram_avg")
        ram_max  = m.get("ram_max")  if m.get("ram_max")  is not None else m.get("vc_ram_max")
        coverage = m.get("coverage_pct")

        # ── Zombie signals ────────────────────────────────────────────────────
        signals: list[str] = []
        has_any_metrics = cpu_avg is not None or ram_avg is not None

        # 1. No metrics at all while in vCenter
        if not has_any_metrics and vc_vm:
            signals.append("no_metrics")

        # 2. low_cpu: consistently idle — avg AND peak both low
        #    (guards against bursty VMs that just have a low time-weighted avg)
        if cpu_avg is not None and cpu_avg < CPU_AVG_THRESHOLD:
            if cpu_max is None or cpu_max < CPU_PEAK_THRESHOLD:
                signals.append("low_cpu")

        # 3. low_ram: consistently low memory pressure
        if ram_avg is not None and ram_avg < RAM_AVG_THRESHOLD:
            if ram_max is None or ram_max < RAM_PEAK_THRESHOLD:
                signals.append("low_ram")

        # 4. Not monitored by Zabbix but running in vCenter
        if not hostid and vc_vm and power_state == "poweredOn":
            signals.append("no_zabbix")

        # 5. Oversized allocation with near-zero utilisation
        vcpu = vm.get("vcpu") or (vc_vm.get("vcpu") if vc_vm else None)
        if vcpu and vcpu >= BIG_VM_VCPU and cpu_avg is not None and cpu_avg < CPU_AVG_THRESHOLD:
            signals.append("wasted_alloc")

        score = len(signals)
        if score < min_score:
            continue

        # ── Cluster from vCenter runtime host ─────────────────────────────────
        runtime_host = vc_vm.get("runtime_host") if vc_vm else None
        cluster = host_cluster.get(runtime_host) if runtime_host else vm.get("cluster")

        items.append(ZombieServerItem(
            name=name,
            fqdn=vm.get("fqdn"),
            primary_ip=vm.get("primary_ip"),
            cluster=cluster,
            os_family=vm.get("os_family"),
            vcpu=vcpu,
            vram_gb=vm.get("vram_gb") or (vc_vm.get("vram_gb") if vc_vm else None),
            power_state=power_state,
            avg_cpu_pct=round(cpu_avg, 1) if cpu_avg is not None else None,
            max_cpu_pct=round(cpu_max, 1) if cpu_max is not None else None,
            avg_ram_pct=round(ram_avg, 1) if ram_avg is not None else None,
            max_ram_pct=round(ram_max, 1) if ram_max is not None else None,
            data_coverage_pct=coverage,
            in_zabbix=bool(hostid),
            in_vcenter=bool(vc_vm),
            zombie_score=score,
            signals=signals,
        ))

    items.sort(key=lambda x: (-x.zombie_score, x.name.lower()))

    score_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for it in items:
        score_counts[min(it.zombie_score, 5)] += 1

    result = ZombieServerResponse(
        total=len(items),
        score5=score_counts[5],
        score4=score_counts[4],
        score3=score_counts[3],
        score2=score_counts[2],
        score1=score_counts[1],
        items=items,
        synced_at=synced_at,
        period_days=period_days,
    )
    response_cache.put(cache_key, result)
    return result
