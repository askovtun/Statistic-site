import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { api } from "../api/client";
import type { HostDistItem } from "../api/client";

function usageColor(pct: number | null): string {
  if (pct === null) return "#94a3b8";
  if (pct >= 80) return "#dc2626";
  if (pct >= 60) return "#f59e0b";
  return "#22c55e";
}

function PctBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const color = pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-amber-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 w-full max-w-[120px]">
      <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-600 dark:text-slate-300 w-10 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export default function HostDistribution() {
  const [clusterFilter, setClusterFilter] = useState("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["host-distribution"],
    queryFn: api.hostDistribution,
  });

  const hosts: HostDistItem[] = data?.hosts ?? [];
  const clusters = Array.from(new Set(hosts.map((h) => h.cluster || "—"))).sort();

  const filtered = hosts.filter((h) => clusterFilter === "all" || (h.cluster || "—") === clusterFilter);

  const chartData = filtered
    .slice()
    .sort((a, b) => b.vm_count - a.vm_count)
    .slice(0, 20)
    .map((h) => ({
      name: h.host_name.split(".")[0],
      "VM": h.vm_count,
      cpu: h.cpu_usage_pct ?? 0,
    }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Розподіл по хостах</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Кількість VM та завантаженість по кожному ESXi хосту
          </p>
        </div>
        {data?.synced_at && (
          <div className="text-xs text-gray-400 dark:text-slate-500">
            Дані на: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </div>
        )}
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Хостів",        value: hosts.length },
            { label: "VM із map",     value: data.total_vms_mapped },
            { label: "Середньо VM/хост", value: hosts.length ? Math.round(data.total_vms_mapped / hosts.length) : 0 },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[140px]">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cluster filter */}
      {clusters.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setClusterFilter("all")}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (clusterFilter === "all"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            Всі кластери
          </button>
          {clusters.map((c) => (
            <button
              key={c}
              onClick={() => setClusterFilter(c)}
              className={
                "px-3 py-1.5 rounded-lg text-sm border transition " +
                (clusterFilter === c
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
              }
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="h-64 flex items-center justify-center text-gray-400">Завантаження...</div>}
      {isError && <div className="h-64 flex items-center justify-center text-red-500">Помилка завантаження.</div>}

      {/* Bar chart: VM count per host */}
      {!isLoading && !isError && chartData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">VM на хост (топ-20)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                angle={-45}
                textAnchor="end"
              />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                cursor={{ fill: "rgba(100,116,139,0.07)" }}
              />
              <Bar dataKey="VM" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={usageColor(entry.cpu)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
            Колір стовпця відображає CPU завантаженість хоста (зелений &lt;60%, жовтий 60-80%, червоний &gt;80%)
          </p>
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Хост</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">VM</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">CPU</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">RAM</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">Ядра</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">RAM GB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((h) => (
                <tr key={h.host_name} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800 dark:text-slate-200">{h.host_name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{h.cluster || "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-bold text-blue-600 dark:text-blue-400">{h.vm_count}</span>
                  </td>
                  <td className="px-4 py-2"><PctBar pct={h.cpu_usage_pct ?? null} /></td>
                  <td className="px-4 py-2"><PctBar pct={h.mem_usage_pct ?? null} /></td>
                  <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">{h.num_cpu_cores ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">{h.memory_gb ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && hosts.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          Немає даних ESXi хостів. Запустіть синхронізацію vCenter.
        </div>
      )}
    </div>
  );
}
