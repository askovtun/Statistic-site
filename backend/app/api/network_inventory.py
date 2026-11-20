"""Network Inventory by Location: Router/Switch/Firewall/AP from CMDB grouped by site."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import NetworkDeviceItem, NetworkInventoryResponse
from app.services import jira_client, response_cache

router = APIRouter(tags=["cmdb"])

_CACHE_TTL = 3600


@router.get("/cmdb/network", response_model=NetworkInventoryResponse)
async def get_network_inventory() -> NetworkInventoryResponse:
    """Network devices (Router/Switch/Firewall/AP) from Jira CMDB grouped by location."""
    cached = response_cache.get("cmdb-network", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    raw = await jira_client.get_network_devices()
    devices = [NetworkDeviceItem(**d) for d in raw]

    by_type: dict[str, int] = {}
    by_location: dict[str, int] = {}
    for d in devices:
        by_type[d.device_type] = by_type.get(d.device_type, 0) + 1
        loc = d.location or "—"
        by_location[loc] = by_location.get(loc, 0) + 1

    result = NetworkInventoryResponse(
        devices=sorted(devices, key=lambda d: (d.location or "я", d.device_type, d.name)),
        by_type=by_type,
        by_location=dict(sorted(by_location.items(), key=lambda x: -x[1])),
        total=len(devices),
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("cmdb-network", result)
    return result
