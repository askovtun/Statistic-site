"""Zabbix JSON-RPC 2.0 API client.

Supports both legacy user/password login (Zabbix < 5.4) and
API token authentication (Zabbix >= 5.4).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Standard Zabbix agent item keys
ITEM_CPU_UTIL = "system.cpu.util"
ITEM_MEM_USED = "vm.memory.size[used]"
ITEM_MEM_TOTAL = "vm.memory.size[total]"
# Canonical key used in metric_hourly for any vfs.fs.size[*,pfree] item
ITEM_DISK_FREE_PCT = "vfs.fs.size[/,pfree]"

# VMware Hypervisor template item keys (canonical — stored after normalization)
ITEM_VMWARE_CPU_PCT = "vmware.hv.cpu.usage.perf"
ITEM_VMWARE_MEM_USED = "vmware.hv.memory.used"
ITEM_VMWARE_MEM_TOTAL = "vmware.hv.hw.memory"

_CORE_ITEM_KEYS = [ITEM_CPU_UTIL, ITEM_MEM_USED, ITEM_MEM_TOTAL]
# Search substring that matches all filesystem free-% items across Linux/Windows
_DISK_FREE_SEARCH = "pfree"
# VMware HV item key prefixes (parameterized in Zabbix, normalized on store)
_VMWARE_HV_PREFIXES = (ITEM_VMWARE_CPU_PCT, ITEM_VMWARE_MEM_USED, ITEM_VMWARE_MEM_TOTAL)

# history.get on this Zabbix instance is dramatically slower for multi-itemid
# queries than for single-item ones, so we fetch one item at a time with
# bounded concurrency.
_HISTORY_CONCURRENCY = 10

_EMPTY_METRICS = {
    "cpu_pct": None, "cpu_pct_max": None,
    "ram_pct": None, "ram_pct_max": None,
    "disk_free_pct": None, "disk_free_pct_min": None,
}


class ZabbixClient:
    def __init__(self) -> None:
        self._url = f"{settings.zabbix_url.rstrip('/')}/api_jsonrpc.php"
        self._token: str | None = settings.zabbix_api_token or None
        self._req_id = 0

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    async def _call(self, client: httpx.AsyncClient, method: str, params: dict) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self._next_id(),
        }
        headers = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        for attempt in range(1, settings.request_retries + 1):
            try:
                r = await client.post(self._url, json=payload, timeout=120, headers=headers)
                if r.status_code in (429, 502, 503, 504):
                    wait = settings.request_delay * attempt * 3
                    log.warning("Zabbix HTTP %s, retry %s in %.1fs", r.status_code, attempt, wait)
                    await asyncio.sleep(wait)
                    continue
                r.raise_for_status()
                body = r.json()
                if "error" in body:
                    raise RuntimeError(f"Zabbix API error: {body['error']}")
                return body.get("result")
            except httpx.RequestError as exc:
                if attempt < settings.request_retries:
                    await asyncio.sleep(settings.request_delay * attempt * 2)
                else:
                    raise RuntimeError(f"Zabbix request failed: {exc}") from exc
        return None

    async def _ensure_auth(self, client: httpx.AsyncClient) -> None:
        if self._token:
            return
        token = await self._call(client, "user.login", {
            "username": settings.zabbix_user,
            "password": settings.zabbix_password,
        })
        if not token:
            # Zabbix < 5.4 used "user" instead of "username"
            token = await self._call(client, "user.login", {
                "user": settings.zabbix_user,
                "password": settings.zabbix_password,
            })
        self._token = token
        log.debug("Zabbix authenticated, token acquired")

    async def get_all_hosts(self) -> list[dict]:
        """Return list of {hostid, host, name, status, groups[], interfaces[]}."""
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            hosts = await self._call(client, "host.get", {
                "output": ["hostid", "host", "name", "status"],
                "selectGroups": ["groupid", "name"],
                "selectInterfaces": ["ip", "dns", "useip", "main"],
            })
        return hosts or []

    async def get_metric_items(self, hostids: list[str]) -> list[dict]:
        """Return [{itemid, key_, hostid, value_type}] for CPU, RAM and disk items.

        CPU/RAM: exact key match for standard Zabbix agent items; substring
        search "vmware.hv" for VMware Hypervisor template items (ESXi/HV hosts).
        Disk: substring search "pfree" covers all filesystem variants.
        """
        if not hostids:
            return []
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            core_items, disk_items, vmware_items = await asyncio.gather(
                self._call(client, "item.get", {
                    "output": ["itemid", "key_", "hostid", "value_type"],
                    "filter": {"key_": _CORE_ITEM_KEYS},
                    "hostids": hostids,
                    "monitored": True,
                }),
                self._call(client, "item.get", {
                    "output": ["itemid", "key_", "hostid", "value_type"],
                    "search": {"key_": _DISK_FREE_SEARCH},
                    "hostids": hostids,
                    "monitored": True,
                }),
                self._call(client, "item.get", {
                    "output": ["itemid", "key_", "hostid", "value_type"],
                    "search": {"key_": "vmware.hv"},
                    "hostids": hostids,
                    "monitored": True,
                }),
            )
        # Keep only the VMware HV items we actually use
        filtered_vmware = [
            i for i in (vmware_items or [])
            if any(i["key_"].startswith(p) for p in _VMWARE_HV_PREFIXES)
        ]
        return (core_items or []) + (disk_items or []) + filtered_vmware

    async def get_recent_history(
        self,
        itemids_by_type: dict[str, list[str]],
        time_from: int,
        time_till: int,
    ) -> dict[str, list[tuple[int, float]]]:
        """Return raw history points {itemid: [(clock, value), ...]}.

        Issues one history.get call per itemid, in parallel bounded by
        _HISTORY_CONCURRENCY. Multi-itemid history.get queries are
        dramatically slower on this Zabbix instance than the equivalent
        per-item calls (a single item over 24h takes ~10s, while 10 items
        over 5h times out after 2 minutes), so per-item calls are the only
        way to fetch any meaningful window without timing out.
        """
        if not itemids_by_type:
            return {}

        sem = asyncio.Semaphore(_HISTORY_CONCURRENCY)

        async def fetch_one(client: httpx.AsyncClient, value_type: str, itemid: str):
            async with sem:
                history = await self._call(client, "history.get", {
                    "output": ["itemid", "clock", "value"],
                    "itemids": [itemid],
                    "history": int(value_type),
                    "time_from": time_from,
                    "time_till": time_till,
                    "sortfield": "clock",
                    "sortorder": "ASC",
                })
            points: list[tuple[int, float]] = []
            for row in history or []:
                try:
                    points.append((int(row["clock"]), float(row["value"])))
                except (ValueError, TypeError, KeyError):
                    continue
            return itemid, points

        series: dict[str, list[tuple[int, float]]] = {}
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            tasks = [
                fetch_one(client, value_type, itemid)
                for value_type, itemids in itemids_by_type.items()
                for itemid in itemids
            ]
            for result in await asyncio.gather(*tasks, return_exceptions=True):
                if isinstance(result, Exception):
                    log.warning("history.get failed for an item, skipping: %s", result)
                    continue
                itemid, points = result
                if points:
                    series[itemid] = points
        return series


_client = ZabbixClient()


async def get_all_hosts() -> list[dict]:
    return await _client.get_all_hosts()


async def get_metric_items(hostids: list[str]) -> list[dict]:
    return await _client.get_metric_items(hostids)


async def get_recent_history(
    itemids_by_type: dict[str, list[str]], time_from: int, time_till: int
) -> dict[str, list[tuple[int, float]]]:
    return await _client.get_recent_history(itemids_by_type, time_from, time_till)
