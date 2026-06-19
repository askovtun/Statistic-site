import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ClusterItem } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import ForecastModal from "../components/ForecastModal";
import ClusterVmsModal from "../components/ClusterVmsModal";
import { exportToXlsx } from "../utils/exportXlsx";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const PAGE_SIZE = 50;

function OsPieChart({ win, lin, other }: { win: number; lin: number; other: number }) {
  const data = [
    { name: "Windows", value: win, color: "#3b82f6" },
    { name: "Linux", value: lin, color: "#22c55e" },
    { name: "Інше", value: other, color: "#d1d5db" },
  ].filter((d) => d.value > 0);

  return (
    <ResponsiveContainer width={60} height={60}>
      <PieChart>
        <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={28} strokeWidth={0}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(v, n) => [`${v} ВМ`, n]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ClusterCard({ item, onForecast, onVms }: { item: ClusterItem; onForecast: () => void; onVms: () => void }) {
  const hasSavings = item.license_savings > 0;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="font-semibold text-gray-800">{item.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {item.host_count} хостів · {item.total_cpu_cores ?? "?"} cores · {item.total_vms} ВМ
          </p>
        </div>
        <OsPieChart win={item.windows_vms} lin={item.linux_vms} other={item.other_vms} />
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        {item.windows_vms > 0 && (
          <StatusBadge label={`Windows: ${item.windows_vms} (${item.windows_pct}%)`} variant="info" />
        )}
        {item.linux_vms > 0 && (
          <StatusBadge label={`Linux: ${item.linux_vms} (${item.linux_pct}%)`} variant="success" />
        )}
        {item.other_vms > 0 && (
          <StatusBadge label={`Інше: ${item.other_vms}`} variant="neutral" />
        )}
      </div>

      <div className="text-sm border-t border-gray-100 pt-3">
        <p className="text-gray-500">
          Поточні ліцензії DC:&nbsp;
          <span className="font-semibold text-gray-700">{item.current_dc_licenses}</span>
          &nbsp;×&nbsp;2-core pack
          &nbsp;(~${item.current_dc_cost_usd.toLocaleString("en-US")})
        </p>
        {hasSavings && (
          <p className="text-gray-500 mt-0.5">
            Після розбивки:&nbsp;
            <span className="font-semibold text-green-600">{item.optimized_dc_licenses}</span>
            &nbsp;(економія&nbsp;
            <span className="font-semibold text-green-600">{item.license_savings}</span>
            &nbsp;ліцензій, ~${item.savings_usd.toLocaleString("en-US")})
          </p>
        )}
      </div>

      {item.recommendation && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          💡 {item.recommendation}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onVms}
          className="flex-1 text-xs text-purple-600 border border-purple-200 rounded-lg py-1.5 hover:bg-purple-50 transition-colors"
        >
          ВМ кластера →
        </button>
        <button
          onClick={onForecast}
          className="flex-1 text-xs text-blue-600 border border-blue-200 rounded-lg py-1.5 hover:bg-blue-50 transition-colors"
        >
          Прогноз →
        </button>
      </div>
    </div>
  );
}

export default function Clusters() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["clusters"],
    queryFn: api.clusters,
  });
  const [page, setPage] = useState(1);
  const [forecastCluster, setForecastCluster] = useState<string | null>(null);
  const [vmsCluster, setVmsCluster] = useState<string | null>(null);

  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleExport() {
    const rows = items.map((i) => ({
      "Кластер": i.name,
      "Хостів": i.host_count ?? "",
      "CPU cores": i.total_cpu_cores ?? "",
      "ВМ всього": i.total_vms,
      "Windows ВМ": i.windows_vms,
      "Linux ВМ": i.linux_vms,
      "Інше ВМ": i.other_vms,
      "Windows %": i.windows_pct,
      "Linux %": i.linux_pct,
      "Поточні ліцензії DC": i.current_dc_licenses,
      "Оптимізовані ліцензії DC": i.optimized_dc_licenses,
      "Економія ліцензій": i.license_savings,
      "Поточна вартість $": i.current_dc_cost_usd,
      "Оптимізована вартість $": i.optimized_dc_cost_usd,
      "Економія $": i.savings_usd,
      "Рекомендація": i.recommendation ?? "",
    }));
    exportToXlsx(
      `clusters_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Кластери",
      rows
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Оптимізація кластерів</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
          >
            Експорт в Excel
          </button>
          <button
            onClick={() => refetch()}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Оновити
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Розподіл Windows/Linux ВМ по кластерах та рекомендації щодо ліцензування Windows Datacenter
      </p>

      {data && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-purple-500 px-5 py-4">
            <p className="text-xs text-gray-500">Кластерів</p>
            <p className="text-2xl font-bold">{data.total_clusters}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-orange-400 px-5 py-4">
            <p className="text-xs text-gray-500">Змішаних (Win+Linux)</p>
            <p className="text-2xl font-bold">{data.mixed_clusters}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-yellow-500 px-5 py-4">
            <p className="text-xs text-gray-500">Поточні ліцензії DC</p>
            <p className="text-2xl font-bold">{data.total_current_licenses}</p>
            <p className="text-xs text-gray-400">
              2-core packs · ~${data.total_current_cost_usd.toLocaleString("en-US")}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border-l-4 border-green-500 px-5 py-4">
            <p className="text-xs text-gray-500">Потенційна економія</p>
            <p className="text-2xl font-bold text-green-600">{data.total_savings}</p>
            <p className="text-xs text-gray-400">
              2-core packs · ~${data.total_savings_usd.toLocaleString("en-US")}
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pageItems.map((item) => (
          <ClusterCard key={item.name} item={item} onForecast={() => setForecastCluster(item.name)} onVms={() => setVmsCluster(item.name)} />
        ))}
      </div>

      {forecastCluster && (
        <ForecastModal clusterName={forecastCluster} onClose={() => setForecastCluster(null)} />
      )}
      {vmsCluster && (
        <ClusterVmsModal clusterName={vmsCluster} onClose={() => setVmsCluster(null)} />
      )}

      {!isLoading && items.length > 0 && (
        <>
          <p className="text-center text-xs text-gray-400 mt-3">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, items.length)} з {items.length}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
