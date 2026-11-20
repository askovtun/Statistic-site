import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { NetworkDeviceItem } from "../api/client";

const DEVICE_ICONS: Record<string, string> = {
  Router:   "🔀",
  Switch:   "🔌",
  Firewall: "🛡️",
  AP:       "📶",
};

const TYPE_COLORS: Record<string, string> = {
  Router:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  Switch:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  Firewall: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  AP:       "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};

export default function NetworkInventory() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["cmdb-network"],
    queryFn: api.cmdbNetwork,
  });

  const devices: NetworkDeviceItem[] = data?.devices ?? [];
  const types = Object.keys(data?.by_type ?? {});

  const filtered = devices.filter((d) => {
    if (typeFilter !== "all" && d.device_type !== typeFilter) return false;
    if (locationFilter !== "all" && (d.location || "—") !== locationFilter) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Мережевий інвентар</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Router, Switch, Firewall, AP із Jira CMDB — згруповані по локаціях
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["cmdb-network"] })}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isFetching ? "Завантаження..." : "🔄 Оновити"}
        </button>
      </div>

      {/* By type summary */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[120px]">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.total}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Всього пристроїв</div>
          </div>
          {Object.entries(data.by_type).map(([type, count]) => (
            <div
              key={type}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[120px]"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span>{DEVICE_ICONS[type] || "🖧"}</span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{count}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">{type}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top locations */}
      {data && Object.keys(data.by_location).length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Топ локацій</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.by_location).slice(0, 10).map(([loc, count]) => (
              <button
                key={loc}
                onClick={() => setLocationFilter(loc === locationFilter ? "all" : loc)}
                className={
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition " +
                  (locationFilter === loc
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
                }
              >
                <span className="font-bold">{count}</span>
                <span>{loc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setTypeFilter("all")}
          className={
            "px-3 py-1.5 rounded-lg text-sm border transition " +
            (typeFilter === "all"
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
          }
        >
          Всі типи
        </button>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (typeFilter === t
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            {DEVICE_ICONS[t] || ""} {t}
          </button>
        ))}
        <input
          type="search"
          placeholder="Пошук пристрою..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{filtered.length} пристроїв</span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Завантаження з Jira CMDB...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження.</div>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Назва</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Тип</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Локація</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Jira ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((d) => (
                <tr key={d.jira_id} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200">{d.name}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[d.device_type] || "bg-gray-100 text-gray-600"}`}>
                      {DEVICE_ICONS[d.device_type] || ""} {d.device_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300">{d.location || "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{d.status || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-400 dark:text-slate-500">{d.jira_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && devices.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          Мережевих пристроїв не знайдено у Jira CMDB
        </div>
      )}
    </div>
  );
}
