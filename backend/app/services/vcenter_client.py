"""vCenter (vSphere) client via pyVmomi.

pyVmomi is a synchronous SOAP client, so every call here is wrapped in
asyncio.to_thread(...) to match the async style of the other clients.

If settings.vcenter_host is empty, all functions return empty results —
vCenter metrics are then simply absent everywhere downstream.
"""
from __future__ import annotations

import asyncio
import logging
import ssl
from datetime import datetime, timedelta, timezone
from typing import Iterator

from pyVim.connect import Disconnect, SmartConnect
from pyVmomi import vim

from app.config import settings

log = logging.getLogger(__name__)

# Synthetic metric keys stored in metric_hourly (source='vcenter')
ITEM_VC_CPU = "vc.cpu.usage"
ITEM_VC_MEM = "vc.mem.usage"
ITEM_VC_DISK_IO = "vc.disk.usage"
ITEM_VC_DISK_SPACE = "vc.disk.space.used_pct"

_EMPTY_VCENTER_METRICS = {
    "vc_cpu_pct": None, "vc_cpu_pct_max": None,
    "vc_ram_pct": None, "vc_ram_pct_max": None,
    "disk_used_pct": None, "disk_used_pct_max": None,
    "disk_io_kbps": None, "disk_io_kbps_max": None,
}

# cpu.usage/mem.usage are reported in hundredths of a percent (5000 = 50.00%)
_PCT_SCALE = 100.0

_COUNTERS = {
    "cpu.usage": ("average", "minimum", "maximum"),
    "mem.usage": ("average", "minimum", "maximum"),
    "disk.usage": ("average", "minimum", "maximum"),
}

# vCenter's vpxd.stats.maxQueryMetrics setting (default 64) caps the total
# number of metrics (counters x entities) returned by a single QueryPerf
# call, so the entity batch size must shrink as the metric-id count grows.
_MAX_QUERY_METRICS = 64


def _batched(seq: list, n: int) -> Iterator[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def _connect():
    if not settings.vcenter_host:
        return None
    context = None if settings.vcenter_verify_ssl else ssl._create_unverified_context()
    return SmartConnect(
        host=settings.vcenter_host,
        user=settings.vcenter_user,
        pwd=settings.vcenter_password,
        sslContext=context,
    )


def _list_vms_sync() -> list[dict]:
    """VM inventory: name/guest identity + current disk-space usage %."""
    si = _connect()
    if si is None:
        return []
    try:
        content = si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        out = []
        for vm in view.view:
            s = vm.summary
            committed = s.storage.committed or 0
            uncommitted = s.storage.uncommitted or 0
            total = committed + uncommitted
            guest = vm.guest
            out.append({
                "moid": vm._moId,
                "name": s.config.name,
                "guest_hostname": guest.hostName if guest else None,
                "guest_ip": guest.ipAddress if guest else None,
                "disk_used_pct": (committed / total * 100) if total else None,
            })
        view.Destroy()
        return out
    finally:
        Disconnect(si)


def _counter_ids(perf_manager) -> dict[tuple[str, str], int]:
    """Map (counter group.name, rollupType) -> counterId."""
    return {
        (f"{c.groupInfo.key}.{c.nameInfo.key}", c.rollupType): c.key
        for c in perf_manager.perfCounter
    }


def _query_perf_sync(moids: list[str], days: int) -> dict[str, list[dict]]:
    """Daily CPU/RAM/disk.usage avg+min+max for the last `days` days.

    Uses the Level-1 archive interval (86400s = 1 day), which by default
    retains cpu.usage/mem.usage/disk.usage average/minimum/maximum rollups
    for 1 year.
    """
    si = _connect()
    if si is None:
        return {}
    try:
        content = si.RetrieveContent()
        pm = content.perfManager
        cids = _counter_ids(pm)
        metric_ids = [
            vim.PerformanceManager.MetricId(counterId=cids[(counter, rollup)], instance="")
            for counter, rollups in _COUNTERS.items()
            for rollup in rollups
            if (counter, rollup) in cids
        ]

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        batch_size = max(1, _MAX_QUERY_METRICS // max(1, len(metric_ids)))

        result: dict[str, list[dict]] = {}
        for chunk in _batched(moids, batch_size):
            specs = [
                vim.PerformanceManager.QuerySpec(
                    entity=vim.VirtualMachine(moid, si._stub),
                    metricId=metric_ids,
                    intervalId=86400,
                    startTime=start,
                    endTime=end,
                )
                for moid in chunk
            ]
            for em in pm.QueryPerf(querySpec=specs):
                timestamps = [int(s.timestamp.timestamp()) for s in em.sampleInfo]
                series = {v.id.counterId: list(v.value) for v in em.value}

                def val(i: int, counter: str, rollup: str, scale: float = 1.0) -> float | None:
                    vals = series.get(cids.get((counter, rollup)))
                    if not vals or vals[i] == -1:
                        return None
                    return vals[i] / scale

                result[em.entity._moId] = [
                    {
                        "timestamp": ts,
                        "cpu_avg": val(i, "cpu.usage", "average", _PCT_SCALE),
                        "cpu_min": val(i, "cpu.usage", "minimum", _PCT_SCALE),
                        "cpu_max": val(i, "cpu.usage", "maximum", _PCT_SCALE),
                        "mem_avg": val(i, "mem.usage", "average", _PCT_SCALE),
                        "mem_min": val(i, "mem.usage", "minimum", _PCT_SCALE),
                        "mem_max": val(i, "mem.usage", "maximum", _PCT_SCALE),
                        "disk_io_avg": val(i, "disk.usage", "average"),
                        "disk_io_min": val(i, "disk.usage", "minimum"),
                        "disk_io_max": val(i, "disk.usage", "maximum"),
                    }
                    for i, ts in enumerate(timestamps)
                ]
        return result
    finally:
        Disconnect(si)


async def list_vms() -> list[dict]:
    try:
        return await asyncio.to_thread(_list_vms_sync)
    except Exception:
        log.exception("vCenter list_vms failed")
        return []


async def query_perf(moids: list[str], days: int) -> dict[str, list[dict]]:
    if not moids:
        return {}
    try:
        return await asyncio.to_thread(_query_perf_sync, moids, days)
    except Exception:
        log.exception("vCenter query_perf failed")
        return {}
