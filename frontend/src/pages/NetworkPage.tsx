import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, LineChart, Line, ReferenceLine,
} from "recharts";
import { api } from "../api/client";
import type {
  ZabbixProblemsResponse, ChannelHost, ChannelIface,
} from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_LABEL: Record<number, string> = {
  5: "Критична", 4: "Висока", 3: "Середня",
  2: "Попередження", 1: "Інформація", 0: "Без класифікації",
};
const SEV_CSS: Record<number, string> = {
  5: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  4: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  3: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  1: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400",
  0: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-500",
};
const CHART_COLORS = {
  critical: "#ef4444", high: "#f97316", average: "#eab308",
  warning: "#3b82f6", info: "#94a3b8",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type FlatProblem = {
  event_id: string;
  host_name: string;
  host_technical: string;
  name: string;
  severity: number;
  clock: number;
  acknowledged: boolean;
  suppressed: boolean;
};

type SortKey = "clock" | "host_name" | "severity" | "name";
type SortDir = "asc" | "desc";

const PROBLEM_PERIODS = [7, 14, 30] as const;
const CHANNEL_HOURS = [1, 6, 24, 48, 168] as const;
const CHANNEL_HOUR_LABELS: Record<number, string> = {
  1: "1 год", 6: "6 год", 24: "24 год", 48: "2 дні", 168: "7 днів",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPeriodDates(days: number) {
  const till = new Date();
  const from = new Date(till.getTime() - days * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: iso(from), dateTill: iso(till) };
}

function flattenProblems(data: ZabbixProblemsResponse): FlatProblem[] {
  return data.hosts
    .flatMap((host) =>
      host.problems.map((p) => ({
        event_id: p.event_id,
        host_name: host.host_name,
        host_technical: host.host_technical,
        name: p.name,
        severity: p.severity,
        clock: p.clock,
        acknowledged: p.acknowledged,
        suppressed: p.suppressed,
      })),
    )
    .sort((a, b) => b.clock - a.clock);
}

function buildDailyChart(problems: FlatProblem[], days: number) {
  const map: Record<string, Record<string, number>> = {};
  const till = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(till.getTime() - i * 24 * 3600 * 1000);
    const key = d.toISOString().slice(0, 10);
    map[key] = { critical: 0, high: 0, average: 0, warning: 0, info: 0 };
  }
  for (const p of problems) {
    const key = new Date(p.clock * 1000).toISOString().slice(0, 10);
    if (!(key in map)) continue;
    if (p.severity === 5) map[key].critical++;
    else if (p.severity === 4) map[key].high++;
    else if (p.severity === 3) map[key].average++;
    else if (p.severity === 2) map[key].warning++;
    else map[key].info++;
  }
  return Object.entries(map).map(([date, c]) => ({
    date: date.slice(5),
    ...c,
    total: c.critical + c.high + c.average + c.warning + c.info,
  }));
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString("uk-UA");
}

function fmtBps(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const abs = Math.abs(bps);
  if (abs >= 1e9) return `${(bps / 1e9).toFixed(2)} Гбіт/с`;
  if (abs >= 1e6) return `${(bps / 1e6).toFixed(2)} Мбіт/с`;
  if (abs >= 1e3) return `${(bps / 1e3).toFixed(1)} Кбіт/с`;
  return `${bps.toFixed(0)} біт/с`;
}

function tickFmtBps(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border-l-4 ${color} bg-white dark:bg-slate-900 px-4 py-3 shadow-sm`}>
      <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}

function SevBadge({ sev }: { sev: number }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEV_CSS[sev] ?? SEV_CSS[0]}`}>
      {SEV_LABEL[sev] ?? "—"}
    </span>
  );
}

// ── Channel chart ─────────────────────────────────────────────────────────────

function ChannelChart({
  host, iface, hours,
}: {
  host: ChannelHost;
  iface: ChannelIface;
  hours: number;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["channel-history", host.hostid, iface.ifname, hours],
    queryFn: () => api.channelHistory(host.hostid, iface.ifname, iface.itemid_in, iface.itemid_out, hours),
    staleTime: 2 * 60_000,
  });

  const chartData = useMemo(() => {
    if (!data?.points?.length) return [];
    return data.points.map((p) => ({
      clock: p.clock,
      in: p.in_bps,
      out: p.out_bps,
    }));
  }, [data]);

  const fmtClock = (ts: number) => {
    const d = new Date(ts * 1000);
    if (hours <= 24) return d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const maxIn = data ? Math.max(...(data.points.map((p) => p.in_bps ?? 0))) : 0;
  const maxOut = data ? Math.max(...(data.points.map((p) => p.out_bps ?? 0))) : 0;
  const avgIn = data && data.points.length
    ? data.points.reduce((s, p) => s + (p.in_bps ?? 0), 0) / data.points.length
    : 0;
  const avgOut = data && data.points.length
    ? data.points.reduce((s, p) => s + (p.out_bps ?? 0), 0) / data.points.length
    : 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4 shadow-sm">
      {/* Info row */}
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <p className="text-sm font-semibold">{host.name}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-mono mt-0.5">{iface.ifname}</p>
        </div>
        <div className="flex gap-4 text-xs text-right shrink-0">
          <div>
            <span className="text-green-600 dark:text-green-400 font-medium">▼ Вхідний</span>
            <p className="text-gray-700 dark:text-slate-200">avg {fmtBps(avgIn)}</p>
            <p className="text-gray-400">max {fmtBps(maxIn)}</p>
          </div>
          <div>
            <span className="text-red-500 dark:text-red-400 font-medium">▲ Вихідний</span>
            <p className="text-gray-700 dark:text-slate-200">avg {fmtBps(avgOut)}</p>
            <p className="text-gray-400">max {fmtBps(maxOut)}</p>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="h-44 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-slate-500 animate-pulse">Завантаження з Zabbix...</p>
        </div>
      )}
      {isError && (
        <div className="h-44 flex items-center justify-center">
          <p className="text-sm text-red-500">Помилка з'єднання з Zabbix</p>
        </div>
      )}
      {!isLoading && !isError && chartData.length === 0 && (
        <div className="h-44 flex items-center justify-center">
          <p className="text-sm text-gray-400 dark:text-slate-500">Немає даних за цей період</p>
        </div>
      )}
      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
            <XAxis
              dataKey="clock"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtClock}
              tick={{ fontSize: 10 }}
              minTickGap={60}
            />
            <YAxis
              tickFormatter={tickFmtBps}
              tick={{ fontSize: 10 }}
              width={52}
            />
            <Tooltip
              labelFormatter={(v) => fmtClock(Number(v))}
              formatter={(v: unknown, name: unknown) => [fmtBps(Number(v)), name === "in" ? "Вхідний" : "Вихідний"]}
            />
            <Legend
              formatter={(v) => v === "in" ? "Вхідний (bits/s)" : "Вихідний (bits/s)"}
              wrapperStyle={{ fontSize: 11 }}
            />
            <Line type="monotone" dataKey="in" stroke="#22c55e" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} name="in" />
            <Line type="monotone" dataKey="out" stroke="#ef4444" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} name="out" />
            <ReferenceLine y={avgIn} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.5} />
            <ReferenceLine y={avgOut} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Channels tab ──────────────────────────────────────────────────────────────

function ChannelsTab() {
  const [hours, setHours] = useState<number>(24);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [selectedIface, setSelectedIface] = useState<string>("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["channel-hosts"],
    queryFn: api.channelHosts,
    staleTime: 5 * 60_000,
  });

  const hosts = data?.hosts ?? [];
  const selectedHost = hosts.find((h) => h.hostid === selectedHostId) ?? null;

  // Auto-select first host when data loads
  useMemo(() => {
    if (!selectedHostId && hosts.length > 0) {
      setSelectedHostId(hosts[0].hostid);
    }
  }, [hosts, selectedHostId]);

  // Auto-select first interface when host changes
  useMemo(() => {
    if (selectedHost && selectedHost.interfaces.length > 0) {
      const ifaces = selectedHost.interfaces;
      if (!ifaces.find((i) => i.ifname === selectedIface)) {
        setSelectedIface(ifaces[0].ifname);
      }
    }
  }, [selectedHost, selectedIface]);

  const ifaces = selectedHost?.interfaces ?? [];
  const activeIfaces: ChannelIface[] = selectedIface
    ? ifaces.filter((i) => i.ifname === selectedIface)
    : ifaces;

  return (
    <div className="space-y-4">
      {isLoading && (
        <p className="text-sm text-gray-400 dark:text-slate-500 animate-pulse">
          Отримуємо список інтерфейсів з Zabbix...
        </p>
      )}
      {isError && (
        <p className="text-sm text-red-500">Помилка з'єднання з Zabbix при завантаженні інтерфейсів</p>
      )}

      {hosts.length > 0 && (
        <>
          {/* Controls */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 flex flex-wrap items-center gap-3">
            {/* Host selector */}
            <select
              value={selectedHostId}
              onChange={(e) => { setSelectedHostId(e.target.value); setSelectedIface(""); }}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 max-w-[280px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {hosts.map((h) => (
                <option key={h.hostid} value={h.hostid}>{h.name}</option>
              ))}
            </select>

            {/* Interface selector */}
            <select
              value={selectedIface}
              onChange={(e) => setSelectedIface(e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 max-w-[280px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">Всі інтерфейси ({ifaces.length})</option>
              {ifaces.map((i) => (
                <option key={i.ifname} value={i.ifname}>{i.ifname}</option>
              ))}
            </select>

            {/* Period */}
            <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden text-sm ml-auto">
              {CHANNEL_HOURS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className={
                    "px-3 py-1.5 font-medium transition-colors " +
                    (hours === h
                      ? "bg-blue-500 text-white"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800")
                  }
                >
                  {CHANNEL_HOUR_LABELS[h]}
                </button>
              ))}
            </div>
          </div>

          {/* Charts */}
          <div className="space-y-4">
            {selectedHost && activeIfaces.map((iface) => (
              <ChannelChart
                key={iface.ifname}
                host={selectedHost}
                iface={iface}
                hours={hours}
              />
            ))}
          </div>

          {/* Summary table of all interfaces */}
          {selectedHost && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                <p className="text-sm font-semibold">Всі інтерфейси — {selectedHost.name}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Інтерфейс</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Останній вхідний</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Останній вихідний</th>
                      <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Оновлено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {ifaces.map((i) => (
                      <tr
                        key={i.ifname}
                        onClick={() => setSelectedIface(i.ifname === selectedIface ? "" : i.ifname)}
                        className={
                          "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors " +
                          (i.ifname === selectedIface ? "bg-blue-50 dark:bg-blue-900/20" : "")
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs">{i.ifname}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">{fmtBps(i.last_in)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-500 dark:text-red-400">{fmtBps(i.last_out)}</td>
                        <td className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">
                          {i.lastclock ? fmtTime(i.lastclock) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!isLoading && !isError && hosts.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 p-6 space-y-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
            Немає мережевих пристроїв з метриками net.if
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">
            Щоб бачити графіки навантаження каналів, потрібно щоб у Zabbix були хости
            з items типу <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">net.if.in[ifName]</code> та{" "}
            <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">net.if.out[ifName]</code>.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NetworkPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get("tab") === "channels") ? "channels" : "problems";
  const period = PROBLEM_PERIODS.includes(Number(searchParams.get("days")) as typeof PROBLEM_PERIODS[number])
    ? Number(searchParams.get("days"))
    : 7;
  const hostFilter = searchParams.get("host") ?? "";
  const sevFilter = Number(searchParams.get("sev") ?? "-1");
  const searchQ = searchParams.get("q") ?? "";

  const [sortKey, setSortKey] = useState<SortKey>("clock");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  function setParam(k: string, v: string) {
    setSearchParams(
      (prev) => { const n = new URLSearchParams(prev); n.set(k, v); return n; },
      { replace: true },
    );
  }

  const { dateFrom, dateTill } = getPeriodDates(period);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["network-problems", period],
    queryFn: () => api.zabbixProblems(dateFrom, dateTill),
    staleTime: 2 * 60_000,
    enabled: activeTab === "problems",
  });

  const allProblems = useMemo<FlatProblem[]>(
    () => (data ? flattenProblems(data) : []),
    [data],
  );

  const uniqueHosts = useMemo(
    () => [...new Set(allProblems.map((p) => p.host_name))].sort(),
    [allProblems],
  );

  const filtered = useMemo(() => {
    let items = allProblems;
    if (hostFilter) items = items.filter((p) => p.host_name === hostFilter);
    if (sevFilter >= 0) items = items.filter((p) => p.severity === sevFilter);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      items = items.filter((p) =>
        p.name.toLowerCase().includes(q) || p.host_name.toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allProblems, hostFilter, sevFilter, searchQ, sortKey, sortDir]);

  // Reset to page 1 when filters/sort change
  useMemo(() => { setPage(1); }, [hostFilter, sevFilter, searchQ, sortKey, sortDir, period]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const dailyChart = useMemo(() => buildDailyChart(allProblems, period), [allProblems, period]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  function Th({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide cursor-pointer hover:text-gray-800 dark:hover:text-slate-100 select-none whitespace-nowrap"
      >
        {label}
        <span className="ml-1 opacity-50">{active ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}</span>
      </th>
    );
  }

  const counts = useMemo(() => ({
    total: allProblems.length,
    critical: allProblems.filter((p) => p.severity === 5).length,
    high: allProblems.filter((p) => p.severity === 4).length,
    average: allProblems.filter((p) => p.severity === 3).length,
    warning: allProblems.filter((p) => p.severity === 2).length,
    info: allProblems.filter((p) => p.severity <= 1).length,
  }), [allProblems]);

  function handleExport() {
    exportToXlsx(`network-problems-${period}d.xlsx`, "Проблеми", filtered.map((p) => ({
      "Час": fmtTime(p.clock),
      "Хост": p.host_name,
      "Проблема": p.name,
      "Серйозність": SEV_LABEL[p.severity] ?? p.severity,
      "Підтверджено": p.acknowledged ? "Так" : "Ні",
      "Пригнічено": p.suppressed ? "Так" : "Ні",
    })));
  }

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Мережа</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
          Аналіз мережевих каналів та інцидентів за Zabbix
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-slate-700">
        {[
          { key: "problems", label: "Проблеми / Інциденти" },
          { key: "channels", label: "Завантаження каналів" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setParam("tab", t.key)}
            className={
              "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (activeTab === t.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PROBLEMS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "problems" && (
        <>
          {/* Period */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-slate-400">Період:</span>
            <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden text-sm">
              {PROBLEM_PERIODS.map((d) => (
                <button
                  key={d}
                  onClick={() => setParam("days", String(d))}
                  className={
                    "px-3 py-1.5 font-medium transition-colors " +
                    (period === d
                      ? "bg-blue-500 text-white"
                      : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800")
                  }
                >
                  {d} днів
                </button>
              ))}
            </div>
            {isLoading && (
              <span className="text-sm text-gray-400 dark:text-slate-500 animate-pulse">
                Запит до Zabbix...
              </span>
            )}
            {isError && (
              <span className="text-sm text-red-500">Помилка з'єднання з Zabbix</span>
            )}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Всього інцидентів" value={counts.total} color="border-gray-400" sub={`за ${period} днів`} />
            <StatCard label="Критичні" value={counts.critical} color="border-red-500" sub="severity 5" />
            <StatCard label="Висока" value={counts.high} color="border-orange-500" sub="severity 4" />
            <StatCard label="Середня" value={counts.average} color="border-yellow-400" sub="severity 3" />
            <StatCard label="Попередження" value={counts.warning} color="border-blue-500" sub="severity 2" />
            <StatCard label="Інформація" value={counts.info} color="border-gray-300" sub="severity 0–1" />
          </div>

          {/* Daily chart */}
          {dailyChart.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4 shadow-sm">
              <p className="text-sm font-semibold mb-3">Інциденти по днях</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="critical" name="Критична" stackId="a" fill={CHART_COLORS.critical} />
                  <Bar dataKey="high" name="Висока" stackId="a" fill={CHART_COLORS.high} />
                  <Bar dataKey="average" name="Середня" stackId="a" fill={CHART_COLORS.average} />
                  <Bar dataKey="warning" name="Попередження" stackId="a" fill={CHART_COLORS.warning} />
                  <Bar dataKey="info" name="Інформація" stackId="a" fill={CHART_COLORS.info} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 flex flex-wrap items-center gap-3">
            <select
              value={hostFilter}
              onChange={(e) => setParam("host", e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 max-w-[240px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">Всі хости ({uniqueHosts.length})</option>
              {uniqueHosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>

            <select
              value={String(sevFilter)}
              onChange={(e) => setParam("sev", e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="-1">Всі рівні</option>
              {[5, 4, 3, 2, 1, 0].map((s) => (
                <option key={s} value={String(s)}>{SEV_LABEL[s]}</option>
              ))}
            </select>

            <input
              type="search"
              placeholder="Пошук по назві / хосту..."
              value={searchQ}
              onChange={(e) => setParam("q", e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 w-52 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
            />

            <span className="text-sm text-gray-400 dark:text-slate-500 ml-auto">
              {filtered.length} подій
            </span>

            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition disabled:opacity-40"
            >
              Експорт XLSX
            </button>
          </div>

          {/* Problems table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60">
                  <tr>
                    <Th col="clock" label="Час" />
                    <Th col="host_name" label="Хост" />
                    <Th col="name" label="Проблема" />
                    <Th col="severity" label="Серйозність" />
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">Підтв.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500 text-sm">
                        {isLoading ? "Завантаження даних з Zabbix..." : "Немає даних за поточними фільтрами"}
                      </td>
                    </tr>
                  ) : (
                    paged.map((p) => (
                      <tr key={`${p.event_id}-${p.host_name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap tabular-nums">{fmtTime(p.clock)}</td>
                        <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={p.host_name}>{p.host_name}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-slate-300 max-w-[400px]" title={p.name}>{p.name}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><SevBadge sev={p.severity} /></td>
                        <td className="px-3 py-2 text-center">
                          {p.acknowledged
                            ? <span className="text-green-600 dark:text-green-400 text-xs font-medium">✓ Так</span>
                            : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 shadow-sm">
              <span className="text-sm text-gray-500 dark:text-slate-400">
                Сторінка {page} з {totalPages} · {filtered.length} подій
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Перша сторінка"
                >
                  «
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  ‹ Назад
                </button>

                {/* Page numbers around current */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                  .reduce<(number | "…")[]>((acc, n, i, arr) => {
                    if (i > 0 && n - (arr[i - 1] as number) > 1) acc.push("…");
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((n, i) =>
                    n === "…" ? (
                      <span key={`dots-${i}`} className="px-2 text-gray-400">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n as number)}
                        className={
                          "w-8 h-8 text-sm rounded-lg border transition " +
                          (page === n
                            ? "bg-blue-500 text-white border-blue-500 font-medium"
                            : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-300")
                        }
                      >
                        {n}
                      </button>
                    )
                  )}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Далі ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Остання сторінка"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── CHANNELS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "channels" && <ChannelsTab />}
    </div>
  );
}
