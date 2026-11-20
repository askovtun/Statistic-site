import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { DatastoreItem } from "../api/client";

function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : pct >= 60 ? "bg-amber-400" : "bg-green-500";
  const textColor =
    pct >= 90 ? "text-red-600 dark:text-red-400" : pct >= 75 ? "text-orange-600 dark:text-orange-400" : pct >= 60 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2 w-28">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold ${textColor} w-10 text-right tabular-nums`}>{pct}%</span>
    </div>
  );
}

function formatGb(gb: number | null): string {
  if (gb === null) return "—";
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TiB`;
  return `${gb} GiB`;
}

export default function DatastoresPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vcenter-datastores"],
    queryFn: api.datastores,
  });

  const refresh = useMutation({
    mutationFn: api.refreshDatastores,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vcenter-datastores"] }),
  });

  const datastores: DatastoreItem[] = data?.datastores ?? [];
  const criticalCount = datastores.filter((d) => (d.used_pct ?? 0) >= 90).length;
  const warningCount = datastores.filter((d) => (d.used_pct ?? 0) >= 75 && (d.used_pct ?? 0) < 90).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Datastores</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Сховища vCenter — ємність, вільне місце, заповненість
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition disabled:opacity-50"
        >
          {refresh.isPending ? "Завантаження..." : "🔄 Оновити з vCenter"}
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Datastores",          value: data.total },
            { label: "Загальна ємність",    value: formatGb(data.total_capacity_gb) },
            { label: "Вільно",              value: formatGb(data.total_free_gb) },
            { label: "Використано",         value: data.overall_used_pct != null ? `${data.overall_used_pct}%` : "—",
              warn: (data.overall_used_pct ?? 0) >= 75 },
            { label: "Критично (>90%)",     value: criticalCount, warn: criticalCount > 0 },
            { label: "Попередження (>75%)", value: warningCount,  warn: warningCount > 0 },
          ].map(({ label, value, warn }) => (
            <div key={label} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[130px]">
              <div className={`text-2xl font-bold ${warn ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                {value}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="text-center text-gray-400 py-12">
          Завантаження. Натисніть «Оновити з vCenter» для першого завантаження.
        </div>
      )}
      {isError && (
        <div className="text-center text-red-500 py-12">
          Помилка. Натисніть «Оновити з vCenter».
        </div>
      )}

      {datastores.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Datastore</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Тип</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">Ємність</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-slate-300">Вільно</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Заповненість</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-slate-300">Доступний</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {datastores.map((d) => (
                <tr
                  key={d.name}
                  className={
                    "hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors" +
                    ((d.used_pct ?? 0) >= 90 ? " bg-red-50/30 dark:bg-red-900/10" : "")
                  }
                >
                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-slate-200 max-w-[220px] truncate" title={d.name}>
                    {d.name}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{d.datastore_type || "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300">{d.cluster || "—"}</td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-gray-700 dark:text-slate-300 tabular-nums">
                    {formatGb(d.capacity_gb)}
                  </td>
                  <td className="px-4 py-2 text-right text-xs font-mono text-gray-700 dark:text-slate-300 tabular-nums">
                    {formatGb(d.free_gb)}
                  </td>
                  <td className="px-4 py-2"><UsageBar pct={d.used_pct ?? null} /></td>
                  <td className="px-4 py-2 text-center text-xs">
                    {d.accessible
                      ? <span className="text-green-600 dark:text-green-400">✓</span>
                      : <span className="text-red-600 dark:text-red-400 font-bold">✗</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && datastores.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          <div className="text-4xl mb-3">💾</div>
          <div>Натисніть «Оновити з vCenter» для завантаження datastores.</div>
        </div>
      )}
    </div>
  );
}
