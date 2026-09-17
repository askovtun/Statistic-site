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
ITEM_MEM_UTILIZATION = "vm.memory.utilization"  # direct % — fallback when used/total absent
# Canonical key used in metric_hourly for any vfs.fs.size[*,pfree] item
ITEM_DISK_FREE_PCT = "vfs.fs.size[/,pfree]"

# VMware Hypervisor template item keys (canonical — stored after normalization)
ITEM_VMWARE_CPU_PCT = "vmware.hv.cpu.usage.perf"
ITEM_VMWARE_MEM_USED = "vmware.hv.memory.used"
ITEM_VMWARE_MEM_TOTAL = "vmware.hv.hw.memory"

_CORE_ITEM_KEYS = [ITEM_CPU_UTIL, ITEM_MEM_USED, ITEM_MEM_TOTAL, ITEM_MEM_UTILIZATION]
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


    async def get_problems(self) -> list[dict]:
        """Return all active Zabbix problems (triggers in PROBLEM state) with host info.

        Uses trigger.get because this Zabbix version doesn't support
        selectHosts on problem.get.
        """
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            triggers = await self._call(client, "trigger.get", {
                "output": ["triggerid", "description", "priority", "lastchange",
                           "value", "suppressed"],
                "filter": {"value": "1"},  # 1 = PROBLEM state
                "selectHosts": ["hostid", "name", "host"],
                "selectTags": ["tag", "value"],
                "selectLastEvent": ["eventid", "acknowledged"],
                "monitored": True,
                "skipDependent": True,
                "active": True,
                "expandDescription": True,
                "sortfield": ["priority", "lastchange"],
                "sortorder": "DESC",
            })
        return triggers or []

    async def get_problems_history(self, time_from: int, time_till: int) -> list[dict]:
        """Return problem events in a time window, merged with trigger/host info.

        Two-step: event.get (supports time_from/time_till) → trigger.get with
        the collected triggerids (supports selectHosts).
        """
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            events = await self._call(client, "event.get", {
                "output": ["eventid", "objectid", "clock", "acknowledged",
                           "suppressed"],
                "source": 0,   # trigger events
                "object": 0,   # triggers
                "value": 1,    # PROBLEM start events
                "time_from": time_from,
                "time_till": time_till,
                "selectTags": ["tag", "value"],
                "sortfield": "clock",
                "sortorder": "DESC",
                "limit": 10000,
            })
            if not events:
                return []

            triggerids = list({e["objectid"] for e in events})
            triggers = await self._call(client, "trigger.get", {
                "output": ["triggerid", "description", "priority"],
                "triggerids": triggerids,
                "selectHosts": ["hostid", "name", "host"],
                "expandDescription": True,
            })
        trigger_map = {t["triggerid"]: t for t in (triggers or [])}

        result = []
        for e in events:
            trigger = trigger_map.get(e["objectid"])
            if not trigger:
                continue
            result.append({
                "triggerid": e["eventid"],
                "description": trigger.get("description", ""),
                "priority": trigger.get("priority", 0),
                "lastchange": e["clock"],
                "suppressed": e.get("suppressed", "0"),
                "hosts": trigger.get("hosts", []),
                "tags": e.get("tags", []),
                "lastEvent": {"acknowledged": e.get("acknowledged", "0")},
            })
        return result


    # Hosts matching these name substrings (case-insensitive) are considered network devices
    _NET_DEVICE_PATTERNS = ("forti", "cisco", "fg-", "fgt-")

    @staticmethod
    def _is_net_device(host_name: str) -> bool:
        n = host_name.lower()
        return any(p in n for p in ZabbixClient._NET_DEVICE_PATTERNS)

    async def get_channel_hosts(self) -> list[dict]:
        """Return FortiGate/Cisco hosts that have net.if.in items."""
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            items = await self._call(client, "item.get", {
                "output": ["itemid", "hostid", "name", "key_", "units", "lastvalue", "lastclock"],
                "search": {"key_": "net.if.in"},
                "searchWildcardsEnabled": True,
                "selectHosts": ["hostid", "name"],
                "status": 0,
                "limit": 1000,
            })
        if not items:
            return []

        # Build per-host interface map from in-items, then pair with out-items
        host_map: dict[str, dict] = {}
        iface_map: dict[str, dict] = {}  # ifname@hostid -> iface dict

        for it in (items or []):
            hosts = it.get("hosts") or []
            if not hosts:
                continue
            hostid = hosts[0]["hostid"]
            host_name = hosts[0]["name"]
            # Only include FortiGate and Cisco devices
            if not self._is_net_device(host_name):
                continue
            if hostid not in host_map:
                host_map[hostid] = {"hostid": hostid, "name": host_name, "interfaces": []}

            # Extract ifname from key_ = "net.if.in[ifname,...]"
            key = it["key_"]
            ifname = key[len("net.if.in["):].rstrip("]").split(",")[0]
            slot = f"{ifname}@{hostid}"
            if slot not in iface_map:
                iface = {
                    "ifname": ifname,
                    "itemid_in": it["itemid"],
                    "itemid_out": None,
                    "last_in": float(it["lastvalue"]) if it.get("lastvalue") else None,
                    "last_out": None,
                    "lastclock": int(it["lastclock"]) if it.get("lastclock") else None,
                }
                iface_map[slot] = iface
                host_map[hostid]["interfaces"].append(iface)

        # Find matching out-items
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            out_items = await self._call(client, "item.get", {
                "output": ["itemid", "hostid", "key_", "lastvalue"],
                "search": {"key_": "net.if.out"},
                "searchWildcardsEnabled": True,
                "status": 0,
                "limit": 1000,
            })
        for it in (out_items or []):
            hostid = it.get("hostid", "")
            key = it["key_"]
            ifname = key[len("net.if.out["):].rstrip("]").split(",")[0]
            slot = f"{ifname}@{hostid}"
            if slot in iface_map:
                iface_map[slot]["itemid_out"] = it["itemid"]
                iface_map[slot]["last_out"] = float(it["lastvalue"]) if it.get("lastvalue") else None

        return list(host_map.values())

    async def get_channel_history(
        self, itemid_in: str, itemid_out: str | None, time_from: int, time_till: int
    ) -> list[dict]:
        """Return time-series for one network interface (in + out bps)."""
        itemids = [itemid_in]
        if itemid_out:
            itemids.append(itemid_out)
        async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
            await self._ensure_auth(client)
            # Try float history first (type 0=uint, 3=float — network counters are often uint)
            points = await self._call(client, "history.get", {
                "output": "extend",
                "history": 3,
                "itemids": itemids,
                "time_from": time_from,
                "time_till": time_till,
                "sortfield": "clock",
                "sortorder": "ASC",
                "limit": 10000,
            })
            if not points:
                points = await self._call(client, "history.get", {
                    "output": "extend",
                    "history": 0,
                    "itemids": itemids,
                    "time_from": time_from,
                    "time_till": time_till,
                    "sortfield": "clock",
                    "sortorder": "ASC",
                    "limit": 10000,
                })

        # Merge into {clock -> {in, out}}
        merged: dict[int, dict] = {}
        for p in (points or []):
            clock = int(p["clock"])
            val = float(p["value"]) if p.get("value") else 0.0
            if p["itemid"] == itemid_in:
                merged.setdefault(clock, {})["in"] = val
            elif itemid_out and p["itemid"] == itemid_out:
                merged.setdefault(clock, {})["out"] = val

        result = []
        for clock in sorted(merged):
            row = merged[clock]
            result.append({"clock": clock, "in": row.get("in"), "out": row.get("out")})
        return result


_client = ZabbixClient()


async def get_all_hosts() -> list[dict]:
    return await _client.get_all_hosts()


async def get_metric_items(hostids: list[str]) -> list[dict]:
    return await _client.get_metric_items(hostids)


async def get_recent_history(
    itemids_by_type: dict[str, list[str]], time_from: int, time_till: int
) -> dict[str, list[tuple[int, float]]]:
    return await _client.get_recent_history(itemids_by_type, time_from, time_till)


async def get_problems() -> list[dict]:
    return await _client.get_problems()


async def get_problems_history(time_from: int, time_till: int) -> list[dict]:
    return await _client.get_problems_history(time_from, time_till)


async def get_channel_hosts() -> list[dict]:
    return await _client.get_channel_hosts()


async def get_channel_history(
    itemid_in: str, itemid_out: str | None, time_from: int, time_till: int
) -> list[dict]:
    return await _client.get_channel_history(itemid_in, itemid_out, time_from, time_till)
