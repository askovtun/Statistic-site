"""Integration smoke test for /api/security-dashboard aggregation logic.

Verifies the key invariant: known OS brand without version → no_version_items,
truly unknown OS → unknown_os_items, EOL OS → eol_items.
"""
from unittest.mock import patch


def _vm(name, os_family=None, cluster=None):
    return {"name": name, "os_family": os_family, "cluster": cluster,
            "fqdn": None, "primary_ip": None}


def _make_db(vms, phys=None):
    ts = "2024-01-01T00:00:00"
    return {
        "vms":              (vms,          ts),
        "physical_servers": (phys or [],   ts),
        "vm_hostid_map":    ({},           ts),
        "phys_hostid_map":  ({},           ts),
        "vcenter_vms":      ([],           ts),
        "vm_moid_map":      ({},           ts),
    }


def test_os_bucketing(client):
    """EOL / no_version / unknown buckets are populated correctly."""
    vms = [
        _vm("win2003",      "Windows Server 2003 (64-bit)"),  # → eol_items
        _vm("ubuntu-g",     "Ubuntu Linux (64-bit)"),          # → no_version_items
        _vm("centos-noVer", "CentOS 6 (64-bit)"),              # → eol_items (CentOS 6 is EOL)
        _vm("other-linux",  "Other Linux (64-bit)"),            # → unknown_os_items
        _vm("no-os"),                                           # os_family=None → unknown_os_items
    ]
    db_data = _make_db(vms)

    with patch("app.services.db.get",             side_effect=lambda k: db_data.get(k)), \
         patch("app.services.response_cache.get", return_value=None), \
         patch("app.services.response_cache.put"):
        r = client.get("/api/security-dashboard")

    assert r.status_code == 200
    d = r.json()

    eol_names     = {i["name"] for i in d["eol_items"]}
    nover_names   = {i["name"] for i in d["no_version_items"]}
    unknown_names = {i["name"] for i in d["unknown_os_items"]}

    assert "win2003"      in eol_names,     "WS2003 must be in eol_items"
    assert "centos-noVer" in eol_names,     "CentOS 6 (EOL) must be in eol_items"
    assert "ubuntu-g"     in nover_names,   "Ubuntu generic must be in no_version_items"
    assert "other-linux"  in unknown_names, "Other Linux must be in unknown_os_items"
    assert "no-os"        in unknown_names, "Null OS must be in unknown_os_items"

    # No item may appear in more than one bucket
    all_names = list(eol_names) + list(nover_names) + list(unknown_names)
    assert len(all_names) == len(set(all_names)), "Items must not appear in multiple buckets"


def test_counts_match_items(client):
    """*_count fields must equal len(*_items)."""
    vms = [_vm(f"vm-{i}", "Ubuntu Linux (64-bit)") for i in range(5)]
    db_data = _make_db(vms)

    with patch("app.services.db.get",             side_effect=lambda k: db_data.get(k)), \
         patch("app.services.response_cache.get", return_value=None), \
         patch("app.services.response_cache.put"):
        d = client.get("/api/security-dashboard").json()

    assert d["no_version_count"]  == len(d["no_version_items"])
    assert d["unknown_os_count"]  == len(d["unknown_os_items"])
    assert d["eol_count"]         == len(d["eol_items"])
    assert d["ending_soon_count"] == len(d["ending_soon_items"])


def test_unmonitored_vms(client):
    """VMs not in vm_hostid_map appear in unmonitored_vms."""
    vms = [_vm("monitored-vm"), _vm("ghost-vm")]
    db_data = _make_db(vms)
    db_data["vm_hostid_map"] = ({"monitored-vm": "10001"}, "2024-01-01T00:00:00")

    with patch("app.services.db.get",             side_effect=lambda k: db_data.get(k)), \
         patch("app.services.response_cache.get", return_value=None), \
         patch("app.services.response_cache.put"):
        d = client.get("/api/security-dashboard").json()

    unmon_names = {i["name"] for i in d["unmonitored_vms"]}
    assert "ghost-vm" in unmon_names
    assert "monitored-vm" not in unmon_names
    assert d["unmonitored_vm_count"] == len(d["unmonitored_vms"])


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
