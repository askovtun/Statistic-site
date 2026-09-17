import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type ResourceItem } from "../api/client";
import type { ZabbixHostProblems, CmdbDayStats } from "../api/client";

function Sparkline({ data, color = "#3b82f6", height = 24, width = 72 }: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
import {
  ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

function StatCard({
  title,
  value,
  sub,
  color,
  sparkline,
  sparklineColor,
}: {
  title: string;
  value: number | string;
  sub?: string;
  color: string;
  sparkline?: number[];
  sparklineColor?: string;
}) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 ${color} p-5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 dark:text-slate-400">{title}</p>
          <p className="text-3xl font-bold mt-1 text-gray-800 dark:text-slate-100">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{sub}</p>}
        </div>
        {sparkline && sparkline.length >= 2 && (
          <div className="shrink-0 mt-1 opacity-60">
            <Sparkline data={sparkline} color={sparklineColor ?? "#6b7280"} />
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function TopList({
  title,
  items,
  color,
}: {
  title: string;
  items: { name: string; pct: number }[];
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-2.5">
        {items.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Немає даних</p>}
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-slate-500 w-4 text-right">{i + 1}</span>
            <span className="text-xs text-gray-700 dark:text-slate-200 w-40 truncate" title={item.name}>{item.name}</span>
            <TopBar pct={item.pct} color={color} />
            <span className="text-xs font-medium text-gray-600 dark:text-slate-300 w-10 text-right">
              {item.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null);
  if (!clean.length) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function fmtKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function DaysToCard({ label, days, accentColor }: { label: string; days: number; accentColor: "blue" | "purple" }) {
  const urgent = days <= 30;
  const warn = days <= 90;
  const bg = urgent
    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
    : warn
    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
    : accentColor === "purple"
    ? "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800"
    : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
  const textLabel = urgent
    ? "text-red-600 dark:text-red-400"
    : warn
    ? "text-amber-600 dark:text-amber-400"
    : accentColor === "purple"
    ? "text-purple-600 dark:text-purple-400"
    : "text-blue-600 dark:text-blue-400";
  const textVal = urgent
    ? "text-red-800 dark:text-red-300"
    : warn
    ? "text-amber-800 dark:text-amber-300"
    : accentColor === "purple"
    ? "text-purple-800 dark:text-purple-300"
    : "text-blue-800 dark:text-blue-300";
  return (
    <div className={`rounded-lg p-3 border ${bg}`}>
      <p className={`text-xs font-medium ${textLabel}`}>{label}</p>
      <p className={`text-xl font-bold ${textVal}`}>{days === 0 ? "вже досягнуто" : `~${days} днів`}</p>
      <p className={`text-xs ${textLabel} opacity-70`}>при поточному тренді</p>
    </div>
  );
}

function formatTick(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function formatTooltipLabel(ts: unknown) {
  return new Date(Number(ts) * 1000).toLocaleDateString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const SEV_LABEL: Record<number, string> = {
  5: "Катастрофа",
  4: "Висока",
  3: "Середня",
  2: "Попередж.",
  1: "Інфо",
  0: "Невизначено",
};
const SEV_COLOR: Record<number, string> = {
  5: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30",
  4: "text-orange-600 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/30",
  3: "text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30",
  2: "text-yellow-600 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/30",
  1: "text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30",
  0: "text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-800",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const comp = useQuery({ queryKey: ["comparison"], queryFn: api.comparison });
  const res = useQuery({ queryKey: ["resources"], queryFn: () => api.resources() });
  const cl = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const phys = useQuery({ queryKey: ["physical-servers", 30], queryFn: () => api.physicalServers(30) });
  const osRep = useQuery({ queryKey: ["osReport"], queryFn: api.osReport, retry: false });
  const cmdbSt = useQuery({ queryKey: ["cmdbStats", 7], queryFn: () => api.cmdbStats(7), retry: false });
  const decomm = useQuery({ queryKey: ["decommission"], queryFn: api.decommissionCandidates, retry: false });
  const zbxProbs = useQuery({
    queryKey: ["zabbixProblems"],
    queryFn: () => api.zabbixProblems(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const zombieQ = useQuery({
    queryKey: ["zombie-servers-dash"],
    queryFn: () => api.zombieServers(90, 3),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const vcHealth = useQuery({
    queryKey: ["vcenterHealth", 30],
    queryFn: () => api.vcenterHealth(30),
    retry: false,
  });
  const vcSnaps = useQuery({
    queryKey: ["vcenterSnapshots"],
    queryFn: api.vcenterSnapshots,
    retry: false,
  });

  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const effectiveCluster = selectedCluster ?? cl.data?.items[0]?.name ?? null;
  const clusterTrend = useQuery({
    queryKey: ["clusterForecast", effectiveCluster, 90],
    queryFn: () => api.clusterForecast(effectiveCluster!, 90),
    enabled: effectiveCluster != null,
    retry: false,
  });

  const loading = comp.isLoading || res.isLoading || cl.isLoading;

  const topConsumers = useMemo(() => {
    const items: ResourceItem[] = res.data?.items ?? [];
    const top = (key: (i: ResourceItem) => number | null, n = 5) =>
      [...items]
        .filter((i) => key(i) != null)
        .sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0))
        .slice(0, n)
        .map((i) => ({ name: i.name, pct: key(i)! }));
    return {
      cpu: top((i) => i.avg_cpu_pct),
      ram: top((i) => i.avg_ram_pct),
      disk: top((i) => i.avg_disk_used_pct),
    };
  }, [res.data]);

  const overallAvg = useMemo(() => {
    const items: ResourceItem[] = res.data?.items ?? [];
    return {
      cpu: avg(items.map((i) => i.avg_cpu_pct)),
      ram: avg(items.map((i) => i.avg_ram_pct)),
    };
  }, [res.data]);

  const topCpuReady = useMemo(() => {
    return [...(vcHealth.data?.items ?? [])]
      .filter((i) => (i.cpu_ready_pct ?? 0) > 0)
      .sort((a, b) => (b.cpu_ready_pct ?? 0) - (a.cpu_ready_pct ?? 0))
      .slice(0, 10);
  }, [vcHealth.data]);

  const topMemPressure = useMemo(() => {
    return [...(vcHealth.data?.items ?? [])]
      .filter((i) => (i.mem_balloon_kb ?? 0) > 0 || (i.mem_swapped_kb ?? 0) > 0)
      .sort((a, b) => {
        const bScore = (b.mem_balloon_kb ?? 0) + (b.mem_swapped_kb ?? 0);
        const aScore = (a.mem_balloon_kb ?? 0) + (a.mem_swapped_kb ?? 0);
        return bScore - aScore;
      })
      .slice(0, 10);
  }, [vcHealth.data]);

  const topSnapshots = useMemo(() => {
    return [...(vcSnaps.data?.snapshots ?? [])]
      .sort((a, b) => b.age_days - a.age_days)
      .slice(0, 10);
  }, [vcSnaps.data]);

  const showVcenterWidget =
    !vcHealth.isError &&
    vcHealth.data != null &&
    (topCpuReady.length > 0 || topMemPressure.length > 0 || topSnapshots.length > 0);

  const trendPoints = clusterTrend.data?.points ?? [];
  const hasTrendData = trendPoints.some((p) => p.avg_cpu_pct != null || p.avg_ram_pct != null);

  // KPI computations
  const eolCount    = (osRep.data?.eol ?? 0) + (osRep.data?.ending_soon ?? 0);
  const snaps30     = (vcSnaps.data?.snapshots ?? []).filter((s) => s.age_days >= 30).length;
  const newCiWeek   = (cmdbSt.data?.days ?? []).reduce((sum, d) => sum + d.added, 0);
  const decommCount = decomm.data?.total ?? 0;
  const zbxTotal    = zbxProbs.data?.total_problems ?? 0;
  const zbxDisaster = zbxProbs.data?.disaster ?? 0;
  const zombieHigh  = (zombieQ.data?.score3 ?? 0) + (zombieQ.data?.score4 ?? 0) + (zombieQ.data?.score5 ?? 0);

  // Sparkline data: daily "added" CIs from cmdbStats (oldest → newest)
  const sparkAdded: number[] = useMemo(() => {
    return [...(cmdbSt.data?.days ?? [] as CmdbDayStats[])]
      .reverse()
      .map((d) => d.added);
  }, [cmdbSt.data]);

  const sparkTotal: number[] = useMemo(() => {
    return [...(cmdbSt.data?.days ?? [] as CmdbDayStats[])]
      .reverse()
      .map((d) => d.total);
  }, [cmdbSt.data]);

  // Top 5 Zabbix problem hosts by total count
  const topZbxHosts = useMemo<ZabbixHostProblems[]>(() => {
    return [...(zbxProbs.data?.hosts ?? [])]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [zbxProbs.data]);

  const sectionHead = "text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3";

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-1">Дашборд</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">Загальний стан інфраструктури</p>

      {/* ── Потребує уваги — KPI ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={sectionHead}>Потребує уваги</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">

          {/* EOL ОС */}
          <button
            onClick={() => navigate("/os-report")}
            className={`text-left rounded-xl p-4 border transition hover:shadow-md ${
              eolCount > 0
                ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
            }`}
          >
            <p className={`text-2xl font-bold ${eolCount > 0 ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-slate-200"}`}>
              {osRep.isLoading ? "…" : eolCount}
            </p>
            <p className={`text-xs mt-0.5 ${eolCount > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
              EOL / закінчується підтримка ОС
            </p>
          </button>

          {/* Знімки */}
          <button
            onClick={() => navigate("/vcenter")}
            className={`text-left rounded-xl p-4 border transition hover:shadow-md ${
              snaps30 > 0
                ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
            }`}
          >
            <p className={`text-2xl font-bold ${snaps30 > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-700 dark:text-slate-200"}`}>
              {vcSnaps.isLoading ? "…" : snaps30}
            </p>
            <p className={`text-xs mt-0.5 ${snaps30 > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>
              Знімків &gt;30 днів
            </p>
          </button>

          {/* Zabbix проблеми */}
          <button
            onClick={() => navigate("/zabbix-problems")}
            className={`text-left rounded-xl p-4 border transition hover:shadow-md ${
              zbxDisaster > 0 ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" :
              zbxTotal > 0   ? "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
                             : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
            }`}
          >
            <p className={`text-2xl font-bold ${
              zbxDisaster > 0 ? "text-red-700 dark:text-red-300" :
              zbxTotal > 0   ? "text-orange-600 dark:text-orange-300"
                             : "text-gray-700 dark:text-slate-200"
            }`}>
              {zbxProbs.isLoading ? "…" : zbxTotal}
            </p>
            <p className={`text-xs mt-0.5 ${
              zbxDisaster > 0 ? "text-red-600 dark:text-red-400" :
              zbxTotal > 0   ? "text-orange-600 dark:text-orange-400"
                             : "text-gray-500 dark:text-slate-400"
            }`}>
              Активних Zabbix-проблем
            </p>
          </button>

          {/* Кандидати на виведення */}
          <button
            onClick={() => navigate("/decommission")}
            className={`text-left rounded-xl p-4 border transition hover:shadow-md ${
              decommCount > 0
                ? "bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-600"
                : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
            }`}
          >
            <p className="text-2xl font-bold text-gray-700 dark:text-slate-200">
              {decomm.isLoading ? "…" : decommCount}
            </p>
            <p className="text-xs mt-0.5 text-gray-500 dark:text-slate-400">Кандидатів на виведення</p>
          </button>

          {/* Зомбі-сервери */}
          <button
            onClick={() => navigate("/zombie-servers")}
            className={`text-left rounded-xl p-4 border transition hover:shadow-md ${
              zombieHigh > 0
                ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
            }`}
          >
            <p className={`text-2xl font-bold ${zombieHigh > 0 ? "text-red-700 dark:text-red-300" : "text-gray-700 dark:text-slate-200"}`}>
              {zombieQ.isLoading ? "…" : zombieHigh}
            </p>
            <p className={`text-xs mt-0.5 ${zombieHigh > 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-slate-400"}`}>
              Зомбі-серверів (score ≥ 3)
            </p>
          </button>

          {/* Нові CI */}
          <button
            onClick={() => navigate("/cmdb-stats")}
            className="text-left rounded-xl p-4 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 transition hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                  {cmdbSt.isLoading ? "…" : `+${newCiWeek}`}
                </p>
                <p className="text-xs mt-0.5 text-blue-600 dark:text-blue-400">Нових CI за тиждень</p>
              </div>
              {sparkAdded.length >= 2 && (
                <div className="shrink-0 mt-1">
                  <Sparkline data={sparkAdded} color="#3b82f6" />
                </div>
              )}
            </div>
          </button>
        </div>
      </section>

      {loading && (
        <p className="text-gray-400 dark:text-slate-500 text-sm animate-pulse">Завантаження даних...</p>
      )}

      {/* ── CMDB vs Моніторинг ────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={sectionHead}>CMDB vs Моніторинг</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Всього ВМ в CMDB"
            value={comp.data?.total_vms ?? "—"}
            color="border-blue-500"
            sparkline={sparkTotal}
            sparklineColor="#3b82f6"
          />
          <StatCard
            title="В моніторингу"
            value={comp.data?.vm_monitored ?? "—"}
            sub={comp.data ? `${((comp.data.vm_monitored / comp.data.total_vms) * 100).toFixed(0)}% ВМ` : ""}
            color="border-green-500"
          />
          <StatCard
            title="Не моніторяться"
            value={comp.data?.vm_cmdb_only ?? "—"}
            sub="Є в CMDB, немає в Zabbix"
            color="border-yellow-500"
          />
          <StatCard
            title="Тіньові сервери"
            value={comp.data?.zabbix_only ?? "—"}
            sub="Є в Zabbix, немає в CMDB"
            color="border-red-500"
          />
        </div>
      </section>

      {/* ── Аналіз ресурсів ВМ ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={sectionHead}>Аналіз ресурсів ВМ</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard title="Оптимальні" value={res.data?.optimal ?? "—"} color="border-green-500" />
          <StatCard
            title="Oversized"
            value={res.data?.oversized ?? "—"}
            sub="Ресурсів більше ніж потрібно"
            color="border-blue-400"
          />
          <StatCard
            title="Undersized"
            value={res.data?.undersized ?? "—"}
            sub="Потребують більше ресурсів"
            color="border-red-400"
          />
          <StatCard
            title="Без даних"
            value={res.data?.no_data ?? "—"}
            sub="Немає метрик у Zabbix"
            color="border-gray-400"
          />
        </div>
        {overallAvg.cpu != null && (
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 border-blue-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Середній CPU % по всіх ВМ</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{overallAvg.cpu?.toFixed(1)}%</p>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 border-purple-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Середній RAM % по всіх ВМ</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{overallAvg.ram?.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Топ споживачів ────────────────────────────────────────────────────── */}
      {res.data && (
        <section className="mb-8">
          <h2 className={sectionHead}>Топ споживачів ресурсів (середнє за 30 днів)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList title="CPU %" items={topConsumers.cpu} color="bg-blue-500" />
            <TopList title="RAM %" items={topConsumers.ram} color="bg-purple-500" />
            <TopList title="Диск % (використано)" items={topConsumers.disk} color="bg-orange-400" />
          </div>
        </section>
      )}

      {/* ── Фізичні сервери ──────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={sectionHead}>Фізичні сервери</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Всього фіз. серверів" value={phys.data?.total ?? "—"} color="border-purple-500" />
          <StatCard
            title="Під моніторингом"
            value={phys.data?.monitored ?? "—"}
            sub={phys.data ? `${((phys.data.monitored / phys.data.total) * 100).toFixed(0)}% з Zabbix` : ""}
            color="border-green-500"
          />
          <StatCard
            title="Undersized фіз."
            value={phys.data?.items.filter((i) => i.resource_status === "undersized").length ?? "—"}
            sub="Потребують уваги"
            color="border-red-400"
          />
          <StatCard
            title="Oversized фіз."
            value={phys.data?.items.filter((i) => i.resource_status === "oversized").length ?? "—"}
            sub="Надлишок ресурсів"
            color="border-blue-300"
          />
        </div>
      </section>

      {/* ── Alert: ВМ потребують уваги ───────────────────────────────────────── */}
      {((res.data?.undersized ?? 0) > 0 || (res.data?.oversized ?? 0) > 0) && (
        <section className="mb-8">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Є ВМ що потребують уваги</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                {res.data?.undersized ?? 0} undersized · {res.data?.oversized ?? 0} oversized
              </p>
            </div>
            <button
              onClick={() => navigate("/problems")}
              className="text-sm px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition whitespace-nowrap"
            >
              Переглянути →
            </button>
          </div>
        </section>
      )}

      {/* ── Оптимізація ліцензій ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className={sectionHead}>Оптимізація ліцензій Windows DC</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Кластерів" value={cl.data?.total_clusters ?? "—"} color="border-purple-500" />
          <StatCard
            title="Змішаних кластерів"
            value={cl.data?.mixed_clusters ?? "—"}
            sub="Win + Linux"
            color="border-orange-400"
          />
          <StatCard
            title="Поточні ліцензії DC"
            value={cl.data?.total_current_licenses ?? "—"}
            sub="2-core packs"
            color="border-yellow-600"
          />
          <StatCard
            title="Економія після розбивки"
            value={cl.data?.total_savings ?? "—"}
            sub="2-core packs"
            color="border-green-600"
          />
        </div>
      </section>

      {/* ── Топ Zabbix-проблем ────────────────────────────────────────────────── */}
      {!zbxProbs.isLoading && !zbxProbs.isError && zbxTotal > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className={sectionHead}>Топ-5 хостів Zabbix за кількістю проблем</h2>
            <button onClick={() => navigate("/zabbix-problems")} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              Всі проблеми →
            </button>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left w-6">#</th>
                  <th className="px-4 py-2.5 text-left">Хост</th>
                  <th className="px-4 py-2.5 text-right">Катаст.</th>
                  <th className="px-4 py-2.5 text-right">Висока</th>
                  <th className="px-4 py-2.5 text-right">Середня</th>
                  <th className="px-4 py-2.5 text-right">Всього</th>
                  <th className="px-4 py-2.5 text-left">Макс. серйозність</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {topZbxHosts.map((h: ZabbixHostProblems, i) => (
                  <tr key={h.hostid} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200 max-w-xs truncate" title={h.host_name}>
                      {h.host_name}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {h.disaster > 0
                        ? <span className="font-bold text-red-700 dark:text-red-300">{h.disaster}</span>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {h.high > 0
                        ? <span className="font-semibold text-orange-600 dark:text-orange-300">{h.high}</span>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {h.average > 0
                        ? <span className="text-amber-600 dark:text-amber-300">{h.average}</span>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-gray-700 dark:text-slate-200">{h.total}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${SEV_COLOR[h.max_severity] ?? "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"}`}>
                        {SEV_LABEL[h.max_severity] ?? String(h.max_severity)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Проблемні ВМ (vCenter) ────────────────────────────────────────────── */}
      {showVcenterWidget && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className={sectionHead}>Проблемні ВМ (vCenter) — за 30 днів</h2>
            <button
              onClick={() => navigate("/vcenter")}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              vCenter Health →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* CPU Ready */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                CPU Ready % (Топ-10)
              </p>
              {topCpuReady.length === 0 ? (
                <p className="text-xs text-green-600 dark:text-green-400">Немає проблем</p>
              ) : (
                <div className="space-y-2">
                  {topCpuReady.map((item, i) => {
                    const pct = item.cpu_ready_pct!;
                    const isRed = pct >= 10;
                    return (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-slate-500 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 dark:text-slate-200 flex-1 truncate" title={item.name}>{item.name}</span>
                        <div className="w-16 bg-gray-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden shrink-0">
                          <div
                            className={`h-full rounded-full ${isRed ? "bg-red-500" : "bg-amber-400"}`}
                            style={{ width: `${Math.min(pct * 5, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium w-12 text-right shrink-0 ${isRed ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {pct.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Balloon / Swap */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Тиск пам'яті Balloon/Swap (Топ-10)
              </p>
              {topMemPressure.length === 0 ? (
                <p className="text-xs text-green-600 dark:text-green-400">Немає проблем</p>
              ) : (
                <div className="space-y-2">
                  {topMemPressure.map((item, i) => {
                    const balloon = item.mem_balloon_kb ?? 0;
                    const swapped = item.mem_swapped_kb ?? 0;
                    return (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-slate-500 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 dark:text-slate-200 flex-1 truncate" title={item.name}>{item.name}</span>
                        <div className="flex gap-1.5 text-xs shrink-0">
                          {balloon > 0 && (
                            <span className="font-medium text-orange-600 dark:text-orange-400" title="Balloon">
                              B:{fmtKb(balloon)}
                            </span>
                          )}
                          {swapped > 0 && (
                            <span className="font-medium text-red-600 dark:text-red-400" title="Swap">
                              S:{fmtKb(swapped)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Old snapshots */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Старі знімки (Топ-10)
              </p>
              {topSnapshots.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500">Знімків немає / не завантажено</p>
              ) : (
                <div className="space-y-2">
                  {topSnapshots.map((snap, i) => {
                    const ageColor =
                      snap.age_days >= 30 ? "text-red-600 dark:text-red-400" :
                      snap.age_days >= 7  ? "text-amber-600 dark:text-amber-400" :
                                            "text-green-600 dark:text-green-400";
                    return (
                      <div key={`${snap.vm_name}-${i}`} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-slate-500 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 dark:text-slate-200 flex-1 truncate" title={`${snap.vm_name} → ${snap.name}`}>
                          {snap.vm_name}
                        </span>
                        <span className={`text-xs font-medium shrink-0 ${ageColor}`}>
                          {snap.age_days === 0 ? "сьогодні" : `${snap.age_days}д`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Тренд навантаження кластера ───────────────────────────────────────── */}
      {cl.data && cl.data.items.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className={sectionHead}>Тренд навантаження кластера (90 днів)</h2>
            <div className="flex items-center gap-2">
              <select
                value={effectiveCluster ?? ""}
                onChange={(e) => setSelectedCluster(e.target.value || null)}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-400 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
              >
                {cl.data.items.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => navigate("/clusters")}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Всі кластери →
              </button>
            </div>
          </div>

          {clusterTrend.isLoading && (
            <p className="text-gray-400 dark:text-slate-500 text-sm animate-pulse">Завантаження...</p>
          )}

          {!clusterTrend.isLoading && !hasTrendData && (
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-6 text-center">
              <p className="text-gray-400 dark:text-slate-500 text-sm">
                Немає vCenter даних для кластера «{effectiveCluster}»
              </p>
            </div>
          )}

          {hasTrendData && (
            <>
              {(clusterTrend.data?.cpu_days_to_80 != null || clusterTrend.data?.ram_days_to_80 != null) && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {clusterTrend.data?.cpu_days_to_80 != null && (
                    <DaysToCard label="CPU → 80%" days={clusterTrend.data.cpu_days_to_80} accentColor="blue" />
                  )}
                  {clusterTrend.data?.ram_days_to_80 != null && (
                    <DaysToCard label="RAM → 80%" days={clusterTrend.data.ram_days_to_80} accentColor="purple" />
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    CPU % (середнє по кластеру)
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={trendPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} unit="%" width={35} />
                      <Tooltip
                        labelFormatter={formatTooltipLabel}
                        formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "CPU"]}
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                      />
                      <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" />
                      <Line
                        type="monotone" dataKey="avg_cpu_pct"
                        stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                    RAM % (середнє по кластеру)
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={trendPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} unit="%" width={35} />
                      <Tooltip
                        labelFormatter={formatTooltipLabel}
                        formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "RAM"]}
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                      />
                      <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" />
                      <Line
                        type="monotone" dataKey="avg_ram_pct"
                        stroke="#a855f7" dot={false} strokeWidth={2} connectNulls={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
