from fastapi import APIRouter, HTTPException
from app.models.schemas import ComparisonResponse
from app.services import analyzer, db, response_cache

router = APIRouter(tags=["comparison"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."
_CACHE_TTL  = 300


@router.get("/comparison", response_model=ComparisonResponse)
async def get_comparison():
    """Compare VMs in Jira CMDB with hosts in Zabbix monitoring (from local cache)."""
    cached = response_cache.get("comparison", ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    vms_cached = db.get("vms")
    hosts_cached = db.get("zabbix_hosts")
    if vms_cached is None or hosts_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, _ = vms_cached
    zabbix_hosts, updated_at = hosts_cached
    phys_cached = db.get("physical_servers")
    physical_servers = phys_cached[0] if phys_cached else []
    response = analyzer.build_comparison(vms, zabbix_hosts, physical_servers)
    response.synced_at = updated_at
    response_cache.put("comparison", response)
    return response
