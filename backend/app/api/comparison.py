from fastapi import APIRouter, HTTPException
from app.models.schemas import ComparisonResponse
from app.services import jira_client, zabbix_client, analyzer

router = APIRouter(tags=["comparison"])


@router.get("/comparison", response_model=ComparisonResponse)
async def get_comparison():
    """Compare VMs in Jira CMDB with hosts in Zabbix monitoring."""
    try:
        vms, hosts = await _fetch_both()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return analyzer.build_comparison(vms, hosts)


async def _fetch_both():
    import asyncio
    return await asyncio.gather(
        jira_client.get_all_vms(),
        zabbix_client.get_all_hosts(),
    )
