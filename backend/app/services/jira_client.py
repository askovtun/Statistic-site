"""Jira Insight Data Center REST API client.

Uses the same auth/retry patterns as the Jira-CMDB project:
  Basic Auth, X-Atlassian-Token: no-check, exponential back-off on 429/5xx.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)

_BASE = f"{settings.jira_url.rstrip('/')}/rest/insight/1.0"

_HEADERS = {
    "X-Atlassian-Token": "no-check",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def _auth() -> tuple[str, str]:
    return (settings.jira_user, settings.jira_password)


async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> Any:
    url = f"{_BASE}{path}"
    for attempt in range(1, settings.request_retries + 1):
        try:
            r = await client.get(url, params=params, headers=_HEADERS,
                                 auth=_auth(), timeout=30)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 5))
                log.warning("Rate-limited by Jira, sleeping %ss", wait)
                await asyncio.sleep(wait)
                continue
            if r.status_code in (502, 503, 504):
                wait = settings.request_delay * attempt * 3
                log.warning("Jira %s, retry %s/%s in %.1fs",
                            r.status_code, attempt, settings.request_retries, wait)
                await asyncio.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except httpx.RequestError as exc:
            if attempt < settings.request_retries:
                await asyncio.sleep(settings.request_delay * attempt * 2)
            else:
                raise RuntimeError(f"Jira request failed: {exc}") from exc
    return {}


def _attr_value(obj: dict, name: str) -> str | None:
    """Extract a single string value from a Jira Insight attribute by name."""
    for attr in obj.get("attributes", []):
        if attr.get("objectTypeAttributeId") and attr.get("objectTypeAttribute", {}).get("name") == name:
            vals = attr.get("objectAttributeValues", [])
            if vals:
                v = vals[0]
                return v.get("displayValue") or v.get("value")
    return None


def _attr_ref(obj: dict, name: str) -> str | None:
    """Extract a referenced object's name from a Jira Insight attribute."""
    for attr in obj.get("attributes", []):
        if attr.get("objectTypeAttribute", {}).get("name") == name:
            vals = attr.get("objectAttributeValues", [])
            if vals:
                ref = vals[0].get("referencedObject")
                if ref:
                    return ref.get("label") or ref.get("name")
    return None


async def _get_all_objects(type_id: int) -> list[dict]:
    """Fetch every object of a given type using IQL pagination."""
    objects: list[dict] = []
    page = 1
    page_size = 25

    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        while True:
            data = await _get(client, "/iql/objects", params={
                "objectSchemaId": settings.jira_schema_id,
                "iql": f"objectTypeId = {type_id}",
                "page": page,
                "pageSize": page_size,
                "includeAttributes": "true",
            })
            batch = data.get("objectEntries", [])
            objects.extend(batch)
            total = data.get("totalFilterCount", len(objects))
            log.debug("Jira IQL page %s: got %s / %s objects (type %s)",
                      page, len(objects), total, type_id)
            if len(objects) >= total or not batch:
                break
            page += 1
            await asyncio.sleep(settings.request_delay)

    return objects


async def get_all_vms() -> list[dict]:
    """Return list of VM dicts with keys: name, fqdn, status, os_family, cluster, vcpu, vram_gb."""
    raw = await _get_all_objects(settings.jira_vm_type_id)
    result = []
    for obj in raw:
        name = obj.get("label") or obj.get("name", "")
        result.append({
            "name": name,
            "fqdn": _attr_value(obj, "FQDN"),
            "status": _attr_ref(obj, "Status"),
            "os_family": _attr_ref(obj, "OS"),
            "cluster": _attr_ref(obj, "Cluster"),
            "vcpu": _int(_attr_value(obj, "vCPU Count")),
            "vram_gb": _int(_attr_value(obj, "vRAM GB")),
        })
    return result


async def get_all_clusters() -> list[dict]:
    """Return list of cluster dicts with keys: name, host_count, total_cpu_cores."""
    raw = await _get_all_objects(settings.jira_cluster_type_id)
    result = []
    for obj in raw:
        result.append({
            "name": obj.get("label") or obj.get("name", ""),
            "host_count": _int(_attr_value(obj, "Host Count")),
            "total_cpu_cores": _int(_attr_value(obj, "Total CPU Cores")),
        })
    return result


def _int(val: str | None) -> int | None:
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None
