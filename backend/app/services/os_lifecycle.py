"""OS lifecycle database and matching logic.

Maps Jira CMDB OS names (from VMware guest-OS identification) to lifecycle entries
with EOL dates. OS names in CMDB have prefix "OS-", e.g. "OS-Windows Server 2019 (64-bit)".
"""
from __future__ import annotations

import re
from datetime import date
from typing import TypedDict

_TODAY = date.today()
_WARN_DAYS = 365  # "ending soon" threshold


class OsEntry(TypedDict):
    vendor: str
    product: str
    eol_date: str | None  # ISO date, None = no EOL announced


# fmt: off
_LIFECYCLE: dict[str, OsEntry] = {
    # ── Windows Server ────────────────────────────────────────────────────────
    "ws_2003":   {"vendor": "Microsoft", "product": "Windows Server 2003",    "eol_date": "2015-07-14"},
    "ws_2008":   {"vendor": "Microsoft", "product": "Windows Server 2008",    "eol_date": "2020-01-14"},
    "ws_2008r2": {"vendor": "Microsoft", "product": "Windows Server 2008 R2", "eol_date": "2020-01-14"},
    "ws_2012":   {"vendor": "Microsoft", "product": "Windows Server 2012",    "eol_date": "2023-10-10"},
    "ws_2012r2": {"vendor": "Microsoft", "product": "Windows Server 2012 R2", "eol_date": "2023-10-10"},
    "ws_2016":   {"vendor": "Microsoft", "product": "Windows Server 2016",    "eol_date": "2027-01-12"},
    "ws_2019":   {"vendor": "Microsoft", "product": "Windows Server 2019",    "eol_date": "2029-01-09"},
    "ws_2022":   {"vendor": "Microsoft", "product": "Windows Server 2022",    "eol_date": "2031-10-14"},
    "ws_2025":   {"vendor": "Microsoft", "product": "Windows Server 2025",    "eol_date": "2034-10-10"},
    # ── Windows Desktop ───────────────────────────────────────────────────────
    "win_10":    {"vendor": "Microsoft", "product": "Windows 10",             "eol_date": "2025-10-14"},
    "win_11":    {"vendor": "Microsoft", "product": "Windows 11",             "eol_date": "2031-10-14"},
    "win_7":     {"vendor": "Microsoft", "product": "Windows 7",              "eol_date": "2020-01-14"},
    "win_8":     {"vendor": "Microsoft", "product": "Windows 8.1",            "eol_date": "2023-01-10"},
    # ── Ubuntu ────────────────────────────────────────────────────────────────
    "ubuntu_1404": {"vendor": "Canonical", "product": "Ubuntu 14.04 LTS (Trusty)", "eol_date": "2019-04-25"},
    "ubuntu_1604": {"vendor": "Canonical", "product": "Ubuntu 16.04 LTS (Xenial)", "eol_date": "2021-04-30"},
    "ubuntu_1804": {"vendor": "Canonical", "product": "Ubuntu 18.04 LTS (Bionic)", "eol_date": "2023-04-30"},
    "ubuntu_2004": {"vendor": "Canonical", "product": "Ubuntu 20.04 LTS (Focal)",  "eol_date": "2025-04-02"},
    "ubuntu_2204": {"vendor": "Canonical", "product": "Ubuntu 22.04 LTS (Jammy)",  "eol_date": "2027-04-01"},
    "ubuntu_2404": {"vendor": "Canonical", "product": "Ubuntu 24.04 LTS (Noble)",  "eol_date": "2029-04-25"},
    # ── CentOS ────────────────────────────────────────────────────────────────
    "centos_6":  {"vendor": "CentOS Project", "product": "CentOS 6",         "eol_date": "2020-11-30"},
    "centos_7":  {"vendor": "CentOS Project", "product": "CentOS 7",         "eol_date": "2024-06-30"},
    "centos_8":  {"vendor": "CentOS Project", "product": "CentOS 8",         "eol_date": "2021-12-31"},
    "centos_s8": {"vendor": "CentOS Project", "product": "CentOS Stream 8",  "eol_date": "2024-05-31"},
    "centos_s9": {"vendor": "CentOS Project", "product": "CentOS Stream 9",  "eol_date": "2027-05-31"},
    "centos_s10":{"vendor": "CentOS Project", "product": "CentOS Stream 10", "eol_date": "2030-05-31"},
    # ── Red Hat Enterprise Linux ──────────────────────────────────────────────
    "rhel_7":    {"vendor": "Red Hat", "product": "RHEL 7",                  "eol_date": "2024-06-30"},
    "rhel_8":    {"vendor": "Red Hat", "product": "RHEL 8",                  "eol_date": "2029-05-31"},
    "rhel_9":    {"vendor": "Red Hat", "product": "RHEL 9",                  "eol_date": "2032-05-31"},
    # ── Debian ────────────────────────────────────────────────────────────────
    "debian_9":  {"vendor": "Debian",  "product": "Debian 9 (Stretch)",      "eol_date": "2022-06-30"},
    "debian_10": {"vendor": "Debian",  "product": "Debian 10 (Buster)",      "eol_date": "2024-06-30"},
    "debian_11": {"vendor": "Debian",  "product": "Debian 11 (Bullseye)",    "eol_date": "2026-08-15"},
    "debian_12": {"vendor": "Debian",  "product": "Debian 12 (Bookworm)",    "eol_date": "2028-06-10"},
    # ── FreeBSD ───────────────────────────────────────────────────────────────
    "freebsd_12":{"vendor": "FreeBSD", "product": "FreeBSD 12",              "eol_date": "2023-12-31"},
    "freebsd_13":{"vendor": "FreeBSD", "product": "FreeBSD 13",              "eol_date": "2026-01-31"},
    "freebsd_14":{"vendor": "FreeBSD", "product": "FreeBSD 14",              "eol_date": "2028-11-30"},
    # ── VMware Photon OS ──────────────────────────────────────────────────────
    "photon_3":  {"vendor": "VMware",  "product": "VMware Photon OS 3.0",    "eol_date": "2023-06-20"},
    "photon_4":  {"vendor": "VMware",  "product": "VMware Photon OS 4.0",    "eol_date": "2025-03-20"},
    "photon_5":  {"vendor": "VMware",  "product": "VMware Photon OS 5.0",    "eol_date": "2028-03-20"},
    # ── SUSE Linux Enterprise ─────────────────────────────────────────────────
    "sles_12":   {"vendor": "SUSE",    "product": "SUSE Linux Enterprise 12","eol_date": "2024-10-31"},
    "sles_15":   {"vendor": "SUSE",    "product": "SUSE Linux Enterprise 15","eol_date": "2031-07-31"},
    # ── Oracle Linux ──────────────────────────────────────────────────────────
    "ol_7":      {"vendor": "Oracle",  "product": "Oracle Linux 7",          "eol_date": "2024-12-31"},
    "ol_8":      {"vendor": "Oracle",  "product": "Oracle Linux 8",          "eol_date": "2029-07-31"},
    "ol_9":      {"vendor": "Oracle",  "product": "Oracle Linux 9",          "eol_date": "2032-06-30"},
    # ── RHEL-compatible (Rocky / Alma) ────────────────────────────────────────
    "rocky_8":   {"vendor": "Rocky Linux", "product": "Rocky Linux 8",       "eol_date": "2029-05-31"},
    "rocky_9":   {"vendor": "Rocky Linux", "product": "Rocky Linux 9",       "eol_date": "2032-05-31"},
    "alma_8":    {"vendor": "AlmaLinux",   "product": "AlmaLinux 8",         "eol_date": "2029-05-31"},
    "alma_9":    {"vendor": "AlmaLinux",   "product": "AlmaLinux 9",         "eol_date": "2032-05-31"},
}
# fmt: on


_KNOWN_BRANDS = (
    "ubuntu", "centos", "red hat", "rhel", "debian", "freebsd",
    "photon", "suse", "sles", "oracle linux", "rocky", "almalinux", "alma linux",
)


def is_known_brand(os_raw: str | None) -> bool:
    """True if os_raw contains a recognizable OS brand (but version may be unknown)."""
    if not os_raw:
        return False
    n = os_raw.lower().removeprefix("os-").strip()
    return any(brand in n for brand in _KNOWN_BRANDS)


def _ver(name: str, v: str) -> bool:
    """True if version token v appears as a standalone word/token in name."""
    return bool(re.search(rf"(?<!\d){re.escape(v)}(?!\d)", name))


def match_os(os_raw: str | None) -> OsEntry | None:
    """Match a raw OS name to a lifecycle entry. Returns None if unknown.

    Handles names from multiple sources:
    - vCenter guest (VMware Tools): "CentOS Linux 7 (Core)", "Microsoft Windows Server 2019 (64-bit)",
      "Red Hat Enterprise Linux 8.6 (Ootpa)", "Ubuntu 20.04.6 LTS"
    - vCenter config file: "CentOS 7 (64-bit)", "Ubuntu Linux (64-bit)"
    - Jira CMDB (imported from vmx): "OS-Ubuntu Linux (64-bit)", "OS-Windows Server 2019 (64-bit)"
    """
    if not os_raw:
        return None
    # Strip CMDB prefix (OS objects are named "OS-<name>")
    name = os_raw.removeprefix("OS-").strip()
    n = name.lower()

    # ── Windows Server ────────────────────────────────────────────────────────
    if "windows server" in n:
        if "2025" in n:                          return _LIFECYCLE["ws_2025"]
        if "2022" in n:                          return _LIFECYCLE["ws_2022"]
        if "2019" in n:                          return _LIFECYCLE["ws_2019"]
        if "2016" in n:                          return _LIFECYCLE["ws_2016"]
        if "2012" in n and "r2" in n:            return _LIFECYCLE["ws_2012r2"]
        if "2012" in n:                          return _LIFECYCLE["ws_2012"]
        if "2008" in n and "r2" in n:            return _LIFECYCLE["ws_2008r2"]
        if "2008" in n:                          return _LIFECYCLE["ws_2008"]
        if "2003" in n:                          return _LIFECYCLE["ws_2003"]
        return None

    # ── Windows Desktop ───────────────────────────────────────────────────────
    if "windows 11" in n:                        return _LIFECYCLE["win_11"]
    if "windows 10" in n:                        return _LIFECYCLE["win_10"]
    if "windows 8" in n:                         return _LIFECYCLE["win_8"]
    if "windows 7" in n:                         return _LIFECYCLE["win_7"]

    # ── Ubuntu ────────────────────────────────────────────────────────────────
    # Handles both:
    #   "Ubuntu Linux (64-bit)"         → no version, unknown
    #   "Ubuntu 20.04.6 LTS"            → 20.04 (from newer VMware Tools)
    #   "Ubuntu 20.04 LTS"              → 20.04
    if "ubuntu" in n:
        if "24.04" in n:                         return _LIFECYCLE["ubuntu_2404"]
        if "22.04" in n:                         return _LIFECYCLE["ubuntu_2204"]
        if "20.04" in n:                         return _LIFECYCLE["ubuntu_2004"]
        if "18.04" in n:                         return _LIFECYCLE["ubuntu_1804"]
        if "16.04" in n:                         return _LIFECYCLE["ubuntu_1604"]
        if "14.04" in n:                         return _LIFECYCLE["ubuntu_1404"]
        return None  # generic "Ubuntu Linux (64-bit)" without version → unknown

    # ── CentOS ────────────────────────────────────────────────────────────────
    # Handles:
    #   "CentOS 7 (64-bit)"           (config)
    #   "CentOS Linux 7 (Core)"       (guest tools)
    #   "CentOS Stream 9"
    if "centos" in n:
        if "stream" in n:
            if _ver(n, "10"):                    return _LIFECYCLE["centos_s10"]
            if _ver(n, "9"):                     return _LIFECYCLE["centos_s9"]
            if _ver(n, "8"):                     return _LIFECYCLE["centos_s8"]
        if _ver(n, "8"):                         return _LIFECYCLE["centos_8"]
        if _ver(n, "7"):                         return _LIFECYCLE["centos_7"]
        if _ver(n, "6"):                         return _LIFECYCLE["centos_6"]
        return None

    # ── Red Hat Enterprise Linux ──────────────────────────────────────────────
    # Handles:
    #   "Red Hat Enterprise Linux 8 (64-bit)"       (config)
    #   "Red Hat Enterprise Linux 8.6 (Ootpa)"      (guest tools, minor version)
    #   "Red Hat Enterprise Linux Server 7.9 (...)" (guest tools, older format)
    if "red hat" in n or "rhel" in n:
        if _ver(n, "9"):                         return _LIFECYCLE["rhel_9"]
        if _ver(n, "8"):                         return _LIFECYCLE["rhel_8"]
        if _ver(n, "7"):                         return _LIFECYCLE["rhel_7"]
        return None

    # ── Debian ────────────────────────────────────────────────────────────────
    # Handles:
    #   "Debian GNU/Linux 11 (64-bit)"   (config)
    #   "Debian GNU/Linux 11 (bullseye)" (guest tools)
    if "debian" in n:
        if "bookworm" in n or _ver(n, "12"):     return _LIFECYCLE["debian_12"]
        if "bullseye" in n or _ver(n, "11"):     return _LIFECYCLE["debian_11"]
        if "buster"   in n or _ver(n, "10"):     return _LIFECYCLE["debian_10"]
        if "stretch"  in n or _ver(n, "9"):      return _LIFECYCLE["debian_9"]
        return None

    # ── FreeBSD ───────────────────────────────────────────────────────────────
    if "freebsd" in n:
        if _ver(n, "14"):                        return _LIFECYCLE["freebsd_14"]
        if _ver(n, "13"):                        return _LIFECYCLE["freebsd_13"]
        if _ver(n, "12"):                        return _LIFECYCLE["freebsd_12"]
        return None

    # ── VMware Photon ─────────────────────────────────────────────────────────
    if "photon" in n:
        if _ver(n, "5"):                         return _LIFECYCLE["photon_5"]
        if _ver(n, "4"):                         return _LIFECYCLE["photon_4"]
        if _ver(n, "3"):                         return _LIFECYCLE["photon_3"]
        return None

    # ── SUSE ──────────────────────────────────────────────────────────────────
    # Handles:
    #   "SUSE Linux Enterprise 15 (64-bit)" (config/guest)
    if "suse" in n or "sles" in n:
        if _ver(n, "15"):                        return _LIFECYCLE["sles_15"]
        if _ver(n, "12"):                        return _LIFECYCLE["sles_12"]
        return None

    # ── Oracle Linux ──────────────────────────────────────────────────────────
    if "oracle linux" in n:
        if _ver(n, "9"):                         return _LIFECYCLE["ol_9"]
        if _ver(n, "8"):                         return _LIFECYCLE["ol_8"]
        if _ver(n, "7"):                         return _LIFECYCLE["ol_7"]
        return None

    # ── Rocky / AlmaLinux ─────────────────────────────────────────────────────
    if "rocky" in n:
        if _ver(n, "9"):                         return _LIFECYCLE["rocky_9"]
        if _ver(n, "8"):                         return _LIFECYCLE["rocky_8"]
        return None
    if "almalinux" in n or "alma linux" in n:
        if _ver(n, "9"):                         return _LIFECYCLE["alma_9"]
        if _ver(n, "8"):                         return _LIFECYCLE["alma_8"]
        return None

    return None


def get_status(entry: OsEntry | None) -> tuple[str, int | None]:
    """Returns (status, days_until_eol).
    Status values: supported | ending_soon | eol | unknown
    days_until_eol: negative means already past EOL.
    """
    if entry is None:
        return ("unknown", None)
    eol_str = entry.get("eol_date")
    if not eol_str:
        return ("supported", None)
    eol = date.fromisoformat(eol_str)
    delta = (eol - _TODAY).days
    if delta < 0:
        return ("eol", delta)
    if delta <= _WARN_DAYS:
        return ("ending_soon", delta)
    return ("supported", delta)
