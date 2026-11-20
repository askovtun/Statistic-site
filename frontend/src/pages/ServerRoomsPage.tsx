import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ServerRoomItem } from "../api/client";

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400 dark:text-slate-500">—</span>;
  const l = status.toLowerCase();
  const color =
    l.includes("active") || l.includes("активн")
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : l.includes("decom") || l.includes("виведен")
      ? "bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-400"
      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{status}</span>;
}

export default function ServerRoomsPage() {
  const qc = useQueryClient();
  const [siteFilter, setSiteFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["cmdb-server-rooms"],
    queryFn: api.serverRooms,
  });

  const rooms: ServerRoomItem[] = data?.server_rooms ?? [];
  const sites = Array.from(new Set(rooms.map((r) => r.site || "—"))).sort();

  const filtered = rooms.filter((r) => {
    if (siteFilter !== "all" && (r.site || "—") !== siteFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by site for display
  const bySite: Record<string, ServerRoomItem[]> = {};
  for (const r of filtered) {
    const site = r.site || "—";
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(r);
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Серверні кімнати</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Server Room об'єкти з Jira CMDB, прив'язані до сайтів
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["cmdb-server-rooms"] })}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isFetching ? "Завантаження..." : "🔄 Оновити"}
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[140px]">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.total}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Серверних кімнат</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[140px]">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {new Set(rooms.map((r) => r.site).filter(Boolean)).size}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Унікальних сайтів</div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[140px]">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {rooms.filter((r) => !r.site).length}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Без сайту</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">Всі сайти</option>
          {sites.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Пошук кімнати..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{filtered.length} кімнат</span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Завантаження з Jira CMDB...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження.</div>}

      {/* Grouped by site */}
      {!isLoading && !isError && (
        <div className="space-y-4">
          {Object.entries(bySite).sort(([a], [b]) => a.localeCompare(b)).map(([site, siteRooms]) => (
            <div key={site} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 dark:bg-slate-900/50 border-b border-gray-100 dark:border-slate-800">
                <span className="text-sm">🏢</span>
                <span className="font-semibold text-gray-800 dark:text-slate-200 text-sm">{site}</span>
                <span className="ml-auto text-xs text-gray-400 dark:text-slate-500">{siteRooms.length} кімнат</span>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-slate-800/60">
                {siteRooms.map((r) => (
                  <div key={r.jira_id} className="flex items-center gap-4 px-5 py-3">
                    <span className="text-sm">🖥️</span>
                    <span className="flex-1 text-sm font-medium text-gray-800 dark:text-slate-200">{r.name}</span>
                    {statusBadge(r.status)}
                    <span className="font-mono text-xs text-gray-400 dark:text-slate-500">{r.jira_id}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !isError && rooms.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          Серверних кімнат не знайдено у Jira CMDB
        </div>
      )}
    </div>
  );
}
