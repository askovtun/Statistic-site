from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import PhysicalServerResponse, ResourceHistoryResponse
from app.services import analyzer, db, metrics_store, response_cache
from app.services.sync_service import PERIODS

router = APIRouter(tags=["physical-servers"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."
_CACHE_TTL  = 300


@router.get("/physical-servers", response_model=PhysicalServerResponse)
async def get_physical_servers(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    cache_key = f"physical-servers:{period_days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    servers_cached = db.get("physical_servers")
    hostid_map_cached = db.get("phys_hostid_map")
    if servers_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    servers, updated_at = servers_cached
    phys_hostid_map = hostid_map_cached[0] if hostid_map_cached else {}

    matched_hostid_map = {
        srv["name"]: phys_hostid_map[srv["name"]]
        for srv in servers if srv.get("name") in phys_hostid_map
    }

    metrics = metrics_store.get_period_metrics_batch(matched_hostid_map, period_days)

    response = analyzer.build_physical_servers(servers, metrics)
    response.synced_at = updated_at

    response_cache.put(cache_key, response)
    return response


@router.get("/physical-servers/{name}/history", response_model=ResourceHistoryResponse)
async def get_physical_server_history(
    name: str,
    period_days: int = Query(default=7, description=f"Період: {PERIODS}"),
):
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    hostid_map_cached = db.get("phys_hostid_map")
    if hostid_map_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    phys_hostid_map, _ = hostid_map_cached
    hostid = phys_hostid_map.get(name)
    if hostid is None:
        raise HTTPException(status_code=404, detail="Сервер не знайдено або немає метрик Zabbix")

    points = metrics_store.get_history(hostid, period_days)
    return ResourceHistoryResponse(name=name, points=points)
