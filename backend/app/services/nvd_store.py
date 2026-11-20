"""
NVD CVE lookup service — searches local SQLite DB by OS string.

Usage:
    from app.services.nvd_store import get_db_stats, search_cves_for_os

The SQLite DB is created by download_nvd.py and lives at backend/nvd.db.
"""

from __future__ import annotations

import asyncio
import re
import sqlite3
from pathlib import Path
from typing import Callable, Optional

import httpx

NVD_DB_PATH = Path(__file__).parent.parent.parent / "nvd.db"

# OS name regex → list of CPE vendor:product tokens to search
# Each token is used in a separate LIKE '%token%' query on the cpe_keywords column.
OS_SEARCH_PATTERNS: list[tuple[str, list[str]]] = [
    (r"windows\s*server\s*2022",      ["microsoft:windows_server_2022"]),
    (r"windows\s*server\s*2019",      ["microsoft:windows_server_2019"]),
    (r"windows\s*server\s*2016",      ["microsoft:windows_server_2016"]),
    (r"windows\s*server\s*2012\s*r2", ["microsoft:windows_server_2012_r2"]),
    (r"windows\s*server\s*2012",      ["microsoft:windows_server_2012"]),
    (r"windows\s*server\s*2008\s*r2", ["microsoft:windows_server_2008_r2"]),
    (r"windows\s*server\s*2008",      ["microsoft:windows_server_2008"]),
    (r"windows\s*server\s*2003",      ["microsoft:windows_server_2003"]),
    (r"windows\s*11",                 ["microsoft:windows_11"]),
    (r"windows\s*10",                 ["microsoft:windows_10"]),
    (r"windows\s*7",                  ["microsoft:windows_7"]),
    (r"ubuntu.*22\.04",               ["canonical:ubuntu_linux"]),
    (r"ubuntu.*20\.04",               ["canonical:ubuntu_linux"]),
    (r"ubuntu.*18\.04",               ["canonical:ubuntu_linux"]),
    (r"ubuntu.*16\.04",               ["canonical:ubuntu_linux"]),
    (r"ubuntu",                       ["canonical:ubuntu_linux"]),
    (r"debian.*12",                   ["debian:debian_linux"]),
    (r"debian.*11",                   ["debian:debian_linux"]),
    (r"debian.*10",                   ["debian:debian_linux"]),
    (r"debian",                       ["debian:debian_linux"]),
    (r"centos\s*stream\s*9",          ["centos:centos"]),
    (r"centos\s*stream\s*8",          ["centos:centos"]),
    (r"centos\s*7",                   ["centos:centos"]),
    (r"centos\s*8",                   ["centos:centos"]),
    (r"centos",                       ["centos:centos"]),
    (r"red\s*hat.*9|rhel.*9",         ["redhat:enterprise_linux"]),
    (r"red\s*hat.*8|rhel.*8",         ["redhat:enterprise_linux"]),
    (r"red\s*hat.*7|rhel.*7",         ["redhat:enterprise_linux"]),
    (r"red\s*hat|rhel",               ["redhat:enterprise_linux"]),
    (r"oracle\s*linux\s*9",           ["oracle:linux"]),
    (r"oracle\s*linux\s*8",           ["oracle:linux"]),
    (r"oracle\s*linux\s*7",           ["oracle:linux"]),
    (r"oracle\s*linux",               ["oracle:linux"]),
    (r"suse.*15|sles.*15",            ["suse:suse_linux_enterprise_server"]),
    (r"suse.*12|sles.*12",            ["suse:suse_linux_enterprise_server"]),
    (r"opensuse",                     ["opensuse:opensuse"]),
    (r"freebsd\s*1[3-9]",             ["freebsd:freebsd"]),
    (r"freebsd\s*12",                 ["freebsd:freebsd"]),
    (r"freebsd",                      ["freebsd:freebsd"]),
    (r"vmware\s*esxi\s*8",            ["vmware:esxi"]),
    (r"vmware\s*esxi\s*7",            ["vmware:esxi"]),
    (r"vmware\s*esxi\s*6",            ["vmware:esxi"]),
    (r"esxi",                         ["vmware:esxi"]),
]

_MAX_RESULTS = 200


def _get_conn() -> sqlite3.Connection:
    if not NVD_DB_PATH.exists():
        raise FileNotFoundError(
            f"NVD database not found: {NVD_DB_PATH}. "
            "Run: python download_nvd.py"
        )
    conn = sqlite3.connect(str(NVD_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_db_stats() -> dict:
    """Return basic DB stats: total CVEs, last update timestamp, is_ready."""
    if not NVD_DB_PATH.exists():
        return {
            "is_ready": False,
            "db_path": str(NVD_DB_PATH),
            "total_cves": 0,
            "last_updated": None,
            "severity_counts": {},
        }
    try:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) FROM cves").fetchone()[0]
        by_sev = conn.execute(
            "SELECT cvss_severity, COUNT(*) FROM cves GROUP BY cvss_severity"
        ).fetchall()
        last_updated = conn.execute(
            "SELECT value FROM meta WHERE key='last_updated'"
        ).fetchone()
        conn.close()
        return {
            "is_ready": total > 0,
            "db_path": str(NVD_DB_PATH),
            "total_cves": total,
            "last_updated": last_updated[0] if last_updated else None,
            "severity_counts": {(r[0] or "N/A"): r[1] for r in by_sev},
        }
    except Exception as e:
        return {"is_ready": False, "db_path": str(NVD_DB_PATH), "error": str(e)}


def _os_to_cpe_tokens(os_string: str) -> list[str]:
    """Map OS string to CPE tokens for DB lookup."""
    if not os_string:
        return []
    os_lower = os_string.lower()
    for pattern, tokens in OS_SEARCH_PATTERNS:
        if re.search(pattern, os_lower):
            return tokens
    return []


def search_cves_for_os(
    os_string: str,
    min_score: float = 0.0,
    max_results: int = _MAX_RESULTS,
) -> list[dict]:
    """
    Search CVEs matching the given OS string.

    Returns list of CVE dicts sorted by cvss_score DESC.
    Returns empty list if OS is unknown or DB not ready.
    """
    tokens = _os_to_cpe_tokens(os_string)
    if not tokens:
        return []

    try:
        conn = _get_conn()
    except FileNotFoundError:
        return []

    try:
        placeholders = " OR ".join(["cpe_keywords LIKE ?"] * len(tokens))
        like_args = [f"%{t}%" for t in tokens]

        if min_score > 0:
            query = f"""
                SELECT id, published, modified, description,
                       cvss_score, cvss_severity, cvss_vector, attack_vector
                FROM cves
                WHERE ({placeholders}) AND cvss_score >= ?
                ORDER BY cvss_score DESC
                LIMIT ?
            """
            args = like_args + [min_score, max_results]
        else:
            query = f"""
                SELECT id, published, modified, description,
                       cvss_score, cvss_severity, cvss_vector, attack_vector
                FROM cves
                WHERE ({placeholders})
                ORDER BY cvss_score DESC
                LIMIT ?
            """
            args = like_args + [max_results]

        rows = conn.execute(query, args).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def search_cves_batch(
    servers: list[dict],
    min_score: float = 0.0,
) -> list[dict]:
    """
    Scan a list of {name, os_string} dicts.
    Returns list of {server_name, os_string, matched_tokens, cve_count, cves} dicts.
    """
    results = []
    for srv in servers:
        name = srv.get("name", "")
        os_string = srv.get("os_string") or ""
        tokens = _os_to_cpe_tokens(os_string)
        cves = search_cves_for_os(os_string, min_score=min_score)
        results.append({
            "server_name": name,
            "os_string": os_string or None,
            "matched_tokens": tokens,
            "cve_count": len(cves),
            "cves": cves,
        })
    return results


# ── NVD Download (called from API endpoint) ───────────────────────────────────

_NVD_API_URL  = "https://services.nvd.nist.gov/rest/json/cves/2.0"
_NVD_PER_PAGE = 2000
_NVD_SLEEP    = 6.0   # seconds between pages (5 req/30s limit)


def _open_db_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(str(NVD_DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cves (
            id TEXT PRIMARY KEY,
            published TEXT, modified TEXT, description TEXT,
            cvss_score REAL, cvss_severity TEXT, cvss_vector TEXT,
            attack_vector TEXT, cpe_keywords TEXT
        )
    """)
    conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sev   ON cves(cvss_severity)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_score ON cves(cvss_score DESC)")
    conn.commit()
    return conn


def _fetch_page_sync(start: int, pub_start: str | None, pub_end: str | None) -> dict:
    params: dict = {"startIndex": start, "resultsPerPage": _NVD_PER_PAGE}
    if pub_start: params["pubStartDate"] = pub_start
    if pub_end:   params["pubEndDate"]   = pub_end
    r = httpx.get(_NVD_API_URL, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _nvd_extract_cvss(cve: dict):
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        items = cve.get("metrics", {}).get(key, [])
        if not items:
            continue
        m = items[0]
        d = m.get("cvssData", {})
        score = d.get("baseScore")
        sev   = (m.get("baseSeverity") or d.get("baseSeverity") or "").upper() or None
        vec   = d.get("vectorString")
        av_r  = d.get("attackVector") or d.get("accessVector") or ""
        av    = av_r.upper().replace("_", " ") if av_r else None
        return score, sev, vec, av
    return None, None, None, None


def _nvd_extract_cpe(cve: dict) -> str:
    tokens: set[str] = set()
    for cfg in cve.get("configurations", []):
        for node in cfg.get("nodes", []):
            for m in node.get("cpeMatch", []):
                parts = m.get("criteria", "").split(":")
                if len(parts) >= 5:
                    v, p = parts[3].lower(), parts[4].lower()
                    if v and v != "*":
                        tokens.add(f"{v}:{p}")
    return " ".join(sorted(tokens))


def _nvd_parse_item(item: dict) -> dict:
    cve  = item.get("cve", {})
    desc = next((d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"), "")
    score, sev, vec, av = _nvd_extract_cvss(cve)
    return {
        "id":           cve.get("id", ""),
        "published":    cve.get("published", ""),
        "modified":     cve.get("lastModified", ""),
        "description":  desc,
        "cvss_score":   score,
        "cvss_severity": sev,
        "cvss_vector":  vec,
        "attack_vector": av,
        "cpe_keywords": _nvd_extract_cpe(cve),
    }


def _upsert_batch(conn: sqlite3.Connection, rows: list[dict]) -> int:
    conn.executemany("""INSERT OR REPLACE INTO cves
        (id, published, modified, description, cvss_score, cvss_severity,
         cvss_vector, attack_vector, cpe_keywords)
        VALUES (:id, :published, :modified, :description, :cvss_score,
                :cvss_severity, :cvss_vector, :attack_vector, :cpe_keywords)
    """, rows)
    conn.commit()
    return len(rows)


async def run_nvd_download(
    mode: str = "update",
    days: int  = 30,
    on_progress: Callable[[dict], None] | None = None,
) -> dict:
    """
    Download/update NVD CVEs into local SQLite.
    mode: 'update' (last N days) | 'full' (all CVEs).
    Calls on_progress(dict) after each page.
    """
    from datetime import datetime, timezone, timedelta

    conn = _open_db_rw()

    if mode == "update":
        now       = datetime.now(timezone.utc)
        pub_start = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000")
        pub_end   = now.strftime("%Y-%m-%dT%H:%M:%S.000")
    else:
        pub_start = pub_end = None

    api_start       = 0
    total_results: int | None = None
    total_inserted  = 0
    page_num        = 0

    def _notify(extra: str = ""):
        if on_progress:
            total_pages = (
                max(1, (total_results + _NVD_PER_PAGE - 1) // _NVD_PER_PAGE)
                if total_results else None
            )
            on_progress({
                "page":          page_num,
                "total_pages":   total_pages,
                "cves_done":     total_inserted,
                "total_results": total_results,
                "message":       extra,
            })

    try:
        while True:
            page_num += 1
            _notify(f"Завантаження сторінки {page_num}…")

            try:
                data = await asyncio.to_thread(_fetch_page_sync, api_start, pub_start, pub_end)
            except Exception as e:
                _notify(f"Помилка — повтор через 15с: {e}")
                await asyncio.sleep(15)
                data = await asyncio.to_thread(_fetch_page_sync, api_start, pub_start, pub_end)

            if total_results is None:
                total_results = data.get("totalResults", 0)

            vulns = data.get("vulnerabilities", [])
            if not vulns:
                break

            rows           = [_nvd_parse_item(v) for v in vulns]
            total_inserted += await asyncio.to_thread(_upsert_batch, conn, rows)
            api_start      += len(vulns)

            _notify()

            if api_start >= (total_results or 0):
                break

            await asyncio.sleep(_NVD_SLEEP)

        now_str = datetime.now(timezone.utc).isoformat()
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_updated', ?)", (now_str,))
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_mode', ?)",    (mode,))
        conn.commit()

        return {"total_inserted": total_inserted, "total_results": total_results, "pages": page_num}

    finally:
        conn.close()
