import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type ResourceItem } from "../api/client";
import {
  ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

function StatCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: number | string;
  sub?: string;
  color: string;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 ${color} p-5`}>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function TopBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
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
    <div className="bg-white rounded-xl shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</p>
      <div className="space-y-2.5">
        {items.length === 0 && <p className="text-xs text-gray-400">Немає даних</p>}
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-4 text-right">{i + 1}</span>
            <span className="text-xs text-gray-700 w-40 truncate" title={item.name}>{item.name}</span>
            <TopBar pct={item.pct} color={color} />
            <span className="text-xs font-medium text-gray-600 w-10 text-right">
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
  const bg = urgent ? "bg-red-50 border-red-200" : warn ? "bg-amber-50 border-amber-200" : accentColor === "purple" ? "bg-purple-50 border-purple-200" : "bg-blue-50 border-blue-200";
  const textLabel = urgent ? "text-red-600" : warn ? "text-amber-600" : accentColor === "purple" ? "text-purple-600" : "text-blue-600";
  const textVal = urgent ? "text-red-800" : warn ? "text-amber-800" : accentColor === "purple" ? "text-purple-800" : "text-blue-800";
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

export default function Dashboard() {
  const navigate = useNavigate();
  const comp = useQuery({ queryKey: ["comparison"], queryFn: api.comparison });
  const res = useQuery({ queryKey: ["resources"], queryFn: () => api.resources() });
  const cl = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const phys = useQuery({ queryKey: ["physical-servers", 30], queryFn: () => api.physicalServers(30) });

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

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Дашборд</h1>
      <p className="text-sm text-gray-500 mb-8">Загальний стан інфраструктури</p>

      {loading && (
        <p className="text-gray-400 text-sm animate-pulse">Завантаження даних...</p>
      )}

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          CMDB vs Моніторинг
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Всього ВМ в CMDB" value={comp.data?.total_vms ?? "—"} color="border-blue-500" />
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

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Аналіз ресурсів ВМ
        </h2>
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
            <div className="bg-white rounded-xl shadow-sm border-l-4 border-blue-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500">Середній CPU % по всіх ВМ</p>
                <p className="text-2xl font-bold text-blue-700">{overallAvg.cpu?.toFixed(1)}%</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border-l-4 border-purple-300 p-4 flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-500">Середній RAM % по всіх ВМ</p>
                <p className="text-2xl font-bold text-purple-700">{overallAvg.ram?.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {res.data && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Топ споживачів ресурсів (середнє за 30 днів)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList title="CPU %" items={topConsumers.cpu} color="bg-blue-500" />
            <TopList title="RAM %" items={topConsumers.ram} color="bg-purple-500" />
            <TopList title="Диск % (використано)" items={topConsumers.disk} color="bg-orange-400" />
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Фізичні сервери
        </h2>
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

      {((res.data?.undersized ?? 0) > 0 || (res.data?.oversized ?? 0) > 0) && (
        <section className="mb-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-800">Є ВМ що потребують уваги</p>
              <p className="text-xs text-amber-600 mt-0.5">
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

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Оптимізація ліцензій Windows DC
        </h2>
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

      {/* ── Проблемні ВМ (vCenter) ────────────────────────────────────────────── */}
      {showVcenterWidget && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Проблемні ВМ (vCenter) — за 30 днів
            </h2>
            <button
              onClick={() => navigate("/vcenter")}
              className="text-xs text-blue-600 hover:underline"
            >
              vCenter Health →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* CPU Ready */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                CPU Ready % (Топ-10)
              </p>
              {topCpuReady.length === 0 ? (
                <p className="text-xs text-green-600">Немає проблем</p>
              ) : (
                <div className="space-y-2">
                  {topCpuReady.map((item, i) => {
                    const pct = item.cpu_ready_pct!;
                    const isRed = pct >= 10;
                    return (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 flex-1 truncate" title={item.name}>{item.name}</span>
                        <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden shrink-0">
                          <div
                            className={`h-full rounded-full ${isRed ? "bg-red-500" : "bg-amber-400"}`}
                            style={{ width: `${Math.min(pct * 5, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium w-12 text-right shrink-0 ${isRed ? "text-red-600" : "text-amber-600"}`}>
                          {pct.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Balloon / Swap */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Тиск пам'яті Balloon/Swap (Топ-10)
              </p>
              {topMemPressure.length === 0 ? (
                <p className="text-xs text-green-600">Немає проблем</p>
              ) : (
                <div className="space-y-2">
                  {topMemPressure.map((item, i) => {
                    const balloon = item.mem_balloon_kb ?? 0;
                    const swapped = item.mem_swapped_kb ?? 0;
                    return (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 flex-1 truncate" title={item.name}>{item.name}</span>
                        <div className="flex gap-1.5 text-xs shrink-0">
                          {balloon > 0 && (
                            <span className="font-medium text-orange-600" title="Balloon">
                              B:{fmtKb(balloon)}
                            </span>
                          )}
                          {swapped > 0 && (
                            <span className="font-medium text-red-600" title="Swap">
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
            <div className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Старі знімки (Топ-10)
              </p>
              {topSnapshots.length === 0 ? (
                <p className="text-xs text-gray-400">Знімків немає / не завантажено</p>
              ) : (
                <div className="space-y-2">
                  {topSnapshots.map((snap, i) => {
                    const ageColor =
                      snap.age_days >= 30 ? "text-red-600" :
                      snap.age_days >= 7  ? "text-amber-600" :
                                            "text-green-600";
                    return (
                      <div key={`${snap.vm_name}-${i}`} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-gray-700 flex-1 truncate" title={`${snap.vm_name} → ${snap.name}`}>
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
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Тренд навантаження кластера (90 днів)
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={effectiveCluster ?? ""}
                onChange={(e) => setSelectedCluster(e.target.value || null)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-400"
              >
                {cl.data.items.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => navigate("/clusters")}
                className="text-xs text-blue-600 hover:underline"
              >
                Всі кластери →
              </button>
            </div>
          </div>

          {clusterTrend.isLoading && (
            <p className="text-gray-400 text-sm animate-pulse">Завантаження...</p>
          )}

          {!clusterTrend.isLoading && !hasTrendData && (
            <div className="bg-white rounded-xl shadow-sm p-6 text-center">
              <p className="text-gray-400 text-sm">
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
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    CPU % (середнє по кластеру)
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={trendPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" width={35} />
                      <Tooltip
                        labelFormatter={formatTooltipLabel}
                        formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "CPU"]}
                      />
                      <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 2" />
                      <Line
                        type="monotone" dataKey="avg_cpu_pct"
                        stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    RAM % (середнє по кластеру)
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <ComposedChart data={trendPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" width={35} />
                      <Tooltip
                        labelFormatter={formatTooltipLabel}
                        formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "RAM"]}
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
