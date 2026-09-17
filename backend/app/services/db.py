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

# In-memory mirror of the JSON KV store — avoids re-opening SQLite and
# re-parsing JSON on every db.get() call. Populated lazily on first read;
# updated synchronously on db.set(); survives process lifetime.
_mem_cache: dict[str, tuple[Any, str]] = {}


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

    # CMDB change tracking: daily aggregated stats per CI type
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cmdb_daily_stats ("
        "date TEXT NOT NULL, "
        "ci_type TEXT NOT NULL, "
        "added INTEGER NOT NULL DEFAULT 0, "
        "updated INTEGER NOT NULL DEFAULT 0, "
        "removed INTEGER NOT NULL DEFAULT 0, "
        "total INTEGER NOT NULL DEFAULT 0, "
        "PRIMARY KEY (date, ci_type))"
    )

    # CMDB snapshot: last-known state per CI (used to compute diffs)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cmdb_ci_snapshot ("
        "ci_type TEXT NOT NULL, "
        "ci_id TEXT NOT NULL, "
        "ci_name TEXT NOT NULL, "
        "jira_updated TEXT, "
        "PRIMARY KEY (ci_type, ci_id))"
    )

    # Daily monitoring coverage snapshot (Zabbix coverage of CMDB inventory)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS monitoring_coverage_history ("
        "date TEXT PRIMARY KEY, "
        "vm_total INTEGER NOT NULL DEFAULT 0, "
        "vm_monitored INTEGER NOT NULL DEFAULT 0, "
        "phys_total INTEGER NOT NULL DEFAULT 0, "
        "phys_monitored INTEGER NOT NULL DEFAULT 0)"
    )

    # VM configuration snapshot (last known state — compared on each metadata sync)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vm_config_snapshot ("
        "name TEXT PRIMARY KEY, "
        "vcpu INTEGER, "
        "vram_gb INTEGER, "
        "cluster TEXT, "
        "status TEXT, "
        "os_family TEXT, "
        "seen_at INTEGER NOT NULL)"
    )

    # VM configuration change log (diff between consecutive syncs)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vm_config_changes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "change_type TEXT NOT NULL, "
        "old_value TEXT, "
        "new_value TEXT, "
        "detected_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_vm_cfg_changes_at "
        "ON vm_config_changes(detected_at DESC)"
    )

    # Covering index for time-range batch queries: allows SQLite to filter by
    # (source, hour_clock) first — helps the IN-list batch queries in metrics_store.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_metric_hourly_src_time "
        "ON metric_hourly(source, hour_clock)"
    )

    return conn


def get(key: str) -> tuple[Any, str] | None:
    """Return (value, updated_at) for key, or None if not cached."""
    if key in _mem_cache:
        return _mem_cache[key]
    with _connect() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM cache WHERE key = ?", (key,)
        ).fetchone()
    if row is None:
        return None
    result: tuple[Any, str] = (json.loads(row[0]), row[1])
    _mem_cache[key] = result
    return result


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
    _mem_cache[key] = (value, updated_at)
    return updated_at
