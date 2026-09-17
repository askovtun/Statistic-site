"""Smoke tests for os_lifecycle — the most critical pure logic in the codebase."""
import pytest
from app.services.os_lifecycle import get_status, is_known_brand, match_os


# ── match_os ──────────────────────────────────────────────────────────────────

class TestMatchOs:
    # Windows
    def test_windows_server_2019_cmdb_prefix(self):
        e = match_os("OS-Windows Server 2019 (64-bit)")
        assert e is not None and e["eol_date"] == "2029-01-09"

    def test_windows_server_2012r2(self):
        e = match_os("Microsoft Windows Server 2012 R2 (64-bit)")
        assert e is not None and "2012 R2" in e["product"]

    def test_windows_server_2003_eol(self):
        e = match_os("Windows Server 2003 (64-bit)")
        assert e is not None and e["eol_date"] == "2015-07-14"

    # Ubuntu — with version (VMware Tools)
    def test_ubuntu_2004_tools(self):
        e = match_os("Ubuntu 20.04.6 LTS")
        assert e is not None and e["eol_date"] == "2025-04-02"

    def test_ubuntu_2204(self):
        e = match_os("Ubuntu 22.04 LTS")
        assert e is not None and "22.04" in e["product"]

    def test_ubuntu_2404(self):
        e = match_os("Ubuntu 24.04.1 LTS")
        assert e is not None and "24.04" in e["product"]

    # Ubuntu — without version (config file / generic CMDB)
    def test_ubuntu_generic_returns_none(self):
        assert match_os("Ubuntu Linux (64-bit)") is None

    def test_ubuntu_cmdb_prefix_no_version(self):
        assert match_os("OS-Ubuntu Linux (64-bit)") is None

    # CentOS
    def test_centos7_guest_tools(self):
        e = match_os("CentOS Linux 7 (Core)")
        assert e is not None and e["eol_date"] == "2024-06-30"

    def test_centos_stream9(self):
        e = match_os("CentOS Stream 9")
        assert e is not None and "Stream 9" in e["product"]

    # RHEL
    def test_rhel8_with_minor(self):
        e = match_os("Red Hat Enterprise Linux 8.6 (Ootpa)")
        assert e is not None and "RHEL 8" in e["product"]

    # Debian
    def test_debian11_codename(self):
        e = match_os("Debian GNU/Linux 11 (bullseye)")
        assert e is not None and "Bullseye" in e["product"]

    def test_debian12_bookworm(self):
        e = match_os("Debian GNU/Linux 12 (bookworm)")
        assert e is not None and "Bookworm" in e["product"]

    # Edge cases
    def test_none_returns_none(self):
        assert match_os(None) is None

    def test_empty_returns_none(self):
        assert match_os("") is None

    def test_other_linux_returns_none(self):
        assert match_os("Other Linux (64-bit)") is None

    def test_other_linux_3x_returns_none(self):
        assert match_os("Other 3.x Linux (64-bit)") is None


# ── get_status ────────────────────────────────────────────────────────────────

class TestGetStatus:
    def test_none_entry_is_unknown(self):
        status, days = get_status(None)
        assert status == "unknown" and days is None

    def test_ws2003_is_eol(self):
        status, days = get_status(match_os("Windows Server 2003"))
        assert status == "eol" and days is not None and days < 0

    def test_ws2025_is_supported(self):
        status, _ = get_status(match_os("Windows Server 2025"))
        assert status == "supported"

    def test_ws2016_status(self):
        # EOL 2027-01-12 — could be ending_soon or supported depending on today
        status, _ = get_status(match_os("Windows Server 2016"))
        assert status in ("supported", "ending_soon")


# ── is_known_brand ────────────────────────────────────────────────────────────

class TestIsKnownBrand:
    @pytest.mark.parametrize("s", [
        "Ubuntu Linux (64-bit)",
        "OS-Ubuntu Linux (64-bit)",
        "CentOS 6 (64-bit)",
        "Red Hat Enterprise Linux 9 (64-bit)",
        "FreeBSD Pre-11 versions (64-bit)",
        "SUSE Linux Enterprise 12 (64-bit)",
        "Oracle Linux 7 (64-bit)",
        "Rocky Linux 8 (64-bit)",
        "AlmaLinux 9 (64-bit)",
    ])
    def test_known_brands(self, s):
        assert is_known_brand(s) is True

    @pytest.mark.parametrize("s,expected", [
        ("Other Linux (64-bit)", False),
        ("Other 3.x or later Linux (64-bit)", False),
        (None, False),
        ("", False),
        ("VMware ESXi 8", False),
    ])
    def test_unknown_or_null(self, s, expected):
        assert is_known_brand(s) is expected
