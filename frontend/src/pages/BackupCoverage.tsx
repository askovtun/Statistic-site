import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BackupCoverageItem } from "../api/client";

type CovFilter = "all" | "covered" | "not_covered";

function CovBadge({ has }: { has: boolean }) {
  return has
    ? <span className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-xs rounded-full font-medium">✓ є</span>
    : <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-xs rounded-full font-medium">✗ немає</span>;
}

export default function BackupCoverage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<CovFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["backup-coverage"],
    queryFn: api.backupCoverage,
    staleTime: 30 * 60 * 1000,
  });

  const items: BackupCoverageItem[] = data?.items ?? [];

  const filtered = items.filter((i) => {
    if (filter === "covered" && !i.has_backup) return false;
    if (filter === "not_covered" && i.has_backup) return false;
    if (typeFilter !== "all" && i.ci_type !== typeFilter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const coveragePct = data?.coverage_pct ?? 0;
  const coverageColor =
    coveragePct >= 90
      ? "text-green-600 dark:text-green-400"
      : coveragePct >= 70
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Backup Coverage</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            VM та сервери з backup-моніторингом у Zabbix (за групами хостів)
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["backup-coverage"] })}
          disabled={isFetching}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isFetching ? "Перевірка..." : "🔄 Оновити"}
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[140px]">
            <div className={`text-3xl font-bold ${coverageColor}`}>{coveragePct}%</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Покриття backup</div>
          </div>
          {[
            { label: "Всього CI",        value: data.total },
            { label: "З backup",         value: data.covered,     color: "text-green-600 dark:text-green-400" },
            { label: "Без backup",       value: data.not_covered, color: "text-red-600 dark:text-red-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[130px]">
              <div className={`text-2xl font-bold ${color || "text-gray-900 dark:text-white"}`}>{value}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Coverage bar */}
      {data && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400 mb-1.5">
            <span>Покриття backup</span>
            <span className={`font-semibold ${coverageColor}`}>{coveragePct}%</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all ${coveragePct >= 90 ? "bg-green-500" : coveragePct >= 70 ? "bg-amber-400" : "bg-red-500"}`}
              style={{ width: `${coveragePct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
            Визначається за ключовими словами у назвах груп Zabbix: backup, veeam, резервн, бекап
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {(["all", "not_covered", "covered"] as CovFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (filter === f
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            {f === "all" ? "Всі" : f === "covered" ? "✓ З backup" : "✗ Без backup"}
          </button>
        ))}
        {(["all", "vm", "physical"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (typeFilter === t
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            {t === "all" ? "VM + Фіз." : t === "vm" ? "💻 VM" : "🗄️ Фіз."}
          </button>
        ))}
        <input
          type="search"
          placeholder="Пошук..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{filtered.length} записів</span>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-12">Перевірка Zabbix груп...</div>}
      {isError && <div className="text-center text-red-500 py-12">Помилка завантаження.</div>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Назва</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Тип</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Backup</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Група Zabbix</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Статус CMDB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((i) => (
                <tr key={i.name} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-gray-800 dark:text-slate-200">{i.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">
                    {i.ci_type === "vm" ? "💻 VM" : "🗄️ Фіз."}
                  </td>
                  <td className="px-4 py-2"><CovBadge has={i.has_backup} /></td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300">
                    {i.backup_group || "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{i.cluster || "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{i.cmdb_status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
