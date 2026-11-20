"""Applications & IT Services: CMDB inventory from Jira types 94 and 110."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import AppItem, ApplicationsResponse
from app.services import jira_client, response_cache

router = APIRouter(tags=["cmdb"])

_CACHE_TTL = 3600


@router.get("/cmdb/applications", response_model=ApplicationsResponse)
async def get_applications() -> ApplicationsResponse:
    """Application and IT Service objects from Jira CMDB."""
    cached = response_cache.get("cmdb-applications", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    apps_raw, services_raw = await asyncio.gather(
        jira_client.get_applications(),
        jira_client.get_it_services(),
    )

    apps = [AppItem(**d) for d in apps_raw]
    services = [AppItem(**d) for d in services_raw]

    result = ApplicationsResponse(
        applications=sorted(apps, key=lambda a: a.name),
        it_services=sorted(services, key=lambda s: s.name),
        total_apps=len(apps),
        total_services=len(services),
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("cmdb-applications", result)
    return result
