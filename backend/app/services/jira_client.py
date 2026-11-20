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


_attr_map_cache: dict[int, dict[int, str]] = {}


async def _get_attr_map(client: httpx.AsyncClient, type_id: int) -> dict[int, str]:
    """Return {objectTypeAttributeId: attributeName} for an object type.

    The /iql/objects response only includes objectTypeAttributeId (numeric),
    not the attribute name, so it must be resolved via a separate call.
    """
    if type_id not in _attr_map_cache:
        data = await _get(client, f"/objecttype/{type_id}/attributes")
        _attr_map_cache[type_id] = {a["id"]: a["name"] for a in data}
    return _attr_map_cache[type_id]


def _attr_value(obj: dict, attr_map: dict[int, str], name: str) -> str | None:
    """Extract a single string value from a Jira Insight attribute by name."""
    for attr in obj.get("attributes", []):
        if attr_map.get(attr.get("objectTypeAttributeId")) == name:
            vals = attr.get("objectAttributeValues", [])
            if vals:
                v = vals[0]
                return v.get("displayValue") or v.get("value")
    return None


def _attr_ref(obj: dict, attr_map: dict[int, str], name: str) -> str | None:
    """Extract a referenced object's name from a Jira Insight attribute."""
    for attr in obj.get("attributes", []):
        if attr_map.get(attr.get("objectTypeAttributeId")) == name:
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
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, settings.jira_vm_type_id)
    result = []
    for obj in raw:
        name = obj.get("label") or obj.get("name", "")
        result.append({
            "jira_id":      str(obj.get("id", "")),
            "jira_updated": obj.get("updated"),   # ISO datetime from Jira
            "name":         name,
            "fqdn":         _attr_value(obj, attr_map, "FQDN"),
            "cname":        _attr_value(obj, attr_map, "CNAME"),
            "primary_ip":   _attr_value(obj, attr_map, "Primary IP"),
            "status":       _attr_ref(obj, attr_map, "Status"),
            "os_family":    _attr_ref(obj, attr_map, "OS"),
            "cluster":      _attr_ref(obj, attr_map, "Cluster"),
            "vcpu":         _int(_attr_value(obj, attr_map, "vCPU Count")),
            "vram_gb":      _int(_attr_value(obj, attr_map, "vRAM GB")),
        })
    return result


async def get_all_physical_servers() -> list[dict]:
    """Return physical server dicts: name, fqdn, primary_ip, status, location,
    manufacturer, model, cpu_count, cpu_cores, ram_gb, storage_config."""
    raw = await _get_all_objects(settings.jira_physical_server_type_id)
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, settings.jira_physical_server_type_id)
    result = []
    for obj in raw:
        name = obj.get("label") or obj.get("name", "")
        result.append({
            "jira_id":        str(obj.get("id", "")),
            "jira_updated":   obj.get("updated"),
            "name":           name,
            "fqdn":           _attr_value(obj, attr_map, "FQDN"),
            "cname":          _attr_value(obj, attr_map, "CNAME"),
            "primary_ip":     _attr_value(obj, attr_map, "Primary IP"),
            "status":         _attr_ref(obj, attr_map, "Status"),
            "location":       _attr_ref(obj, attr_map, "Location"),
            "manufacturer":   _attr_value(obj, attr_map, "Manufacturer"),
            "model":          _attr_value(obj, attr_map, "Model"),
            "cpu_count":      _int(_attr_value(obj, attr_map, "CPU Count")),
            "cpu_cores":      _int(_attr_value(obj, attr_map, "CPU Cores")),
            "ram_gb":         _int(_attr_value(obj, attr_map, "RAM GB")),
            "storage_config": _attr_value(obj, attr_map, "Storage Config"),
        })
    return result


async def get_all_clusters() -> list[dict]:
    """Return list of cluster dicts with keys: name, host_count, total_cpu_cores."""
    raw = await _get_all_objects(settings.jira_cluster_type_id)
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, settings.jira_cluster_type_id)
    result = []
    for obj in raw:
        result.append({
            "jira_id":         str(obj.get("id", "")),
            "jira_updated":    obj.get("updated"),
            "name":            obj.get("label") or obj.get("name", ""),
            "host_count":      _int(_attr_value(obj, attr_map, "Host Count")),
            "total_cpu_cores": _int(_attr_value(obj, attr_map, "Total CPU Cores")),
        })
    return result


async def find_cluster_by_name(name: str) -> str | None:
    """Search Jira CMDB for a cluster by vCenter name (tries CLR-{name} first, then bare name).

    Clusters in CMDB use CLR- prefix, so 'UCL-VSAN' → searches 'CLR-UCL-VSAN'.
    Returns jira_id or None.
    """
    clr_name = f"CLR-{name}" if not name.upper().startswith("CLR-") else name
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        for search_name in (clr_name, name):
            safe = search_name.replace('"', '\\"')
            iql = f'objectTypeId = {settings.jira_cluster_type_id} AND Name = "{safe}"'
            data = await _get(client, "/iql/objects", params={
                "objectSchemaId": settings.jira_schema_id,
                "iql": iql,
                "resultPerPage": 2,
                "page": 1,
                "includeAttributes": "false",
            })
            entries = data.get("objectEntries", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            if entries:
                return str(entries[0].get("id", ""))
    return None


async def get_objects_minimal(type_ids: list[int]) -> list[dict]:
    """Fetch objects of given type IDs with only jira_id/name/jira_updated.

    Much lighter than the full object fetches — no attr_map lookup needed.
    Used for CMDB change tracking of CI types we don't analyse further.
    """
    result: list[dict] = []
    for type_id in type_ids:
        raw = await _get_all_objects(type_id)
        for obj in raw:
            jid = str(obj.get("id", ""))
            if not jid:
                continue
            result.append({
                "jira_id":      jid,
                "name":         obj.get("label") or obj.get("name") or "",
                "jira_updated": obj.get("updated"),
            })
    return result


def _int(val: str | None) -> int | None:
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


# ── Analytics fetchers (live, with per-request response_cache TTL) ─────────────

async def get_applications() -> list[dict]:
    """Fetch Application (94) objects: jira_id, name, status."""
    raw = await _get_all_objects(94)
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, 94)
    return [
        {
            "jira_id": str(obj.get("id", "")),
            "name": obj.get("label") or obj.get("name", ""),
            "status": _attr_ref(obj, attr_map, "Status") or _attr_value(obj, attr_map, "Status"),
            "ci_type": "application",
        }
        for obj in raw
    ]


async def get_it_services() -> list[dict]:
    """Fetch IT Service (110) objects: jira_id, name, status."""
    raw = await _get_all_objects(110)
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, 110)
    return [
        {
            "jira_id": str(obj.get("id", "")),
            "name": obj.get("label") or obj.get("name", ""),
            "status": _attr_ref(obj, attr_map, "Status") or _attr_value(obj, attr_map, "Status"),
            "ci_type": "it_service",
        }
        for obj in raw
    ]


_NETWORK_TYPE_LABELS = {102: "Router", 103: "Switch", 104: "Firewall", 105: "AP"}


async def get_network_devices() -> list[dict]:
    """Fetch network devices (Router=102, Switch=103, Firewall=104, AP=105)."""
    result: list[dict] = []
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        for type_id, type_label in _NETWORK_TYPE_LABELS.items():
            try:
                raw = await _get_all_objects(type_id)
                attr_map = await _get_attr_map(client, type_id)
                for obj in raw:
                    location = (
                        _attr_ref(obj, attr_map, "Location")
                        or _attr_ref(obj, attr_map, "Site")
                        or _attr_value(obj, attr_map, "Location")
                        or _attr_value(obj, attr_map, "Site")
                    )
                    result.append({
                        "jira_id": str(obj.get("id", "")),
                        "name": obj.get("label") or obj.get("name", ""),
                        "device_type": type_label,
                        "location": location,
                        "status": (
                            _attr_ref(obj, attr_map, "Status")
                            or _attr_value(obj, attr_map, "Status")
                        ),
                    })
            except Exception:
                log.exception("Failed to fetch network devices type %s", type_id)
    return result


async def get_server_rooms() -> list[dict]:
    """Fetch Server Room (126) objects: jira_id, name, status, site."""
    raw = await _get_all_objects(126)
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_map(client, 126)
    return [
        {
            "jira_id": str(obj.get("id", "")),
            "name": obj.get("label") or obj.get("name", ""),
            "status": _attr_ref(obj, attr_map, "Status") or _attr_value(obj, attr_map, "Status"),
            "site": _attr_ref(obj, attr_map, "Site"),
        }
        for obj in raw
    ]


async def _post(client: httpx.AsyncClient, path: str, body: dict) -> Any:
    url = f"{_BASE}{path}"
    for attempt in range(1, settings.request_retries + 1):
        try:
            r = await client.post(url, json=body, headers=_HEADERS,
                                  auth=_auth(), timeout=30)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 5))
                log.warning("Rate-limited by Jira, sleeping %ss", wait)
                await asyncio.sleep(wait)
                continue
            if r.status_code in (502, 503, 504):
                wait = settings.request_delay * attempt * 3
                await asyncio.sleep(wait)
                continue
            if r.status_code >= 400:
                log.error("Jira POST %s → %s: %s", path, r.status_code, r.text[:500])
            r.raise_for_status()
            return r.json()
        except httpx.RequestError as exc:
            if attempt < settings.request_retries:
                await asyncio.sleep(settings.request_delay * attempt * 2)
            else:
                raise RuntimeError(f"Jira POST failed: {exc}") from exc
    return {}


async def _put(client: httpx.AsyncClient, path: str, body: dict) -> Any:
    url = f"{_BASE}{path}"
    for attempt in range(1, settings.request_retries + 1):
        try:
            r = await client.put(url, json=body, headers=_HEADERS,
                                 auth=_auth(), timeout=30)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 5))
                await asyncio.sleep(wait)
                continue
            if r.status_code in (502, 503, 504):
                await asyncio.sleep(settings.request_delay * attempt * 3)
                continue
            r.raise_for_status()
            return r.json()
        except httpx.RequestError as exc:
            if attempt < settings.request_retries:
                await asyncio.sleep(settings.request_delay * attempt * 2)
            else:
                raise RuntimeError(f"Jira PUT failed: {exc}") from exc
    return {}


# Separate cache for name→id direction (used when creating objects)
_attr_name_to_id_cache: dict[int, dict[str, int]] = {}


async def _get_attr_name_to_id(client: httpx.AsyncClient, type_id: int) -> dict[str, int]:
    if type_id not in _attr_name_to_id_cache:
        data = await _get(client, f"/objecttype/{type_id}/attributes")
        _attr_name_to_id_cache[type_id] = {a["name"]: a["id"] for a in data}
    return _attr_name_to_id_cache[type_id]


async def create_vm(
    name: str,
    vcpu: int | None = None,
    vram_gb: int | None = None,
    cluster_jira_id: str | None = None,
    fqdn: str | None = None,
) -> dict:
    """Create a single VM in Jira CMDB and return the created object dict."""
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_vm_type_id)

        attrs = []

        def _attr(attr_name: str, value: str) -> None:
            aid = attr_map.get(attr_name)
            if aid:
                attrs.append({
                    "objectTypeAttributeId": aid,
                    "objectAttributeValues": [{"value": value}],
                })

        _attr("Name", name)
        if vcpu is not None:
            _attr("vCPU Count", str(vcpu))
        if vram_gb is not None:
            _attr("vRAM GB", str(vram_gb))
        if cluster_jira_id:
            _attr("Cluster", cluster_jira_id)
        if fqdn:
            _attr("FQDN", fqdn)

        return await _post(client, "/object/create", {
            "objectTypeId": settings.jira_vm_type_id,
            "attributes": attrs,
        })


_ACTIVE_STATUS_ID = "1018"      # Jira ID of "Active" CI Status object
_MEDIUM_CRITICALITY_ID = "1026"  # Jira ID of "3-Medium" CI Criticality object
_HIGH_CRITICALITY_ID = "1025"   # Jira ID of "2-High" CI Criticality object

async def create_physical_server(
    name: str,
    fqdn: str | None = None,
    cpu_count: int | None = None,
    cpu_cores: int | None = None,
    ram_gb: int | None = None,
    manufacturer: str | None = None,
    model: str | None = None,
    serial_number: str | None = None,
    primary_ip: str | None = None,
    cpu_model: str | None = None,
    os_jira_id: str | None = None,
    bios_version: str | None = None,
    nic_count: int | None = None,
) -> dict:
    """Create a Physical Server object in Jira CMDB.

    Mandatory Jira fields: Name, Asset Tag, Manufacturer, Model, Form Factor.
    Status is set to Active (Jira ID 1018).
    cpu_count = CPU sockets; cpu_cores = cores per socket.
    os_jira_id = Jira ID of OS reference object (type 92).
    """
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_physical_server_type_id)

        attrs = []

        def _attr(attr_name: str, value: str) -> None:
            aid = attr_map.get(attr_name)
            if aid:
                attrs.append({
                    "objectTypeAttributeId": aid,
                    "objectAttributeValues": [{"value": value}],
                })

        _attr("Name", name)
        _attr("Asset Tag", serial_number or fqdn or name)
        _attr("Manufacturer", manufacturer or "Unknown")
        _attr("Model", model or "Unknown")
        _attr("Form Factor", "Rack")
        _attr("Status", _ACTIVE_STATUS_ID)
        if fqdn:
            _attr("FQDN", fqdn)
        if serial_number:
            _attr("Serial Number", serial_number)
        if cpu_count is not None:
            _attr("CPU Count", str(cpu_count))
        if cpu_cores is not None:
            _attr("CPU Cores", str(cpu_cores))
        if ram_gb is not None:
            _attr("RAM GB", str(ram_gb))
        if primary_ip:
            _attr("Primary IP", primary_ip)
        if cpu_model:
            _attr("CPU Model", cpu_model)
        if os_jira_id:
            _attr("OS", os_jira_id)
        if bios_version:
            _attr("BIOS Version", bios_version)
        if nic_count is not None:
            _attr("NIC Count", str(nic_count))

        return await _post(client, "/object/create", {
            "objectTypeId": settings.jira_physical_server_type_id,
            "attributes": attrs,
        })


async def update_vm(
    jira_id: str,
    vcpu: int | None = None,
    vram_gb: int | None = None,
    cluster_jira_id: str | None = None,
    primary_ip: str | None = None,
    fqdn: str | None = None,
) -> dict:
    """Update VM parameters in Jira CMDB. Only the provided fields are changed."""
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_vm_type_id)

        attrs = []

        def _attr(attr_name: str, value: str) -> None:
            aid = attr_map.get(attr_name)
            if aid:
                attrs.append({
                    "objectTypeAttributeId": aid,
                    "objectAttributeValues": [{"value": value}],
                })

        if vcpu is not None:
            _attr("vCPU Count", str(vcpu))
        if vram_gb is not None:
            _attr("vRAM GB", str(vram_gb))
        if cluster_jira_id is not None:
            _attr("Cluster", cluster_jira_id)
        if primary_ip is not None:
            _attr("Primary IP", primary_ip)
        if fqdn is not None:
            _attr("FQDN", fqdn)

        if not attrs:
            return {}

        return await _put(client, f"/object/{jira_id}", {
            "objectTypeId": settings.jira_vm_type_id,
            "attributes": attrs,
        })


async def update_physical_server(
    jira_id: str,
    primary_ip: str | None = None,
    fqdn: str | None = None,
) -> dict:
    """Update Physical Server fields in Jira CMDB. Only provided fields are changed."""
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_physical_server_type_id)

        attrs = []

        def _attr(attr_name: str, value: str) -> None:
            aid = attr_map.get(attr_name)
            if aid:
                attrs.append({
                    "objectTypeAttributeId": aid,
                    "objectAttributeValues": [{"value": value}],
                })

        if primary_ip is not None:
            _attr("Primary IP", primary_ip)
        if fqdn is not None:
            _attr("FQDN", fqdn)

        if not attrs:
            return {}

        return await _put(client, f"/object/{jira_id}", {
            "objectTypeId": settings.jira_physical_server_type_id,
            "attributes": attrs,
        })


async def create_cluster(
    vcenter_name: str,
    cluster_type: str = "VMware HA/DRS",
    host_count: int | None = None,
    total_cpu_cores: int | None = None,
    total_ram_gb: int | None = None,
    vm_count: int | None = None,
) -> dict:
    """Create a VM Cluster in Jira CMDB from vCenter data.

    Name gets CLR- prefix (convention). FQDN/CNAME = original vCenter name.
    Fills: Name, FQDN, CNAME, Asset Tag, Status, Criticality, Cluster Type,
           Host Count, Total CPU Cores, Total RAM GB, VM Count, HA Enabled, DRS Enabled.
    """
    cmdb_name = f"CLR-{vcenter_name}" if not vcenter_name.upper().startswith("CLR-") else vcenter_name

    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_cluster_type_id)

        attrs = []

        def _attr(attr_name: str, value: str) -> None:
            aid = attr_map.get(attr_name)
            if aid:
                attrs.append({
                    "objectTypeAttributeId": aid,
                    "objectAttributeValues": [{"value": value}],
                })

        _attr("Name",         cmdb_name)
        _attr("FQDN",         vcenter_name)
        _attr("CNAME",        vcenter_name)
        _attr("Asset Tag",    cluster_type)   # convention: cluster type as asset tag
        _attr("Status",       _ACTIVE_STATUS_ID)
        _attr("Criticality",  _MEDIUM_CRITICALITY_ID)
        _attr("Cluster Type", cluster_type)
        _attr("HA Enabled",   "true")
        _attr("DRS Enabled",  "true")
        if host_count is not None:
            _attr("Host Count",       str(host_count))
        if total_cpu_cores is not None:
            _attr("Total CPU Cores",  str(total_cpu_cores))
        if total_ram_gb is not None:
            _attr("Total RAM GB",     str(total_ram_gb))
        if vm_count is not None:
            _attr("VM Count",         str(vm_count))

        return await _post(client, "/object/create", {
            "objectTypeId": settings.jira_cluster_type_id,
            "attributes": attrs,
        })


_HYPERVISOR_PLATFORM_TYPE_ID = 84  # Hypervisor Platform — ESXi/Hyper-V hosts


async def find_hypervisor_platform_by_host_name(host_name: str) -> str | None:
    """Find Hypervisor Platform (type 84) by vCenter host name.

    vCenter uses FQDN like 'ucl-w1-h241.epicentrk.ua'.
    Jira convention: 'ESX-ucl-w1-h241'. Tries name-based and FQDN-based search.
    Returns jira_id or None.
    """
    short = host_name.split(".")[0]  # strip domain
    esx_name = f"ESX-{short}" if not short.upper().startswith("ESX-") else short
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        for iql in (
            f'objectTypeId = {_HYPERVISOR_PLATFORM_TYPE_ID} AND Name = "{esx_name}"',
            f'objectTypeId = {_HYPERVISOR_PLATFORM_TYPE_ID} AND FQDN = "{host_name}"',
            f'objectTypeId = {_HYPERVISOR_PLATFORM_TYPE_ID} AND Name = "{short}"',
        ):
            data = await _get(client, "/iql/objects", params={
                "objectSchemaId": settings.jira_schema_id,
                "iql": iql,
                "resultPerPage": 2,
                "page": 1,
                "includeAttributes": "false",
            })
            entries = data.get("objectEntries", []) if isinstance(data, dict) else []
            if entries:
                return str(entries[0].get("id", ""))
    return None


async def update_cluster_hypervisor_hosts(
    cluster_jira_id: str,
    hypervisor_jira_ids: list[str],
) -> dict:
    """Update a Cluster object: set Hypervisor Hosts references (attr 1598, multi-value).

    Replaces the existing Hypervisor Hosts list with the provided IDs.
    """
    if not hypervisor_jira_ids:
        return {}
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, settings.jira_cluster_type_id)
        aid = attr_map.get("Hypervisor Hosts")
        if not aid:
            log.warning("Cluster type has no 'Hypervisor Hosts' attribute")
            return {}
        return await _put(client, f"/object/{cluster_jira_id}", {
            "objectTypeId": settings.jira_cluster_type_id,
            "attributes": [{
                "objectTypeAttributeId": aid,
                "objectAttributeValues": [{"value": jid} for jid in hypervisor_jira_ids],
            }],
        })


async def update_hypervisor_platform_cluster(
    hypervisor_jira_id: str,
    cluster_jira_id: str,
) -> dict:
    """Set the Cluster reference on a Hypervisor Platform (type 84) object."""
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, _HYPERVISOR_PLATFORM_TYPE_ID)
        aid = attr_map.get("Cluster")
        if not aid:
            log.debug("Hypervisor Platform has no 'Cluster' attribute")
            return {}
        return await _put(client, f"/object/{hypervisor_jira_id}", {
            "objectTypeId": _HYPERVISOR_PLATFORM_TYPE_ID,
            "attributes": [{
                "objectTypeAttributeId": aid,
                "objectAttributeValues": [{"value": cluster_jira_id}],
            }],
        })


async def find_physical_server_by_serial(serial_number: str) -> str | None:
    """Find a Physical Server (type 83) by its Serial Number attribute. Returns jira_id or None."""
    if not serial_number:
        return None
    safe = serial_number.replace('"', '\\"')
    iql = f'objectTypeId = {settings.jira_physical_server_type_id} AND "Serial Number" = "{safe}"'
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        data = await _get(client, "/iql/objects", params={
            "objectSchemaId": settings.jira_schema_id,
            "iql": iql, "resultPerPage": 2, "page": 1, "includeAttributes": "false",
        })
    entries = data.get("objectEntries", []) if isinstance(data, dict) else []
    if entries:
        return str(entries[0].get("id", ""))
    return None


async def link_hypervisor_to_physical_server(hp_jira_id: str, ps_jira_id: str) -> None:
    """Set bidirectional link: HP.Host Server → PS, PS.Hypervisor → HP."""
    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        hp_attrs = await _get_attr_name_to_id(client, _HYPERVISOR_PLATFORM_TYPE_ID)
        ps_attrs = await _get_attr_name_to_id(client, settings.jira_physical_server_type_id)

        host_server_aid = hp_attrs.get("Host Server")
        hypervisor_aid = ps_attrs.get("Hypervisor")

        if host_server_aid:
            await _put(client, f"/object/{hp_jira_id}", {
                "objectTypeId": _HYPERVISOR_PLATFORM_TYPE_ID,
                "attributes": [{"objectTypeAttributeId": host_server_aid,
                                "objectAttributeValues": [{"value": ps_jira_id}]}],
            })
        if hypervisor_aid:
            await _put(client, f"/object/{ps_jira_id}", {
                "objectTypeId": settings.jira_physical_server_type_id,
                "attributes": [{"objectTypeAttributeId": hypervisor_aid,
                                "objectAttributeValues": [{"value": hp_jira_id}]}],
            })


async def create_hypervisor_platform(host: dict, cluster_jira_id: str | None = None) -> dict:
    """Create a Hypervisor Platform (type 84) object from vCenter host data."""
    fqdn: str = host.get("name", "")
    short = fqdn.split(".")[0]
    esx_name = f"ESX-{short}" if not short.upper().startswith("ESX-") else short
    asset_tag = f"EPT-HVP-{short.upper()}"
    os_version: str = host.get("os_version") or "VMware ESXi"

    # Find Physical Server in CMDB by serial number before creating
    ps_jira_id: str | None = None
    if host.get("serial_number"):
        ps_jira_id = await find_physical_server_by_serial(host["serial_number"])
        if ps_jira_id:
            log.info("Found Physical Server jira_id=%s for host '%s' (serial=%s)",
                     ps_jira_id, esx_name, host["serial_number"])

    async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
        attr_map = await _get_attr_name_to_id(client, _HYPERVISOR_PLATFORM_TYPE_ID)
        attrs: list[dict] = []

        def _attr(name: str, value: str) -> None:
            aid = attr_map.get(name)
            if aid:
                attrs.append({"objectTypeAttributeId": aid, "objectAttributeValues": [{"value": value}]})

        _attr("Name",            esx_name)
        _attr("FQDN",            fqdn)
        _attr("CNAME",           short)
        _attr("Asset Tag",       asset_tag)
        _attr("Status",          _ACTIVE_STATUS_ID)
        _attr("Criticality",     _HIGH_CRITICALITY_ID)
        _attr("Hypervisor Type", "VMware ESXi")
        _attr("Version",         os_version)

        if host.get("management_ip"):
            _attr("Management IP", host["management_ip"])
        if host.get("vendor"):
            _attr("Vendor", host["vendor"])
        if host.get("model"):
            _attr("Model", host["model"])
        if host.get("serial_number"):
            _attr("Serial Number", host["serial_number"])
        if host.get("num_cpu_cores"):
            _attr("CPU Cores", str(host["num_cpu_cores"]))
        if host.get("memory_gb"):
            _attr("RAM GB", str(int(host["memory_gb"])))
        if cluster_jira_id:
            _attr("Cluster", cluster_jira_id)
        if ps_jira_id:
            _attr("Host Server", ps_jira_id)

        log.info("Creating Hypervisor Platform: %s (cluster_jira_id=%s, ps_jira_id=%s)",
                 esx_name, cluster_jira_id, ps_jira_id)
        result = await _post(client, "/object/create", {
            "objectTypeId": _HYPERVISOR_PLATFORM_TYPE_ID,
            "attributes": attrs,
        })

    # Set reverse link on Physical Server: PS.Hypervisor → new HP
    new_hp_id = str(result.get("id", ""))
    if ps_jira_id and new_hp_id:
        try:
            async with httpx.AsyncClient(verify=settings.ssl_verify) as client:
                ps_attrs = await _get_attr_name_to_id(client, settings.jira_physical_server_type_id)
                hypervisor_aid = ps_attrs.get("Hypervisor")
                if hypervisor_aid:
                    await _put(client, f"/object/{ps_jira_id}", {
                        "objectTypeId": settings.jira_physical_server_type_id,
                        "attributes": [{"objectTypeAttributeId": hypervisor_aid,
                                        "objectAttributeValues": [{"value": new_hp_id}]}],
                    })
                    log.info("Linked Physical Server jira_id=%s → Hypervisor Platform jira_id=%s",
                             ps_jira_id, new_hp_id)
        except Exception:
            log.exception("Failed to set Hypervisor on Physical Server jira_id=%s", ps_jira_id)

    return result
