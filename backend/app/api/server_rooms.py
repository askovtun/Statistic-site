"""Server Rooms: CMDB type 126 linked to Sites."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import ServerRoomItem, ServerRoomsResponse
from app.services import jira_client, response_cache

router = APIRouter(tags=["cmdb"])

_CACHE_TTL = 3600


@router.get("/cmdb/server-rooms", response_model=ServerRoomsResponse)
async def get_server_rooms() -> ServerRoomsResponse:
    """Server Room objects from Jira CMDB with linked Site."""
    cached = response_cache.get("cmdb-server-rooms", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    raw = await jira_client.get_server_rooms()
    rooms = sorted(
        [ServerRoomItem(**d) for d in raw],
        key=lambda r: (r.site or "я", r.name),
    )

    result = ServerRoomsResponse(
        server_rooms=rooms,
        total=len(rooms),
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )
    response_cache.put("cmdb-server-rooms", result)
    return result
