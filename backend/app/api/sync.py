import asyncio

from fastapi import APIRouter

from app.services import sync_service

router = APIRouter(tags=["sync"])


@router.post("/sync")
async def trigger_sync():
    """Kick off a background refresh of CMDB/Zabbix data into the local cache."""
    if sync_service.is_in_progress():
        return {"status": "already_running"}
    asyncio.create_task(sync_service.sync_all())
    return {"status": "started"}


@router.get("/sync/status")
async def sync_status():
    return {
        "in_progress": sync_service.is_in_progress(),
        "synced_at": sync_service.get_synced_at(),
    }
