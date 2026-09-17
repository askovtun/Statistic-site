from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import zabbix_client
from app.services import response_cache

router = APIRouter(tags=["network"])


class ChannelIface(BaseModel):
    ifname: str
    itemid_in: str
    itemid_out: str | None = None
    last_in: float | None = None
    last_out: float | None = None
    lastclock: int | None = None


class ChannelHost(BaseModel):
    hostid: str
    name: str
    interfaces: list[ChannelIface]


class ChannelHostsResponse(BaseModel):
    hosts: list[ChannelHost]
    fetched_at: str


class ChannelPoint(BaseModel):
    clock: int
    in_bps: float | None = None
    out_bps: float | None = None


class ChannelHistoryResponse(BaseModel):
    hostid: str
    ifname: str
    points: list[ChannelPoint]
    fetched_at: str


@router.get("/network/channels/hosts", response_model=ChannelHostsResponse)
async def get_channel_hosts():
    """Return all Zabbix hosts that have net.if.in items (network devices)."""
    cache_key = "network:channel_hosts"
    cached = response_cache.get(cache_key, ttl=120)
    if cached:
        return cached

    now_str = datetime.now(timezone.utc).isoformat()
    try:
        raw = await zabbix_client.get_channel_hosts()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Zabbix error: {exc}") from exc

    hosts = [
        ChannelHost(
            hostid=h["hostid"],
            name=h["name"],
            interfaces=[
                ChannelIface(
                    ifname=iface["ifname"],
                    itemid_in=iface["itemid_in"],
                    itemid_out=iface.get("itemid_out"),
                    last_in=iface.get("last_in"),
                    last_out=iface.get("last_out"),
                    lastclock=iface.get("lastclock"),
                )
                for iface in h.get("interfaces", [])
            ],
        )
        for h in raw
    ]
    result = ChannelHostsResponse(hosts=hosts, fetched_at=now_str)
    response_cache.put(cache_key, result)
    return result


@router.get("/network/channels/history", response_model=ChannelHistoryResponse)
async def get_channel_history(
    hostid: str = Query(...),
    ifname: str = Query(...),
    itemid_in: str = Query(...),
    itemid_out: str | None = Query(None),
    hours: int = Query(24, ge=1, le=168),
):
    """Return time-series for one network interface over the last N hours."""
    now = int(datetime.now(timezone.utc).timestamp())
    time_from = now - hours * 3600
    now_str = datetime.now(timezone.utc).isoformat()

    try:
        raw = await zabbix_client.get_channel_history(itemid_in, itemid_out, time_from, now)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Zabbix error: {exc}") from exc

    points = [
        ChannelPoint(clock=p["clock"], in_bps=p.get("in"), out_bps=p.get("out"))
        for p in raw
    ]
    return ChannelHistoryResponse(
        hostid=hostid, ifname=ifname, points=points, fetched_at=now_str
    )
