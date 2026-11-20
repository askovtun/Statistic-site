import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  api,
  type VulnServerItem,
  type ScanServerResult,
  type CveItem,
  type NvdUpdateStatus,
} from "../api/client";

// ── OS grouping ───────────────────────────────────────────────────────────────

type OsGroupKey =
  | "windows" | "ubuntu" | "centos_rhel" | "debian"
  | "oracle" | "suse" | "freebsd" | "esxi" | "linux_other" | "unknown";

const OS_GROUP_META: Record<OsGroupKey, { label: string; icon: string; order: number }> = {
  windows:     { label: "Windows Server", icon: "🪟", order: 0 },
  ubuntu:      { label: "Ubuntu",          icon: "🟠", order: 1 },
  centos_rhel: { label: "CentOS / RHEL",   icon: "🎩", order: 2 },
  debian:      { label: "Debian",           icon: "🌀", order: 3 },
  oracle:      { label: "Oracle Linux",     icon: "🔴", order: 4 },
  suse:        { label: "SUSE / SLES",      icon: "🦎", order: 5 },
  freebsd:     { label: "FreeBSD",          icon: "😈", order: 6 },
  esxi:        { label: "ESXi / VMware",    icon: "☁️",  order: 7 },
  linux_other: { label: "Інший Linux",      icon: "🐧", order: 8 },
  unknown:     { label: "Невідомо",         icon: "❓", order: 9 },
};

const OS_GROUP_ORDER = (Object.keys(OS_GROUP_META) as OsGroupKey[])
  .sort((a, b) => OS_GROUP_META[a].order - OS_GROUP_META[b].order);

function getOsGroup(osString: string | null): OsGroupKey {
  if (!osString) return "unknown";
  const os = osString.toLowerCase();
  if (os.includes("windows")) return "windows";
  if (os.includes("ubuntu")) return "ubuntu";
  if (os.includes("centos") || os.includes("red hat") || os.includes("rhel")
    || os.includes("alma") || os.includes("rocky")) return "centos_rhel";
  if (os.includes("debian")) return "debian";
  if (os.includes("oracle linux") || os.includes("oracle enterprise")) return "oracle";
  if (os.includes("suse") || os.includes("sles") || os.includes("opensuse")) return "suse";
  if (os.includes("freebsd")) return "freebsd";
  if (os.includes("esxi") || os.includes("vmware")) return "esxi";
  if (os.includes("linux")) return "linux_other";
  return "unknown";
}

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sevColor(sev: string | null): string {
  switch ((sev || "").toUpperCase()) {
    case "CRITICAL": return "#dc2626";
    case "HIGH":     return "#ea580c";
    case "MEDIUM":   return "#d97706";
    case "LOW":      return "#65a30d";
    default:         return "#6b7280";
  }
}

function sevBg(sev: string | null): string {
  switch ((sev || "").toUpperCase()) {
    case "CRITICAL": return "bg-red-100 text-red-700";
    case "HIGH":     return "bg-orange-100 text-orange-700";
    case "MEDIUM":   return "bg-amber-100 text-amber-700";
    case "LOW":      return "bg-lime-100 text-lime-700";
    default:         return "bg-gray-100 text-gray-600";
  }
}

function cvssBar(score: number | null) {
  if (score == null) return null;
  const pct = (score / 10) * 100;
  const color = score >= 9 ? "#dc2626" : score >= 7 ? "#ea580c" : score >= 4 ? "#d97706" : "#65a30d";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded overflow-hidden">
        <div style={{ width: `${pct}%`, background: color }} className="h-full rounded" />
      </div>
      <span className="text-xs font-mono font-semibold" style={{ color }}>{score.toFixed(1)}</span>
    </div>
  );
}

function countsBySev(results: ScanServerResult[]) {
  const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NA: 0 };
  for (const r of results)
    for (const c of r.cves) {
      const s = (c.cvss_severity || "").toUpperCase();
      if (s in counts) counts[s]++; else counts["NA"]++;
    }
  return counts;
}

// ── CVE row inside server accordion ──────────────────────────────────────────

function CveRow({ cve }: { cve: CveItem }) {
  const [open, setOpen] = useState(false);
  const sev = (cve.cvss_severity || "").toUpperCase();
  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <td className="py-1.5 px-3">
          <a href={`https://nvd.nist.gov/vuln/detail/${cve.id}`} target="_blank" rel="noopener noreferrer"
            className="text-xs font-mono text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>
            {cve.id}
          </a>
        </td>
        <td className="py-1.5 px-3">{cvssBar(cve.cvss_score)}</td>
        <td className="py-1.5 px-3">
          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${sevBg(cve.cvss_severity)}`}>
            {sev || "N/A"}
          </span>
        </td>
        <td className="py-1.5 px-3 text-xs text-gray-500">{cve.attack_vector ?? "—"}</td>
        <td className="py-1.5 px-3 text-xs text-gray-600 max-w-[380px] truncate">{cve.description}</td>
        <td className="py-1.5 px-3 text-xs text-gray-400 whitespace-nowrap">
          {cve.published ? cve.published.slice(0, 10) : "—"}
        </td>
        <td className="py-1.5 px-3 text-xs text-gray-400">{open ? "▾" : "▸"}</td>
      </tr>
      {open && (
        <tr className="bg-gray-50 border-b border-gray-200">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-gray-700 mb-1">Опис</p>
                <p className="text-gray-600 leading-relaxed">{cve.description}</p>
              </div>
              <div className="space-y-1 text-gray-600">
                <p><span className="font-medium text-gray-700">CVE ID:</span>{" "}
                  <a href={`https://nvd.nist.gov/vuln/detail/${cve.id}`} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline">{cve.id}</a></p>
                <p><span className="font-medium text-gray-700">CVSS Score:</span> {cve.cvss_score?.toFixed(1) ?? "—"}</p>
                <p><span className="font-medium text-gray-700">Severity:</span> {cve.cvss_severity ?? "—"}</p>
                <p><span className="font-medium text-gray-700">Attack Vector:</span> {cve.attack_vector ?? "—"}</p>
                <p><span className="font-medium text-gray-700">Vector:</span>{" "}
                  <span className="font-mono">{cve.cvss_vector ?? "—"}</span></p>
                <p><span className="font-medium text-gray-700">Published:</span> {cve.published?.slice(0, 10) ?? "—"}</p>
                <p><span className="font-medium text-gray-700">Modified:</span> {cve.modified?.slice(0, 10) ?? "—"}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Server result accordion ───────────────────────────────────────────────────

function ServerResultRow({
  result, sevFilter, search, defaultOpen,
}: {
  result: ScanServerResult;
  sevFilter: SevFilter;
  search: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const visibleCves = useMemo(() => {
    let cves = result.cves;
    if (sevFilter !== "ALL")
      cves = cves.filter(c => (c.cvss_severity || "").toUpperCase() === sevFilter);
    if (search) {
      const q = search.toLowerCase();
      cves = cves.filter(c =>
        c.id.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.cvss_severity ?? "").toLowerCase().includes(q)
      );
    }
    return cves;
  }, [result.cves, sevFilter, search]);

  // severity summary for this server
  const sevCounts = useMemo(() => {
    const m: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const c of result.cves) {
      const s = (c.cvss_severity || "").toUpperCase();
      if (s in m) m[s]++;
    }
    return m;
  }, [result.cves]);

  const worstSev = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).find(s => sevCounts[s] > 0) ?? null;

  if (visibleCves.length === 0 && (sevFilter !== "ALL" || search)) return null;

  return (
    <div className="border-b border-gray-200 last:border-0">
      {/* Server header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-gray-400 text-xs w-3 flex-shrink-0">{open ? "▾" : "▸"}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 truncate">{result.server_name}</span>
            {worstSev && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${sevBg(worstSev)}`}>
                {worstSev}
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400 truncate block">{result.os_string ?? "OS невідома"}</span>
        </div>

        {/* Severity chips */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(s => sevCounts[s] > 0 && (
            <span key={s} className={`text-xs font-semibold px-1.5 py-0.5 rounded ${sevBg(s)}`}>
              {sevCounts[s]}
            </span>
          ))}
          <span className="text-xs text-gray-500 ml-1">
            {result.cve_count} CVE
          </span>
        </div>
      </button>

      {/* CVE table */}
      {open && (
        <div className="bg-gray-50 border-t border-gray-100 overflow-x-auto">
          {visibleCves.length === 0 ? (
            <p className="text-xs text-gray-400 px-6 py-3 text-center">Немає CVE за фільтром</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-100">
                  <th className="py-1.5 px-3">CVE ID</th>
                  <th className="py-1.5 px-3">CVSS</th>
                  <th className="py-1.5 px-3">Severity</th>
                  <th className="py-1.5 px-3">Attack Vector</th>
                  <th className="py-1.5 px-3">Опис</th>
                  <th className="py-1.5 px-3">Дата</th>
                  <th className="py-1.5 px-3 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {visibleCves.map(c => (
                  <CveRow key={c.id} cve={c} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── OS Group accordion ────────────────────────────────────────────────────────

function OsGroupSection({
  groupKey, servers, selected, onToggle, onToggleGroup, searchActive,
}: {
  groupKey: OsGroupKey;
  servers: VulnServerItem[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onToggleGroup: (names: string[], checked: boolean) => void;
  searchActive: boolean;
}) {
  const meta = OS_GROUP_META[groupKey];
  const [expanded, setExpanded] = useState(true);
  const names = servers.map(s => s.name);
  const checkedCount = names.filter(n => selected.has(n)).length;
  const allChecked = checkedCount === names.length && names.length > 0;
  const someChecked = checkedCount > 0 && !allChecked;

  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = someChecked;
  }, [someChecked]);

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Group header */}
      <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allChecked}
          onChange={e => onToggleGroup(names, e.target.checked)}
          className="accent-blue-600 flex-shrink-0"
          onClick={e => e.stopPropagation()}
        />
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          onClick={() => setExpanded(v => !v)}
        >
          <span className="text-sm">{meta.icon}</span>
          <span className="text-xs font-semibold text-gray-700 truncate">{meta.label}</span>
          <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {checkedCount > 0 && (
              <span className="text-xs text-blue-600 font-medium">{checkedCount}/</span>
            )}
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
              {servers.length}
            </span>
            <span className="text-gray-400 text-xs">{expanded ? "▾" : "▸"}</span>
          </span>
        </button>
      </div>

      {/* Servers in group */}
      {(expanded || searchActive) && (
        <div className="pl-5">
          {servers.map(s => (
            <label key={s.name} className="flex items-start gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer rounded">
              <input
                type="checkbox"
                checked={selected.has(s.name)}
                onChange={() => onToggle(s.name)}
                className="mt-0.5 accent-blue-600 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{s.name}</p>
                <p className="text-xs text-gray-400 truncate">{s.os_string ?? "OS невідома"}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SevFilter = "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export default function VulnScanner() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<SevFilter>("ALL");
  const [serverSearch, setServerSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // NVD update state
  const [nvdDropdownOpen, setNvdDropdownOpen] = useState(false);
  const [nvdStatus, setNvdStatus] = useState<NvdUpdateStatus | null>(null);
  const nvdPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: dbStatus } = useQuery({
    queryKey: ["vulnStatus"],
    queryFn: api.vulnStatus,
    refetchInterval: 30_000,
    retry: 1,
  });

  const { data: serversData, isLoading: serversLoading, isError: serversError } = useQuery({
    queryKey: ["vulnServers"],
    queryFn: api.vulnServers,
    retry: 1,
  });

  const { data: jobData, refetch: refetchJob } = useQuery({
    queryKey: ["vulnScanJob", jobId],
    queryFn: () => api.scanJob(jobId!),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (jobId && jobData?.status === "running") {
      pollRef.current = setInterval(() => { refetchJob(); }, 800);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, jobData?.status, refetchJob]);

  const startMutation = useMutation({
    mutationFn: ({ names, score }: { names: string[]; score: number }) =>
      api.startScan(names, score),
    onSuccess: (data) => setJobId(data.job_id),
  });

  const nvdUpdateMutation = useMutation({
    mutationFn: ({ mode, days }: { mode: "update" | "full"; days: number }) =>
      api.startNvdUpdate(mode, days),
    onSuccess: (data) => setNvdStatus(data),
  });

  // Close NVD dropdown on outside click
  useEffect(() => {
    if (!nvdDropdownOpen) return;
    const handler = () => setNvdDropdownOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [nvdDropdownOpen]);

  // Poll NVD update progress while running
  useEffect(() => {
    if (nvdStatus?.status === "running") {
      nvdPollRef.current = setInterval(async () => {
        try {
          const s = await api.nvdUpdateStatus();
          setNvdStatus(s);
        } catch { /* ignore */ }
      }, 1500);
    } else {
      if (nvdPollRef.current) { clearInterval(nvdPollRef.current); nvdPollRef.current = null; }
    }
    return () => { if (nvdPollRef.current) clearInterval(nvdPollRef.current); };
  }, [nvdStatus?.status]);

  const allServers = serversData?.items ?? [];

  // Filter by search
  const filteredServers = useMemo(() => {
    const q = serverSearch.toLowerCase();
    if (!q) return allServers;
    return allServers.filter(
      s => s.name.toLowerCase().includes(q) || (s.os_string ?? "").toLowerCase().includes(q)
    );
  }, [allServers, serverSearch]);

  // Group by OS
  const groupedServers = useMemo(() => {
    const groups: Partial<Record<OsGroupKey, VulnServerItem[]>> = {};
    for (const s of filteredServers) {
      const key = getOsGroup(s.os_string);
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(s);
    }
    // Sort servers within each group by name
    for (const key of Object.keys(groups) as OsGroupKey[])
      groups[key]!.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [filteredServers]);

  const activeGroups = OS_GROUP_ORDER.filter(k => (groupedServers[k]?.length ?? 0) > 0);
  const allSelected = filteredServers.length > 0 && filteredServers.every(s => selected.has(s.name));

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) filteredServers.forEach(s => next.delete(s.name));
      else filteredServers.forEach(s => next.add(s.name));
      return next;
    });
  }

  function toggleServer(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleGroup(names: string[], checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) names.forEach(n => next.add(n));
      else names.forEach(n => next.delete(n));
      return next;
    });
  }

  function startScan() {
    const names = selected.size > 0 ? Array.from(selected) : allServers.map(s => s.name);
    startMutation.mutate({ names, score: minScore });
  }

  const results: ScanServerResult[] = jobData?.results ?? [];
  const counts = countsBySev(results);
  const totalCves = results.reduce((s, r) => s + r.cve_count, 0);

  // Sort results: servers with most critical first
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const sevScore = (r: ScanServerResult) => {
        for (const c of r.cves) {
          const s = SEV_ORDER[(c.cvss_severity || "").toUpperCase()];
          if (s !== undefined) return s;
        }
        return 99;
      };
      return sevScore(a) - sevScore(b) || b.cve_count - a.cve_count;
    });
  }, [results]);

  // Count of servers visible after filter
  const visibleServerCount = useMemo(() => {
    if (sevFilter === "ALL" && !search) return sortedResults.length;
    return sortedResults.filter(r => {
      let cves = r.cves;
      if (sevFilter !== "ALL") cves = cves.filter(c => (c.cvss_severity || "").toUpperCase() === sevFilter);
      if (search) {
        const q = search.toLowerCase();
        const serverMatch = r.server_name.toLowerCase().includes(q) || (r.os_string ?? "").toLowerCase().includes(q);
        if (!serverMatch)
          cves = cves.filter(c => c.id.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q));
      }
      return cves.length > 0;
    }).length;
  }, [sortedResults, sevFilter, search]);

  const isRunning = jobData?.status === "running";
  const isDone    = jobData?.status === "done";
  const progress  = jobData ? Math.round((jobData.progress / Math.max(jobData.total, 1)) * 100) : 0;
  const dbReady   = dbStatus?.is_ready ?? false;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CVE Scanner</h1>
          <p className="text-sm text-gray-500 mt-0.5">Сканування вразливостей ОС за базою NVD</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            dbReady ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            {dbReady ? `NVD: ${(dbStatus!.total_cves / 1000).toFixed(0)}K CVEs` : "NVD DB не готова"}
          </span>
          {dbStatus?.last_updated && (
            <span className="text-xs text-gray-400">Оновлено: {dbStatus.last_updated.slice(0, 10)}</span>
          )}
          {/* NVD update dropdown */}
          <div className="relative">
            <button
              onClick={() => setNvdDropdownOpen(v => !v)}
              disabled={nvdStatus?.status === "running" || nvdUpdateMutation.isPending}
              className="text-xs px-3 py-1.5 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {nvdStatus?.status === "running" ? "⏳ Завантаження..." : "⬇ Оновити NVD"}
              <span className="text-xs">▾</span>
            </button>
            {nvdDropdownOpen && nvdStatus?.status !== "running" && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-20 w-52">
                <button
                  className="block w-full text-left text-xs px-4 py-2.5 hover:bg-gray-50 text-gray-700"
                  onClick={() => {
                    setNvdDropdownOpen(false);
                    nvdUpdateMutation.mutate({ mode: "update", days: 30 });
                  }}
                >
                  <span className="font-medium">Оновити (останні 30 днів)</span>
                  <br />
                  <span className="text-gray-400">~кілька хвилин</span>
                </button>
                <button
                  className="block w-full text-left text-xs px-4 py-2.5 hover:bg-gray-50 text-gray-700 border-t border-gray-100"
                  onClick={() => {
                    setNvdDropdownOpen(false);
                    nvdUpdateMutation.mutate({ mode: "full", days: 30 });
                  }}
                >
                  <span className="font-medium">Повне завантаження (~250K CVE)</span>
                  <br />
                  <span className="text-gray-400">~15–20 хвилин</span>
                </button>
              </div>
            )}
          </div>
          {isDone && (
            <button onClick={() => window.print()}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-600">
              📄 PDF
            </button>
          )}
        </div>
      </div>

      {/* ── NVD Update Progress Banner ── */}
      {nvdStatus && nvdStatus.status !== "idle" && (
        <div className={`px-6 py-2.5 border-b text-xs flex items-center gap-4 ${
          nvdStatus.status === "error" ? "bg-red-50 border-red-200" :
          nvdStatus.status === "done"  ? "bg-green-50 border-green-200" :
                                         "bg-blue-50 border-blue-200"
        }`}>
          {nvdStatus.status === "running" && (
            <span className="animate-spin text-sm">⏳</span>
          )}
          {nvdStatus.status === "done" && <span className="text-green-600">✅</span>}
          {nvdStatus.status === "error" && <span className="text-red-600">❌</span>}

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className={`font-medium ${
                nvdStatus.status === "error" ? "text-red-700" :
                nvdStatus.status === "done"  ? "text-green-700" : "text-blue-700"
              }`}>
                {nvdStatus.status === "running" && (
                  nvdStatus.total_pages
                    ? `NVD: сторінка ${nvdStatus.page} / ${nvdStatus.total_pages}`
                    : `NVD: сторінка ${nvdStatus.page}…`
                )}
                {nvdStatus.status === "done" && nvdStatus.message}
                {nvdStatus.status === "error" && `Помилка: ${nvdStatus.error}`}
              </span>
              {nvdStatus.total_results != null && (
                <span className="text-gray-500 ml-2 flex-shrink-0">
                  {nvdStatus.cves_done.toLocaleString()} / {nvdStatus.total_results.toLocaleString()} CVE
                </span>
              )}
            </div>
            {nvdStatus.status === "running" && nvdStatus.total_pages != null && nvdStatus.total_pages > 0 && (
              <div className="w-full h-1 bg-blue-200 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded transition-all duration-500"
                  style={{ width: `${Math.round((nvdStatus.page / nvdStatus.total_pages) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {(nvdStatus.status === "done" || nvdStatus.status === "error") && (
            <button
              onClick={() => setNvdStatus(null)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2"
              title="Закрити"
            >✕</button>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left sidebar ── */}
        <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col">

          {/* Search + select all */}
          <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
            <input
              type="text"
              placeholder="Пошук серверів або OS..."
              value={serverSearch}
              onChange={e => setServerSearch(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-600" />
                Вибрати всі ({filteredServers.length})
              </label>
              <span className="text-xs text-blue-600 font-medium">{selected.size} вибрано</span>
            </div>
          </div>

          {/* OS group list */}
          <div className="flex-1 overflow-y-auto">
            {serversLoading ? (
              <p className="text-xs text-gray-400 px-3 py-4 text-center">Завантаження...</p>
            ) : serversError ? (
              <div className="px-3 py-4 text-center space-y-2">
                <p className="text-xs text-red-500 font-medium">Не вдалося завантажити список серверів</p>
                <p className="text-xs text-gray-400">Перезапустіть backend-сервіс (StatisticBackend)</p>
              </div>
            ) : activeGroups.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-4 text-center">
                {serverSearch ? "Нічого не знайдено" : "Немає серверів"}
              </p>
            ) : (
              activeGroups.map(key => (
                <OsGroupSection
                  key={key}
                  groupKey={key}
                  servers={groupedServers[key]!}
                  selected={selected}
                  onToggle={toggleServer}
                  onToggleGroup={toggleGroup}
                  searchActive={!!serverSearch}
                />
              ))
            )}
          </div>

          {/* Bottom controls */}
          <div className="border-t border-gray-200 p-3 space-y-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Мін. CVSS Score:{" "}
                <span className="font-semibold text-gray-700">{minScore === 0 ? "всі" : `≥${minScore}`}</span>
              </label>
              <input
                type="range" min={0} max={10} step={0.5} value={minScore}
                onChange={e => setMinScore(parseFloat(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
            <button
              onClick={startScan}
              disabled={!dbReady || isRunning || startMutation.isPending}
              className="w-full py-2 rounded text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? "Сканування..." : startMutation.isPending ? "Запуск..." : "Почати сканування"}
            </button>
            {!dbReady && (
              <p className="text-xs text-red-500 text-center">Запустіть download_nvd.py</p>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Progress bar */}
          {(isRunning || isDone) && (
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>
                  {isRunning
                    ? `Сканування: ${jobData!.progress} / ${jobData!.total} серверів`
                    : `Завершено: ${jobData!.total} серверів`}
                </span>
                <span className="font-semibold">{progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded overflow-hidden">
                <div className="h-full bg-blue-500 rounded transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Summary strip */}
          {results.length > 0 && (
            <div className="flex gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50">
              {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSevFilter(sevFilter === s ? "ALL" : s)}
                  className={`flex flex-col items-center px-3 py-1.5 rounded border transition-all ${
                    sevFilter === s ? "border-current shadow-sm" : "border-transparent hover:border-gray-300"
                  }`}
                  style={{ color: sevColor(s) }}
                >
                  <span className="text-xl font-bold">{counts[s]}</span>
                  <span className="text-xs uppercase tracking-wide">{s}</span>
                </button>
              ))}
              <div className="border-l border-gray-200 ml-2 pl-4 flex flex-col items-center justify-center text-gray-500">
                <span className="text-xl font-bold text-gray-700">{totalCves}</span>
                <span className="text-xs">всього CVE</span>
              </div>
              <div className="flex flex-col items-center justify-center text-gray-500">
                <span className="text-xl font-bold text-gray-700">{results.length}</span>
                <span className="text-xs">серверів</span>
              </div>
              {sevFilter !== "ALL" && (
                <button onClick={() => setSevFilter("ALL")}
                  className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline self-center">
                  скинути фільтр
                </button>
              )}
            </div>
          )}

          {/* Results — grouped by server */}
          <div className="flex-1 overflow-auto">
            {results.length > 0 ? (
              <>
                {/* Search toolbar */}
                <div className="sticky top-0 bg-white z-10 px-4 py-2 border-b border-gray-100 flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="Пошук по CVE ID, опис, сервер..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 max-w-sm text-xs border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {visibleServerCount} серверів
                  </span>
                </div>

                {/* Server accordion list */}
                <div>
                  {sortedResults.map((r, i) => (
                    <ServerResultRow
                      key={r.server_name}
                      result={r}
                      sevFilter={sevFilter}
                      search={search}
                      defaultOpen={i === 0 && sortedResults.length === 1}
                    />
                  ))}
                  {visibleServerCount === 0 && (
                    <p className="text-sm text-gray-400 px-6 py-8 text-center">
                      Не знайдено серверів за заданими фільтрами
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                {isRunning ? (
                  <>
                    <div className="text-4xl animate-spin">⚙️</div>
                    <p className="text-sm">Сканування в процесі...</p>
                  </>
                ) : jobData?.status === "error" ? (
                  <>
                    <div className="text-4xl">❌</div>
                    <p className="text-sm text-red-500">{jobData.error}</p>
                  </>
                ) : (
                  <>
                    <div className="text-4xl">🔐</div>
                    <p className="text-sm">Виберіть сервери та натисніть «Почати сканування»</p>
                    {!dbReady && (
                      <p className="text-xs text-red-400 max-w-xs text-center">
                        База NVD не знайдена. Запустіть:{" "}
                        <code className="bg-gray-100 px-1 rounded">python download_nvd.py</code>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          nav, aside, button, input, .no-print { display: none !important; }
          body { font-size: 11px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 4px 6px; }
          th { background: #f3f4f6; }
          a { color: inherit; text-decoration: none; }
        }
      `}</style>
    </div>
  );
}
