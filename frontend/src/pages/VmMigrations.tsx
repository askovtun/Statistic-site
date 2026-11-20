import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

const PERIOD_OPTIONS = [
  { label: "30 днів", value: 30 },
  { label: "60 днів", value: 60 },
  { label: "90 днів", value: 90 },
];

function formatWeek(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

function SummaryCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border-l-4 ${color} p-4`}>
      <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function VmMigrations() {
  const [period, setPeriod] = useState(90);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vm-migrations", period],
    queryFn: () => api.vmMigrations(period),
    staleTime: 5 * 60 * 1000,
  });

  const topCluster = data?.cluster_flow[0];
  const uniqueClusters = new Set([
    ...(data?.cluster_flow.map(f => f.from_cluster) ?? []),
    ...(data?.cluster_flow.map(f => f.to_cluster) ?? []),
  ]).size;

  const filteredItems = (data?.items ?? []).filter(
    i => !search || i.vm_name.toLowerCase().includes(search.toLowerCase())
      || (i.from_cluster ?? "").toLowerCase().includes(search.toLowerCase())
      || (i.to_cluster ?? "").toLowerCase().includes(search.toLowerCase())
  );
  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, 50);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">Міграції VM (DRS)</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Переміщення ВМ між кластерами зафіксовані синхронізацією CMDB
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5">
          {PERIOD_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setPeriod(o.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                period === o.value
                  ? "bg-white dark:bg-slate-700 shadow text-blue-700 dark:text-blue-300 font-semibold"
                  : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm mb-6">
          Помилка завантаження даних
        </div>
      )}
      {isLoading && <p className="text-gray-400 dark:text-slate-500 animate-pulse text-sm mb-4">Завантаження...</p>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard label="Всього міграцій" value={data.total} color="border-blue-500" />
            <SummaryCard
              label="Унікальних ВМ"
              value={data.top_migrated_vms.length}
              sub="що мігрували хоч раз"
              color="border-purple-500"
            />
            <SummaryCard
              label="Кластерів задіяно"
              value={uniqueClusters}
              sub="джерело або ціль"
              color="border-amber-500"
            />
            <SummaryCard
              label="Найактивніший потік"
              value={topCluster ? topCluster.count : "—"}
              sub={topCluster ? `${topCluster.from_cluster} → ${topCluster.to_cluster}` : undefined}
              color="border-green-500"
            />
          </div>

          {/* Weekly activity chart */}
          {data.weekly_counts.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Тижнева активність міграцій
              </h2>
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.weekly_counts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="week_start"
                      tickFormatter={formatWeek}
                      tick={{ fontSize: 10, fill: "#9ca3af" }}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} width={28} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(ts: unknown) => formatWeek(Number(ts))}
                      formatter={(v: unknown) => [String(v), "Міграцій"] as [string, string]}
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Cluster flow */}
            {data.cluster_flow.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Потік між кластерами (топ-{Math.min(data.cluster_flow.length, 20)})
                </h2>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-slate-400 uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">З кластера</th>
                        <th className="px-4 py-2.5 text-left">До кластера</th>
                        <th className="px-4 py-2.5 text-right w-20">Разів</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {data.cluster_flow.map((f, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2 text-gray-700 dark:text-slate-200 font-mono text-xs">
                            {f.from_cluster}
                          </td>
                          <td className="px-4 py-2 text-gray-700 dark:text-slate-200 font-mono text-xs">
                            → {f.to_cluster}
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-blue-700 dark:text-blue-300">
                            {f.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Top migrated VMs */}
            {data.top_migrated_vms.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Найбільш мігровані ВМ (топ-{Math.min(data.top_migrated_vms.length, 20)})
                </h2>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-slate-400 uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">#</th>
                        <th className="px-4 py-2.5 text-left">VM</th>
                        <th className="px-4 py-2.5 text-right w-20">Міграцій</th>
                        <th className="px-4 py-2.5 text-left">Кластери</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {data.top_migrated_vms.slice(0, 20).map((vm, i) => (
                        <tr key={vm.name} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500">{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200 max-w-[200px] truncate" title={vm.name}>
                            {vm.name}
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-purple-700 dark:text-purple-300">
                            {vm.migration_count}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate" title={vm.clusters.join(" → ")}>
                            {vm.clusters.slice(0, 3).join(", ")}
                            {vm.clusters.length > 3 && ` +${vm.clusters.length - 3}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          {/* Full migration log */}
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                Лог міграцій ({data.total})
              </h2>
              <input
                type="text"
                placeholder="Пошук VM або кластера..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 w-60"
              />
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">VM</th>
                    <th className="px-4 py-2.5 text-left">З кластера</th>
                    <th className="px-4 py-2.5 text-left">До кластера</th>
                    <th className="px-4 py-2.5 text-left">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {visibleItems.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200 max-w-[220px] truncate" title={item.vm_name}>
                        {item.vm_name}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-500 dark:text-slate-400">
                        {item.from_cluster ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-blue-700 dark:text-blue-300">
                        {item.to_cluster ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">
                        {new Date(item.detected_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredItems.length > 50 && !showAll && (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 text-center">
                  <button
                    onClick={() => setShowAll(true)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Показати всі {filteredItems.length} записів
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
