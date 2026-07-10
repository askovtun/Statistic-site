import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ZabbixHostProblems, type ZabbixProblemItem } from "../api/client";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 50;

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_LABEL = ["Не класиф.", "Інформація", "Попередження", "Середня", "Висока", "Критична"];
const SEV_BADGE: Record<number, string> = {
  5: "bg-purple-100 text-purple-800 border border-purple-200",
  4: "bg-red-100 text-red-700 border border-red-200",
  3: "bg-orange-100 text-orange-700 border border-orange-200",
  2: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  1: "bg-blue-100 text-blue-700 border border-blue-200",
  0: "bg-gray-100 text-gray-600 border border-gray-200",
};
const SEV_DOT: Record<number, string> = {
  5: "bg-purple-500",
  4: "bg-red-500",
  3: "bg-orange-400",
  2: "bg-yellow-400",
  1: "bg-blue-400",
  0: "bg-gray-400",
};

function SeverityBadge({ sev }: { sev: number }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${SEV_BADGE[sev] ?? SEV_BADGE[0]}`}>
      {SEV_LABEL[sev] ?? sev}
    </span>
  );
}

function SevCount({ n, sev }: { n: number; sev: number }) {
  if (n === 0) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded ${SEV_BADGE[sev]}`}>
      {n}
    </span>
  );
}

function formatClock(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

// ── Column config ─────────────────────────────────────────────────────────────

type SevCol = { key: "disaster" | "high" | "average" | "warning" | "information" | "not_classified"; sev: number; label: string };
const SEV_COLS: SevCol[] = [
  { key: "disaster",       sev: 5, label: "Критичні" },
  { key: "high",           sev: 4, label: "Високі" },
  { key: "average",        sev: 3, label: "Середні" },
  { key: "warning",        sev: 2, label: "Попередження" },
  { key: "information",    sev: 1, label: "Інформація" },
  { key: "not_classified", sev: 0, label: "Не класиф." },
];

// ── Column visibility dropdown ────────────────────────────────────────────────

function ColVisDropdown({
  visible,
  onToggle,
}: {
  visible: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 flex items-center gap-1"
      >
        Колонки ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[170px]">
            {SEV_COLS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={visible.has(c.key)}
                  onChange={() => onToggle(c.key)}
                  className="accent-blue-600"
                />
                <SeverityBadge sev={c.sev} />
                <span className="text-xs text-gray-600">{c.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Problem detail row ────────────────────────────────────────────────────────

function ProblemRow({ p, colSpan }: { p: ZabbixProblemItem; colSpan: number }) {
  return (
    <tr className="border-t border-gray-100 bg-gray-50/60">
      <td />
      <td className="pl-4 pr-2 py-1.5" colSpan={colSpan - 1}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEV_DOT[p.severity] ?? SEV_DOT[0]}`} />
          <SeverityBadge sev={p.severity} />
          <span className="text-xs text-gray-700">{p.name}</span>
          {p.acknowledged && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-green-50 text-green-600 border border-green-200">підтв.</span>
          )}
          {p.suppressed && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">прихов.</span>
          )}
          <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap">{formatClock(p.clock)}</span>
        </div>
      </td>
    </tr>
  );
}

// ── Date range picker ─────────────────────────────────────────────────────────

type Mode = "live" | "period";

interface DateRange {
  from: string;
  till: string;
}

function DateRangePicker({
  range,
  onChange,
  onApply,
  loading,
}: {
  range: DateRange;
  onChange: (r: DateRange) => void;
  onApply: () => void;
  loading: boolean;
}) {
  const today = todayStr();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500 font-medium">З:</span>
      <input
        type="date"
        value={range.from}
        max={range.till || today}
        onChange={(e) => onChange({ ...range, from: e.target.value })}
        className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />
      <span className="text-xs text-gray-500 font-medium">По:</span>
      <input
        type="date"
        value={range.till}
        min={range.from}
        max={today}
        onChange={(e) => onChange({ ...range, till: e.target.value })}
        className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />
      {/* Quick presets */}
      {[
        { label: "Сьогодні", from: today, till: today },
        { label: "7 днів", from: weekAgoStr(), till: today },
        { label: "30 днів", from: (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })(), till: today },
      ].map((p) => (
        <button
          key={p.label}
          onClick={() => onChange({ from: p.from, till: p.till })}
          className={`text-xs px-2 py-1 rounded border transition ${
            range.from === p.from && range.till === p.till
              ? "bg-blue-50 border-blue-400 text-blue-700"
              : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={onApply}
        disabled={loading || !range.from || !range.till}
        className="px-3 py-1 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 ml-1"
      >
        {loading ? "Завантаження..." : "Показати"}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SortKey = "host_name" | "total" | "max_severity" | "latest_clock"
  | "disaster" | "high" | "average" | "warning" | "information" | "not_classified";

export default function ZabbixProblems() {
  const [mode, setMode] = useState<Mode>("live");
  const [pendingRange, setPendingRange] = useState<DateRange>({ from: weekAgoStr(), till: todayStr() });
  const [appliedRange, setAppliedRange] = useState<DateRange | null>(null);

  // queryKey changes when mode/applied range changes → triggers new fetch
  const queryKey = mode === "live"
    ? ["zabbixProblems", "live"]
    : ["zabbixProblems", "period", appliedRange?.from, appliedRange?.till];

  const enabled = mode === "live" || appliedRange !== null;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      mode === "live"
        ? api.zabbixProblems()
        : api.zabbixProblems(appliedRange!.from, appliedRange!.till),
    staleTime: mode === "live" ? 2 * 60 * 1000 : 10 * 60 * 1000,
    enabled,
  });

  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("max_severity");
  const [sortDesc, setSortDesc] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(SEV_COLS.filter((c) => c.sev >= 1).map((c) => c.key))
  );

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
    setPage(1);
  }

  function toggleColVisible(key: string) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleExpand(hostid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(hostid)) next.delete(hostid); else next.add(hostid);
      return next;
    });
  }

  function handleApplyPeriod() {
    setAppliedRange({ ...pendingRange });
    setPage(1);
    setExpanded(new Set());
  }

  function switchMode(m: Mode) {
    setMode(m);
    setPage(1);
    setExpanded(new Set());
    setSevFilter(null);
    setSearch("");
  }

  const hosts = data?.hosts ?? [];

  const filtered = hosts.filter((h) => {
    if (sevFilter !== null) {
      const field = (["not_classified", "information", "warning", "average", "high", "disaster"] as const)[sevFilter];
      if (h[field] === 0) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!h.host_name.toLowerCase().includes(q) && !h.host_technical.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] as string | number | null | undefined) ?? -Infinity;
    const bv = (b[sortKey] as string | number | null | undefined) ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string")
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeSevCols = SEV_COLS.filter((c) => visibleCols.has(c.key));
  const totalColSpan = 2 + activeSevCols.length + 2;

  function SortTh({ k, label, title, cls }: { k: SortKey; label: React.ReactNode; title?: string; cls?: string }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-3 py-3 text-left cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${cls ?? ""}`}
        title={title}
        onClick={() => toggleSort(k)}
      >
        <span className="flex items-center gap-1">
          {label}
          <span className="text-gray-400 text-xs">{active ? (sortDesc ? "↓" : "↑") : "↕"}</span>
        </span>
      </th>
    );
  }

  const hasFilter = search || sevFilter !== null;

  const periodLabel = appliedRange
    ? `${appliedRange.from} — ${appliedRange.till}`
    : null;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-800">Zabbix — проблеми</h1>
        {mode === "live" && (
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            {isFetching ? "Оновлення..." : "Оновити"}
          </button>
        )}
      </div>

      {/* Mode toggle + period picker */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button
            onClick={() => switchMode("live")}
            className={`px-4 py-1.5 transition ${mode === "live" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            Активні зараз
          </button>
          <button
            onClick={() => switchMode("period")}
            className={`px-4 py-1.5 transition border-l border-gray-200 ${mode === "period" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            За період
          </button>
        </div>

        {mode === "period" && (
          <DateRangePicker
            range={pendingRange}
            onChange={setPendingRange}
            onApply={handleApplyPeriod}
            loading={isFetching}
          />
        )}

        {mode === "live" && data && (
          <span className="text-xs text-gray-400 ml-1">
            Отримано: {new Date(data.fetched_at).toLocaleString("uk-UA")}
          </span>
        )}
        {mode === "period" && periodLabel && data && (
          <span className="text-xs text-gray-400 ml-1">
            Показано за {periodLabel} · {new Date(data.fetched_at).toLocaleString("uk-UA")}
          </span>
        )}
      </div>

      {/* Summary cards */}
      {data && (
        <div className="flex flex-wrap gap-3 mb-6">
          {[
            { label: "Критичні", val: data.disaster, sev: 5, cls: "border-purple-400 text-purple-700" },
            { label: "Високі", val: data.high, sev: 4, cls: "border-red-400 text-red-700" },
            { label: "Середні", val: data.average, sev: 3, cls: "border-orange-400 text-orange-700" },
            { label: "Попередження", val: data.warning, sev: 2, cls: "border-yellow-400 text-yellow-700" },
            { label: "Інформація", val: data.information, sev: 1, cls: "border-blue-400 text-blue-700" },
          ].map(({ label, val, sev, cls }) => (
            <button
              key={sev}
              onClick={() => { setSevFilter(sevFilter === sev ? null : sev); setPage(1); }}
              className={`bg-white rounded-xl shadow-sm border-l-4 px-5 py-3 text-left transition hover:shadow-md ${cls} ${sevFilter === sev ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}
            >
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-2xl font-bold">{val}</p>
            </button>
          ))}
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-gray-300 px-5 py-3">
            <p className="text-xs text-gray-500">Серверів</p>
            <p className="text-2xl font-bold text-gray-700">{data.total_hosts}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-gray-200 px-5 py-3">
            <p className="text-xs text-gray-500">Всього подій</p>
            <p className="text-2xl font-bold text-gray-500">{data.total_problems}</p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          type="text"
          placeholder="Пошук за назвою сервера..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400 w-64"
        />
        {hasFilter && (
          <button
            onClick={() => { setSearch(""); setSevFilter(null); setPage(1); }}
            className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
          >
            Скинути фільтри
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">{filtered.length} серверів</span>
          <ColVisDropdown visible={visibleCols} onToggle={toggleColVisible} />
        </div>
      </div>

      {mode === "period" && !appliedRange && (
        <p className="text-gray-400 text-sm py-8 text-center">
          Оберіть діапазон дат і натисніть «Показати»
        </p>
      )}

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження даних з Zabbix...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      {/* Table */}
      {(mode === "live" || appliedRange) && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <SortTh k="host_name" label="Сервер" />
                  {activeSevCols.map((c) => (
                    <SortTh
                      key={c.key}
                      k={c.key}
                      label={<span className={`font-semibold px-1.5 py-0.5 rounded ${SEV_BADGE[c.sev]}`}>{c.label}</span>}
                    />
                  ))}
                  <SortTh k="total" label="Всього" />
                  <SortTh k="latest_clock" label="Останній алерт" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageItems.map((h: ZabbixHostProblems) => {
                  const isExpanded = expanded.has(h.hostid);
                  const rowBg = h.max_severity >= 5
                    ? "bg-purple-50 hover:bg-purple-100"
                    : h.max_severity >= 4
                    ? "bg-red-50 hover:bg-red-100"
                    : h.max_severity >= 3
                    ? "bg-orange-50 hover:bg-orange-100"
                    : "hover:bg-gray-50";

                  return (
                    <>
                      <tr
                        key={h.hostid}
                        className={`cursor-pointer transition-colors ${rowBg}`}
                        onClick={() => toggleExpand(h.hostid)}
                      >
                        <td className="px-3 py-2.5 text-center text-gray-400">
                          <span className="text-xs">{isExpanded ? "▼" : "▶"}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-gray-800 text-xs">{h.host_name}</p>
                          {h.host_technical !== h.host_name && (
                            <p className="text-[10px] text-gray-400">{h.host_technical}</p>
                          )}
                        </td>
                        {activeSevCols.map((c) => (
                          <td key={c.key} className="px-3 py-2.5">
                            <SevCount n={h[c.key]} sev={c.sev} />
                          </td>
                        ))}
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-bold text-gray-700">{h.total}</span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-gray-500 whitespace-nowrap">
                          {formatClock(h.latest_clock)}
                        </td>
                      </tr>
                      {isExpanded && h.problems.map((p) => (
                        <ProblemRow key={p.event_id} p={p} colSpan={totalColSpan} />
                      ))}
                    </>
                  );
                })}
                {!isLoading && filtered.length === 0 && (mode === "live" || appliedRange) && (
                  <tr>
                    <td colSpan={totalColSpan} className="text-center py-12 text-gray-400">
                      {hasFilter ? "Нічого не знайдено за фільтрами" : "Проблем за вказаний період не знайдено"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sorted.length > PAGE_SIZE && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} з {sorted.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
