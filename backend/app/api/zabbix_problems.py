from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Query

from app.models.schemas import (
    ZabbixHostProblems,
    ZabbixProblemItem,
    ZabbixProblemsResponse,
)
from app.services import zabbix_client

router = APIRouter(tags=["zabbix"])

_SEV_FIELDS = {5: "disaster", 4: "high", 3: "average", 2: "warning", 1: "information", 0: "not_classified"}


def _build_response(raw: list[dict], fetched_at: str) -> ZabbixProblemsResponse:
    host_map: dict[str, dict] = {}

    for p in raw:
        hosts = p.get("hosts") or []
        if not hosts:
            continue

        last_event = p.get("lastEvent") or {}
        problem = ZabbixProblemItem(
            event_id=p["triggerid"],
            name=p.get("description", ""),
            severity=int(p.get("priority", 0)),
            clock=int(p.get("lastchange", 0)),
            acknowledged=last_event.get("acknowledged") == "1",
            suppressed=p.get("suppressed") == "1",
            tags=[
                {"tag": t.get("tag", ""), "value": t.get("value", "")}
                for t in (p.get("tags") or [])
            ],
        )

        for h in hosts:
            hid = h["hostid"]
            if hid not in host_map:
                host_map[hid] = {
                    "hostid": hid,
                    "host_name": h.get("name", h.get("host", hid)),
                    "host_technical": h.get("host", ""),
                    "problems": [],
                }
            host_map[hid]["problems"].append(problem)

    host_items: list[ZabbixHostProblems] = []
    totals: dict[str, int] = {f: 0 for f in _SEV_FIELDS.values()}

    for meta in host_map.values():
        problems: list[ZabbixProblemItem] = meta["problems"]
        counts: dict[str, int] = {f: 0 for f in _SEV_FIELDS.values()}
        max_sev = 0
        latest = None

        for pr in problems:
            field = _SEV_FIELDS.get(pr.severity, "not_classified")
            counts[field] += 1
            totals[field] += 1
            if pr.severity > max_sev:
                max_sev = pr.severity
            if latest is None or pr.clock > latest:
                latest = pr.clock

        host_items.append(ZabbixHostProblems(
            hostid=meta["hostid"],
            host_name=meta["host_name"],
            host_technical=meta["host_technical"],
            problems=sorted(problems, key=lambda x: (-x.severity, -x.clock)),
            total=len(problems),
            max_severity=max_sev,
            latest_clock=latest,
            **counts,
        ))

    host_items.sort(key=lambda x: (-x.max_severity, -x.total))

    return ZabbixProblemsResponse(
        total_problems=len(raw),
        total_hosts=len(host_items),
        fetched_at=fetched_at,
        hosts=host_items,
        **totals,
    )


@router.get("/zabbix/problems", response_model=ZabbixProblemsResponse)
async def get_zabbix_problems(
    date_from: date | None = Query(None, description="Period start (YYYY-MM-DD). Omit for live active problems."),
    date_till: date | None = Query(None, description="Period end (YYYY-MM-DD, inclusive)."),
):
    """Fetch Zabbix problems grouped by host.

    Without date_from/date_till: returns currently active problems (live).
    With date range: returns all problem events that started in that window.
    """
    now_str = datetime.now(timezone.utc).isoformat()

    if date_from is not None:
        # Historical mode
        ts_from = int(datetime.combine(date_from, time.min, tzinfo=timezone.utc).timestamp())
        end_date = date_till if date_till is not None else date_from
        ts_till = int(datetime.combine(end_date, time.max, tzinfo=timezone.utc).timestamp())
        raw = await zabbix_client.get_problems_history(ts_from, ts_till)
    else:
        # Live active problems
        raw = await zabbix_client.get_problems()

    return _build_response(raw, now_str)
