from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import PhysicalServerResponse, ResourceHistoryResponse
from app.services import analyzer, db, metrics_store
from app.services.sync_service import PERIODS

router = APIRouter(tags=["physical-servers"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."


@router.get("/physical-servers", response_model=PhysicalServerResponse)
async def get_physical_servers(
    period_days: int = Query(default=30, description=f"Період аналізу: {PERIODS}"),
):
    """Physical server list with Zabbix CPU/RAM metrics where available."""
    if period_days not in PERIODS:
        raise HTTPException(status_code=400, detail=f"period_days має бути одним з {PERIODS}")

    servers_cached = db.get("physical_servers")
    hostid_map_cached = db.get("phys_hostid_map")
    if servers_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    servers, updated_at = servers_cached
    phys_hostid_map = hostid_map_cached[0] if hostid_map_cached else {}

    metrics = {
        srv["name"]: metrics_store.get_period_metrics(phys_hostid_map[srv["name"]], period_days)
        for srv in servers
        if srv.get("name") in phys_hostid_map
    }

    response = analyzer.build_physical_servers(servers, metrics)
    response.synced_at = updated_at
    return response


@router.get("/physical-servers/{name}/history", response_model=ResourceHistoryResponse)
async def get_physical_server_history(
    name: str,
    period_days: int = Query(default=7, description=f"Період: {PERIODS}"),
):
    """Hourly CPU/RAM history for a single physical server (Zabbix only)."""
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
