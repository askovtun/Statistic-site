import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PowerStateVm } from "../api/client";

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400 dark:text-slate-500">—</span>;
  const lower = status.toLowerCase();
  const color =
    lower.includes("active") || lower.includes("активн")
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : lower.includes("decom") || lower.includes("виведен") || lower.includes("retired")
      ? "bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-400"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{status}</span>
  );
}

export default function PowerStatePage() {
  const [search, setSearch] = useState("");
  const [clusterFilter, setClusterFilter] = useState("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["power-state"],
    queryFn: api.powerState,
  });

  const vms: PowerStateVm[] = data?.vms ?? [];
  const clusters = Array.from(new Set(vms.map((v) => v.cluster || "—"))).sort();

  const filtered = vms.filter((v) => {
    if (clusterFilter !== "all" && (v.cluster || "—") !== clusterFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return v.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Power State Report</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            VM вимкнені у vCenter, але не позначені як Decommissioned у CMDB
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
            { label: "Всього вимкнено у vCenter", value: data.total_off },
            { label: "Не деком у CMDB", value: data.not_decommissioned, warn: data.not_decommissioned > 0 },
          ].map(({ label, value, warn }) => (
            <div
              key={label}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[180px]"
            >
              <div className={`text-2xl font-bold ${warn ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                {value}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* By cluster */}
      {data && Object.keys(data.by_cluster).length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">По кластерах</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.by_cluster)
              .sort(([, a], [, b]) => b - a)
              .map(([cluster, count]) => (
                <div
                  key={cluster}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs"
                >
                  <span className="font-medium text-red-700 dark:text-red-300">{count}</span>
                  <span className="text-red-600 dark:text-red-400">{cluster}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={clusterFilter}
          onChange={(e) => setClusterFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">Всі кластери</option>
          {clusters.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Пошук VM..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">
          {filtered.length} VM
        </span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Завантаження...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження.</div>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">VM</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">CMDB статус</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">vCPU</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">vRAM GB</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Остання поява</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((v) => (
                <tr key={v.name} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700 dark:text-blue-400">{v.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-300">{v.cluster || "—"}</td>
                  <td className="px-4 py-3">{statusBadge(v.cmdb_status)}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700 dark:text-slate-300">
                    {v.vcpu ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-700 dark:text-slate-300">
                    {v.vram_gb ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500">
                    {v.boot_time ? new Date(v.boot_time).toLocaleDateString("uk-UA") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && vms.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          <div className="text-4xl mb-3">✅</div>
          <div>Всі вимкнені VM позначені як Decommissioned — дані чисті!</div>
        </div>
      )}
    </div>
  );
}
