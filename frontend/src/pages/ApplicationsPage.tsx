import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppItem } from "../api/client";

type Tab = "applications" | "it_services";

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const l = status.toLowerCase();
  const color =
    l.includes("active") || l.includes("активн")
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : l.includes("decom") || l.includes("виведен") || l.includes("archived")
      ? "bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-400"
      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{status}</span>;
}

export default function ApplicationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("applications");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["cmdb-applications"],
    queryFn: api.cmdbApplications,
  });

  const items: AppItem[] =
    tab === "applications" ? (data?.applications ?? []) : (data?.it_services ?? []);

  const filtered = search
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Застосунки & IT-сервіси</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Застосунки (Application) та IT-сервіси з Jira CMDB
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["cmdb-applications"] })}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isFetching ? "Завантаження..." : "🔄 Оновити"}
        </button>
      </div>

      {/* Totals */}
      {data && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Застосунків",   value: data.total_apps,     key: "applications" as Tab },
            { label: "IT-сервісів",   value: data.total_services, key: "it_services" as Tab },
          ].map(({ label, value, key }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                "text-left bg-white dark:bg-slate-900 border rounded-xl p-4 min-w-[140px] transition " +
                (tab === key
                  ? "border-blue-500 ring-1 ring-blue-500"
                  : "border-gray-200 dark:border-slate-800 hover:border-blue-300")
              }
            >
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-800">
        {(["applications", "it_services"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 transition -mb-px " +
              (tab === t
                ? "border-blue-600 text-blue-700 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200")
            }
          >
            {t === "applications" ? "Application" : "IT Service"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Пошук..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{filtered.length} записів</span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Завантаження з Jira CMDB...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження Jira CMDB.</div>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Назва</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Статус</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Jira ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((item, i) => (
                <tr key={item.jira_id} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200">{item.name}</td>
                  <td className="px-4 py-2">{statusBadge(item.status)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-400 dark:text-slate-500">{item.jira_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          Об'єктів не знайдено у Jira CMDB
        </div>
      )}
    </div>
  );
}
