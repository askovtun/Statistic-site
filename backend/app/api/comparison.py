from fastapi import APIRouter, HTTPException
from app.models.schemas import ComparisonResponse
from app.services import analyzer, db

router = APIRouter(tags=["comparison"])

_NOT_SYNCED = "Дані ще не синхронізовано. Натисніть «Оновити дані»."


@router.get("/comparison", response_model=ComparisonResponse)
async def get_comparison():
    """Compare VMs in Jira CMDB with hosts in Zabbix monitoring (from local cache)."""
    vms_cached = db.get("vms")
    hosts_cached = db.get("zabbix_hosts")
    if vms_cached is None or hosts_cached is None:
        raise HTTPException(status_code=503, detail=_NOT_SYNCED)

    vms, _ = vms_cached
    zabbix_hosts, updated_at = hosts_cached
    response = analyzer.build_comparison(vms, zabbix_hosts)
    response.synced_at = updated_at
    return response
