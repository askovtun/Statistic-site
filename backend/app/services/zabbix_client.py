"""Zabbix JSON-RPC 2.0 API client.

Supports both legacy user/password login (Zabbix < 5.4) and
API token authentication (Zabbix >= 5.4).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Standard Zabbix item keys for resource monitoring
ITEM_CPU_UTIL = "system.cpu.util"
ITEM_MEM_USED = "vm.memory.size[used]"
ITEM_MEM_TOTAL = "vm.memory.size[total]"
ITEM_DISK_FREE_PCT = "vfs.fs.size[/,pfree]"


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
        if self._token:
            payload["auth"] = self._token

        for attempt in range(1, settings.request_retries + 1):
            try:
                r = await client.post(self._url, json=payload, timeout=60,
                                      verify=settings.ssl_verify)
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
        """Return list of {hostid, host, name, status, groups[]}."""
        async with httpx.AsyncClient() as client:
            await self._ensure_auth(client)
            hosts = await self._call(client, "host.get", {
                "output": ["hostid", "host", "name", "status"],
                "selectGroups": ["groupid", "name"],
            })
        return hosts or []

    async def get_host_metrics(
        self,
        host_names: list[str],
        period_days: int | None = None,
    ) -> dict[str, dict[str, float | None]]:
        """Return average metric values per host name over the given period.

        Returns:
            { hostname: { "cpu_pct": float|None, "ram_pct": float|None, "disk_free_pct": float|None } }
        """
        period = period_days or settings.metrics_period_days
        time_till = int(time.time())
        time_from = time_till - period * 86400

        result: dict[str, dict[str, float | None]] = {
            h: {"cpu_pct": None, "ram_pct": None, "disk_free_pct": None}
            for h in host_names
        }

        if not host_names:
            return result

        async with httpx.AsyncClient() as client:
            await self._ensure_auth(client)

            # Fetch items for the needed keys
            items = await self._call(client, "item.get", {
                "output": ["itemid", "key_", "hostid", "lastvalue"],
                "filter": {"key_": [ITEM_CPU_UTIL, ITEM_MEM_USED, ITEM_MEM_TOTAL, ITEM_DISK_FREE_PCT]},
                "host": host_names,
                "monitored": True,
            })
            if not items:
                return result

            # Build hostid → hostname map
            host_map: dict[str, str] = {}
            hosts_data = await self._call(client, "host.get", {
                "output": ["hostid", "host"],
                "filter": {"host": host_names},
            })
            for h in (hosts_data or []):
                host_map[h["hostid"]] = h["host"]

            # Group items by hostid and key
            by_host: dict[str, dict[str, list[str]]] = {}
            for item in items:
                hid = item["hostid"]
                key = item["key_"]
                by_host.setdefault(hid, {}).setdefault(key, []).append(item["itemid"])

            # Fetch history averages per item
            async def _avg(itemids: list[str]) -> float | None:
                history = await self._call(client, "history.get", {
                    "output": ["value"],
                    "itemids": itemids,
                    "time_from": time_from,
                    "time_till": time_till,
                    "history": 0,  # float
                    "limit": 10000,
                })
                if not history:
                    return None
                vals = [float(e["value"]) for e in history if e.get("value") is not None]
                return sum(vals) / len(vals) if vals else None

            for hid, keys in by_host.items():
                hostname = host_map.get(hid)
                if hostname not in result:
                    continue

                # CPU %
                if ITEM_CPU_UTIL in keys:
                    result[hostname]["cpu_pct"] = await _avg(keys[ITEM_CPU_UTIL])

                # RAM %
                used_ids = keys.get(ITEM_MEM_USED, [])
                total_ids = keys.get(ITEM_MEM_TOTAL, [])
                if used_ids and total_ids:
                    used = await _avg(used_ids)
                    total = await _avg(total_ids)
                    if used is not None and total and total > 0:
                        result[hostname]["ram_pct"] = used / total * 100

                # Disk free %
                if ITEM_DISK_FREE_PCT in keys:
                    result[hostname]["disk_free_pct"] = await _avg(keys[ITEM_DISK_FREE_PCT])

        return result


_client = ZabbixClient()


async def get_all_hosts() -> list[dict]:
    return await _client.get_all_hosts()


async def get_host_metrics(host_names: list[str], period_days: int | None = None) -> dict:
    return await _client.get_host_metrics(host_names, period_days)
