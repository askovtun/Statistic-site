import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ResourceItem } from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";

const PAGE = 50;

function pctBadge(pct: number | null, warn = 30, crit = 10) {
  if (pct === null) return <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>;
  const cls = pct <= crit
    ? "text-red-600 dark:text-red-400 font-semibold"
    : pct <= warn
    ? "text-amber-600 dark:text-amber-400"
    : "text-gray-600 dark:text-slate-300";
  return <span className={`text-xs tabular-nums ${cls}`}>{pct.toFixed(1)}%</span>;
}

export default function RightsizingPage() {
  const [period, setPeriod]   = useState(30);
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const [cpuThresh, setCpuThresh] = useState(15);
  const [ramThresh, setRamThresh] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["resources", period],
    queryFn: () => api.resources(period),
    staleTime: 5 * 60 * 1000,
  });

  const oversized = useMemo<ResourceItem[]>(() => {
    return (data?.items ?? []).filter((i) => {
      const cpuLow = i.avg_cpu_pct !== null && i.avg_cpu_pct < cpuThresh;
      const ramLow = i.avg_ram_pct !== null && i.avg_ram_pct < ramThresh;
      const vcCpuLow = i.vc_avg_cpu_pct !== null && i.vc_avg_cpu_pct < cpuThresh;
      const vcRamLow = i.vc_avg_ram_pct !== null && i.vc_avg_ram_pct < ramThresh;
      return (cpuLow || vcCpuLow) && (ramLow || vcRamLow);
    });
  }, [data, cpuThresh, ramThresh]);

  const savings = useMemo(() => {
    return oversized.reduce(
      (acc, i) => {
        const cpuSave = (i.vcpu ?? 0) - (i.recommended_vcpu ?? i.vcpu ?? 0);
        const ramSave = (i.vram_gb ?? 0) - (i.recommended_vram_gb ?? i.vram_gb ?? 0);
        return { vcpu: acc.vcpu + Math.max(0, cpuSave), vram: acc.vram + Math.max(0, ramSave) };
      },
      { vcpu: 0, vram: 0 }
    );
  }, [oversized]);

  const filtered = oversized.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.name.toLowerCase().includes(q) ||
      (i.cluster ?? "").toLowerCase().includes(q) ||
      (i.primary_ip ?? "").includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageItems  = filtered.slice((page - 1) * PAGE, page * PAGE);

  function handleExport() {
    exportToXlsx(
      `rightsizing-${period}d.xlsx`,
      "Rightsizing",
      oversized.map((i) => ({
        "Назва ВМ":       i.name,
        "Кластер":        i.cluster ?? "",
        "IP":             i.primary_ip ?? "",
        "vCPU (зараз)":   i.vcpu ?? "",
        "RAM GB (зараз)": i.vram_gb ?? "",
        "Рек. vCPU":      i.recommended_vcpu ?? "",
        "Рек. RAM GB":    i.recommended_vram_gb ?? "",
        "Avg CPU %":      i.avg_cpu_pct?.toFixed(1) ?? "",
        "Max CPU %":      i.max_cpu_pct?.toFixed(1) ?? "",
        "Avg RAM %":      i.avg_ram_pct?.toFixed(1) ?? "",
        "Max RAM %":      i.max_ram_pct?.toFixed(1) ?? "",
        "VC Avg CPU %":   i.vc_avg_cpu_pct?.toFixed(1) ?? "",
        "VC Avg RAM %":   i.vc_avg_ram_pct?.toFixed(1) ?? "",
        "Статус":         i.resource_status,
      })),
    );
  }

  if (isLoading) return (
    <div className="p-8 space-y-4 animate-pulse">
      <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[0,1,2].map(i => <div key={i} className="h-20 bg-gray-200 dark:bg-slate-700 rounded-xl" />)}
      </div>
      <div className="h-64 bg-gray-100 dark:bg-slate-800 rounded-xl" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 print:p-2">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">VM Rightsizing</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            ВМ з надлишковими ресурсами — потенційна економія vCPU/RAM
            {data?.synced_at && (
              <span className="ml-2 text-gray-400">· оновлено {new Date(data.synced_at).toLocaleString("uk-UA")}</span>
            )}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="print:hidden px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
        >
          Експорт XLSX ↓
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border-2 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{oversized.length}</p>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-0.5">Oversized ВМ</p>
          <p className="text-xs text-blue-500 opacity-70">CPU &lt; {cpuThresh}% і RAM &lt; {ramThresh}%</p>
        </div>
        <div className="rounded-xl border-2 border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-4">
          <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">−{savings.vcpu}</p>
          <p className="text-sm font-medium text-purple-600 dark:text-purple-400 mt-0.5">vCPU економія</p>
          <p className="text-xs text-purple-500 opacity-70">якщо знизити до рекомендацій</p>
        </div>
        <div className="rounded-xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
          <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">−{savings.vram} GB</p>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">RAM економія</p>
          <p className="text-xs text-indigo-500 opacity-70">якщо знизити до рекомендацій</p>
        </div>
        <div className="rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-2xl font-bold text-gray-700 dark:text-slate-200">{data?.total ?? 0}</p>
          <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mt-0.5">Всього ВМ</p>
          <p className="text-xs text-gray-400 opacity-70">{period}-денний аналіз</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4 print:hidden">
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
          Період:
          <select
            value={period}
            onChange={(e) => { setPeriod(+e.target.value); setPage(1); }}
            className="text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
          >
            <option value={7}>7 днів</option>
            <option value={14}>14 днів</option>
            <option value={30}>30 днів</option>
            <option value={90}>90 днів</option>
          </select>
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
          CPU &lt;
          <input
            type="number" min={1} max={50} value={cpuThresh}
            onChange={(e) => { setCpuThresh(+e.target.value); setPage(1); }}
            className="w-12 text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
          />
          %
        </label>
        <label className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-2">
          RAM &lt;
          <input
            type="number" min={1} max={80} value={ramThresh}
            onChange={(e) => { setRamThresh(+e.target.value); setPage(1); }}
            className="w-12 text-xs border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200"
          />
          %
        </label>
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Пошук ВМ / IP / кластер..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 focus:outline-none focus:border-blue-400"
          />
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">{filtered.length} ВМ</span>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
          <p className="text-gray-400 dark:text-slate-500 text-sm">
            {oversized.length === 0
              ? "Не знайдено ВМ, що відповідають критеріям oversized. Спробуйте змінити пороги або збільшити період аналізу."
              : "Немає результатів за пошуком."}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left">ВМ</th>
                  <th className="px-4 py-2.5 text-left">Кластер</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">vCPU зараз</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Рек. vCPU</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">RAM GB зараз</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Рек. RAM</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Avg CPU %</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Max CPU %</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Avg RAM %</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Max RAM %</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">VC CPU %</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">VC RAM %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageItems.map((i) => {
                  const cpuSave = (i.vcpu ?? 0) - (i.recommended_vcpu ?? i.vcpu ?? 0);
                  const ramSave = (i.vram_gb ?? 0) - (i.recommended_vram_gb ?? i.vram_gb ?? 0);
                  return (
                    <tr key={i.name} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800 dark:text-slate-100 whitespace-nowrap">{i.name}</div>
                        {i.primary_ip && <div className="text-xs text-gray-400 dark:text-slate-500">{i.primary_ip}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400">{i.cluster ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-xs font-medium text-gray-700 dark:text-slate-200 tabular-nums">{i.vcpu ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">
                        {i.recommended_vcpu ? (
                          <span className={cpuSave > 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-gray-500 dark:text-slate-400"}>
                            {i.recommended_vcpu}{cpuSave > 0 && <span className="text-green-500 ml-1">−{cpuSave}</span>}
                          </span>
                        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-medium text-gray-700 dark:text-slate-200 tabular-nums">{i.vram_gb ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-xs tabular-nums">
                        {i.recommended_vram_gb ? (
                          <span className={ramSave > 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-gray-500 dark:text-slate-400"}>
                            {i.recommended_vram_gb}{ramSave > 0 && <span className="text-green-500 ml-1">−{ramSave}</span>}
                          </span>
                        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.avg_cpu_pct, 15, 5)}</td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.max_cpu_pct, 30, 15)}</td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.avg_ram_pct, 30, 15)}</td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.max_ram_pct, 50, 30)}</td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.vc_avg_cpu_pct, 15, 5)}</td>
                      <td className="px-4 py-2 text-right">{pctBadge(i.vc_avg_ram_pct, 30, 15)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs text-gray-400 dark:text-slate-500">
              <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, filtered.length)} з {filtered.length}</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800">←</button>
                <span className="px-2 py-1">{page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800">→</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 text-xs text-gray-400 dark:text-slate-500 space-y-1">
        <p>* Oversized = avg CPU &lt; {cpuThresh}% <b>і</b> avg RAM &lt; {ramThresh}% за {period} днів (Zabbix або vCenter).</p>
        <p>* Рекомендація vCPU/RAM розраховується аналізатором на основі peak використання з коефіцієнтом 2×.</p>
      </div>
    </div>
  );
}
