import logging
from datetime import date, timedelta

import httpx
from fastapi import APIRouter, Query

from app.config import settings
from app.services import response_cache

router = APIRouter(tags=["jira-ci-links"])
log = logging.getLogger(__name__)

_CACHE_TTL = 300
_CI_FIELD = "customfield_13400"
_JIRA_BASE = settings.jira_url.rstrip("/")
_HEADERS = {"Accept": "application/json", "X-Atlassian-Token": "no-check"}


async def _fetch_all_issues(days: int) -> list[dict]:
    jql = f"cf[13400] is not EMPTY AND created >= -{days}d ORDER BY created ASC"
    all_issues: list[dict] = []
    start_at = 0

    async with httpx.AsyncClient(verify=settings.ssl_verify, timeout=30) as client:
        while True:
            resp = await client.get(
                f"{_JIRA_BASE}/rest/api/2/search",
                headers=_HEADERS,
                auth=(settings.jira_user, settings.jira_password),
                params={
                    "jql": jql,
                    "startAt": start_at,
                    "maxResults": 100,
                    "fields": f"summary,assignee,created,project,{_CI_FIELD}",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            issues = data.get("issues", [])
            all_issues.extend(issues)
            total = data.get("total", 0)
            start_at += len(issues)
            if start_at >= total or not issues:
                break

    return all_issues


def _aggregate(issues: list[dict], days: int) -> dict:
    today = date.today()
    cutoff = today - timedelta(days=days)

    date_map: dict[str, dict] = {}
    cur = cutoff
    while cur <= today:
        date_map[cur.isoformat()] = {
            "date": cur.isoformat(),
            "issues_created": 0,
            "ci_count": 0,
            "cumulative": 0,
        }
        cur += timedelta(days=1)

    total_issues = 0
    total_ci_count = 0
    by_assignee: dict[str, dict] = {}
    by_project: dict[str, dict] = {}
    issue_rows: list[dict] = []

    for issue in issues:
        f = issue.get("fields", {})
        ci_list = f.get(_CI_FIELD) or []
        if not isinstance(ci_list, list):
            ci_list = [ci_list] if ci_list else []
        ci_count = len(ci_list)
        if not ci_count:
            continue

        created_raw = (f.get("created") or "")[:10]
        assignee_obj = f.get("assignee") or {}
        assignee = assignee_obj.get("displayName") or assignee_obj.get("name") or "Невідомо"
        project = (f.get("project") or {}).get("key", "?")
        summary = f.get("summary") or ""

        total_issues += 1
        total_ci_count += ci_count

        if created_raw in date_map:
            date_map[created_raw]["issues_created"] += 1
            date_map[created_raw]["ci_count"] += ci_count

        if assignee not in by_assignee:
            by_assignee[assignee] = {
                "name": assignee,
                "issues": 0,
                "ci_count": 0,
                "last_activity": "",
            }
        by_assignee[assignee]["issues"] += 1
        by_assignee[assignee]["ci_count"] += ci_count
        if created_raw > by_assignee[assignee]["last_activity"]:
            by_assignee[assignee]["last_activity"] = created_raw

        if project not in by_project:
            by_project[project] = {"project": project, "issues": 0, "ci_count": 0}
        by_project[project]["issues"] += 1
        by_project[project]["ci_count"] += ci_count

        issue_rows.append({
            "key": issue.get("key", ""),
            "summary": summary,
            "assignee": assignee,
            "project": project,
            "created": created_raw,
            "ci_items": ci_list,
            "ci_count": ci_count,
        })

    running = 0
    by_date = list(date_map.values())
    for d in by_date:
        running += d["issues_created"]
        d["cumulative"] = running

    return {
        "total_issues": total_issues,
        "total_ci_count": total_ci_count,
        "active_specialists": len(by_assignee),
        "by_date": by_date,
        "by_assignee": sorted(by_assignee.values(), key=lambda x: x["ci_count"], reverse=True),
        "by_project": sorted(by_project.values(), key=lambda x: x["issues"], reverse=True),
        "issues": sorted(issue_rows, key=lambda x: x["created"], reverse=True),
        "jira_url": _JIRA_BASE,
    }


@router.get("/jira-ci-links")
async def get_jira_ci_links(days: int = Query(default=180, ge=7, le=730)):
    cache_key = f"jira-ci-links-{days}"
    cached = response_cache.get(cache_key, ttl=_CACHE_TTL)
    if cached is not None:
        return cached

    issues = await _fetch_all_issues(days)
    result = _aggregate(issues, days)

    response_cache.put(cache_key, result)
    return result
