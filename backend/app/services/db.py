"""Tiny local cache: SQLite key/value store for fetched CMDB/Zabbix data.

Avoids re-fetching from Jira/Zabbix on every API request — data is written
here by sync_service.sync_all() and read by the API routers.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache.db"


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache ("
        "key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )

    # Migrate metric_hourly to the multi-source schema (adds `source` to the
    # PK). Existing rows predate vCenter and are all Zabbix data, so they are
    # copied across tagged as such — avoids re-triggering a full backfill for
    # every already-synced host.
    _metric_hourly_ddl = (
        "CREATE TABLE IF NOT EXISTS metric_hourly ("
        "source TEXT NOT NULL DEFAULT 'zabbix', hostid TEXT NOT NULL, metric TEXT NOT NULL, "
        "hour_clock INTEGER NOT NULL, avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, "
        "num REAL NOT NULL, "
        "PRIMARY KEY (source, hostid, metric, hour_clock))"
    )
    cols = [r[1] for r in conn.execute("PRAGMA table_info(metric_hourly)").fetchall()]
    if cols and "source" not in cols:
        conn.execute("ALTER TABLE metric_hourly RENAME TO metric_hourly_old")
        conn.execute(_metric_hourly_ddl)
        conn.execute(
            "INSERT INTO metric_hourly (source, hostid, metric, hour_clock, avg, min, max, num) "
            "SELECT 'zabbix', hostid, metric, hour_clock, avg, min, max, num FROM metric_hourly_old"
        )
        conn.execute("DROP TABLE metric_hourly_old")
    else:
        conn.execute(_metric_hourly_ddl)

    return conn


def get(key: str) -> tuple[Any, str] | None:
    """Return (value, updated_at) for key, or None if not cached."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM cache WHERE key = ?", (key,)
        ).fetchone()
    if row is None:
        return None
    return json.loads(row[0]), row[1]


def set(key: str, value: Any) -> str:
    """Store value under key, return the updated_at timestamp used."""
    updated_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO cache (key, payload, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            (key, json.dumps(value), updated_at),
        )
        conn.commit()
    return updated_at
