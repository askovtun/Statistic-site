"""
Download CVEs from NVD API v2.0 and index into local SQLite database.

Usage:
  python download_nvd.py              # full download (all CVEs)
  python download_nvd.py --update     # incremental (last 30 days)
  python download_nvd.py --stats      # show DB statistics
  python download_nvd.py --db path    # custom DB path (default: nvd.db)

Rate limit: 5 req/30s without API key → 6s sleep between requests.
Total CVEs: ~250K, 2000 per page → ~125 requests → ~12-13 minutes.
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
PAGE_SIZE = 2000
SLEEP_BETWEEN = 6.0  # seconds, stays under 5 req/30s


def open_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cves (
            id             TEXT PRIMARY KEY,
            published      TEXT,
            modified       TEXT,
            description    TEXT,
            cvss_score     REAL,
            cvss_severity  TEXT,
            cvss_vector    TEXT,
            attack_vector  TEXT,
            cpe_keywords   TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cve_severity ON cves(cvss_severity)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cve_score    ON cves(cvss_score DESC)")
    conn.commit()
    return conn


def _extract_cvss(vuln: dict) -> tuple[float | None, str | None, str | None, str | None]:
    """Return (score, severity, vector, attack_vector) preferring CVSS v3 > v2."""
    metrics = vuln.get("metrics", {})
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        items = metrics.get(key, [])
        if not items:
            continue
        m = items[0]
        data = m.get("cvssData", {})
        score = data.get("baseScore")
        severity = (m.get("baseSeverity") or data.get("baseSeverity") or "").upper() or None
        vector = data.get("vectorString")
        av_raw = data.get("attackVector") or data.get("accessVector") or ""
        av = av_raw.upper().replace("_", " ") if av_raw else None
        return score, severity, vector, av
    return None, None, None, None


def _extract_cpe_keywords(vuln: dict) -> str:
    """Extract CPE vendor:product tokens for LIKE-based search."""
    tokens: set[str] = set()
    configs = vuln.get("configurations", [])
    for cfg in configs:
        for node in cfg.get("nodes", []):
            for match in node.get("cpeMatch", []):
                cpe = match.get("criteria", "")
                parts = cpe.split(":")
                # cpe:2.3:a:vendor:product:version:...
                if len(parts) >= 5:
                    vendor = parts[3].lower()
                    product = parts[4].lower()
                    if vendor and vendor != "*":
                        tokens.add(f"{vendor}:{product}")
    return " ".join(sorted(tokens))


def parse_cve(item: dict) -> dict:
    cve = item.get("cve", {})
    cve_id = cve.get("id", "")
    published = cve.get("published", "")
    modified = cve.get("lastModified", "")

    descs = cve.get("descriptions", [])
    description = next((d["value"] for d in descs if d.get("lang") == "en"), "")

    score, severity, vector, av = _extract_cvss(cve)
    cpe_keywords = _extract_cpe_keywords(cve)

    return {
        "id": cve_id,
        "published": published,
        "modified": modified,
        "description": description,
        "cvss_score": score,
        "cvss_severity": severity,
        "cvss_vector": vector,
        "attack_vector": av,
        "cpe_keywords": cpe_keywords,
    }


def fetch_page(start: int, pub_start: str | None = None, pub_end: str | None = None) -> dict:
    params: dict = {"startIndex": start, "resultsPerPage": PAGE_SIZE}
    if pub_start:
        params["pubStartDate"] = pub_start
    if pub_end:
        params["pubEndDate"] = pub_end
    resp = httpx.get(NVD_URL, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()


def upsert_batch(conn: sqlite3.Connection, rows: list[dict]) -> int:
    conn.executemany(
        """INSERT OR REPLACE INTO cves
           (id, published, modified, description, cvss_score, cvss_severity, cvss_vector, attack_vector, cpe_keywords)
           VALUES (:id, :published, :modified, :description, :cvss_score, :cvss_severity, :cvss_vector, :attack_vector, :cpe_keywords)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def download_all(conn: sqlite3.Connection, pub_start: str | None = None, pub_end: str | None = None):
    start = 0
    total = None
    inserted = 0
    page_num = 0

    while True:
        page_num += 1
        log.info("Page %d | startIndex=%d | fetching...", page_num, start)
        try:
            data = fetch_page(start, pub_start, pub_end)
        except Exception as e:
            log.error("Fetch error: %s — retrying in 15s", e)
            time.sleep(15)
            data = fetch_page(start, pub_start, pub_end)

        if total is None:
            total = data.get("totalResults", 0)
            log.info("Total CVEs to download: %d", total)

        vulns = data.get("vulnerabilities", [])
        if not vulns:
            break

        rows = [parse_cve(v) for v in vulns]
        inserted += upsert_batch(conn, rows)
        log.info("  → %d inserted/updated (total so far: %d / %d)", len(rows), inserted, total)

        start += len(vulns)
        if start >= total:
            break

        time.sleep(SLEEP_BETWEEN)

    return inserted


def show_stats(conn: sqlite3.Connection):
    total = conn.execute("SELECT COUNT(*) FROM cves").fetchone()[0]
    by_sev = conn.execute(
        "SELECT cvss_severity, COUNT(*) FROM cves GROUP BY cvss_severity ORDER BY COUNT(*) DESC"
    ).fetchall()
    last_updated = conn.execute("SELECT value FROM meta WHERE key='last_updated'").fetchone()
    last_mode    = conn.execute("SELECT value FROM meta WHERE key='last_mode'").fetchone()

    print(f"\n{'='*50}")
    print(f"  NVD Database: {total:,} CVEs total")
    print(f"  Last update:  {last_updated[0] if last_updated else '—'}")
    print(f"  Last mode:    {last_mode[0] if last_mode else '—'}")
    print(f"  By severity:")
    for sev, cnt in by_sev:
        print(f"    {(sev or 'N/A'):15s}: {cnt:,}")
    print(f"{'='*50}\n")


def main():
    parser = argparse.ArgumentParser(description="Download NVD CVEs to SQLite")
    parser.add_argument("--update", action="store_true", help="Incremental: last 30 days only")
    parser.add_argument("--stats",  action="store_true", help="Show DB stats and exit")
    parser.add_argument("--days",   type=int, default=30, help="Days back for --update (default: 30)")
    parser.add_argument("--db",     default=str(Path(__file__).parent / "nvd.db"), help="SQLite DB path")
    args = parser.parse_args()

    conn = open_db(args.db)

    if args.stats:
        show_stats(conn)
        conn.close()
        return

    if args.update:
        now = datetime.now(timezone.utc)
        pub_start = (now - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%S.000")
        pub_end   = now.strftime("%Y-%m-%dT%H:%M:%S.000")
        log.info("Incremental update: %s → %s", pub_start, pub_end)
        mode = f"update-{args.days}d"
    else:
        pub_start = pub_end = None
        existing = conn.execute("SELECT COUNT(*) FROM cves").fetchone()[0]
        if existing > 0:
            log.info("DB already has %d CVEs. Use --update for incremental. Continuing...", existing)
        mode = "full"

    log.info("Starting NVD download [mode=%s] → %s", mode, args.db)
    t0 = time.time()
    inserted = download_all(conn, pub_start, pub_end)
    elapsed = time.time() - t0

    now_str = datetime.now(timezone.utc).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_updated', ?)", (now_str,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_mode', ?)", (mode,))
    conn.commit()

    log.info("Done! %d CVEs inserted/updated in %.1fs", inserted, elapsed)
    show_stats(conn)
    conn.close()


if __name__ == "__main__":
    main()
