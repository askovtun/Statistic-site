import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DecommissionItem } from "../api/client";

const SCORE_COLORS: Record<number, string> = {
  3: "bg-red-100 text-red-700 border-red-200",
  2: "bg-amber-100 text-amber-700 border-amber-200",
  1: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

function ScoreBadge({ score }: { score: number }) {
  const cls = SCORE_COLORS[score] ?? "bg-gray-100 text-gray-600";
  const label = score === 3 ? "Критично" : score === 2 ? "Увага" : "Можливо";
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {label} ({score}/3)
    </span>
  );
}

function PowerChip({ state }: { state: string }) {
  if (state === "poweredOn")
    return <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" title="Увімкнена" />;
  if (state === "poweredOff")
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1" title="Вимкнена" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1" title={state} />;
}

export default function DecommissionPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["decommission"],
    queryFn: api.decommissionCandidates,
  });

  const [search, setSearch]   = useState("");
  const [cluster, setCluster] = useState("");
  const [minScore, setMinScore] = useState<number>(2);

  const items = data?.items ?? [];

  const clusters = useMemo(() =>
    Array.from(new Set(items.map((i) => i.cluster).filter((c): c is string => !!c))).sort()
  , [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (i.decommission_score < minScore) return false;
      if (cluster && i.cluster !== cluster) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !i.name.toLowerCase().includes(q) &&
          !(i.fqdn ?? "").toLowerCase().includes(q) &&
          !(i.primary_ip ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [items, search, cluster, minScore]);

  const critical3 = items.filter((i) => i.decommission_score === 3).length;
  const warn2     = items.filter((i) => i.decommission_score === 2).length;

  if (isLoading) return (
    <div className="p-6"><p className="text-gray-400 animate-pulse">Завантаження...</p></div>
  );
  if (error) return (
    <div className="p-6"><p className="text-red-500 text-sm">Помилка: {String(error)}</p></div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Кандидати на виведення</h1>
      <p className="text-sm text-gray-500 mb-5">
        ВМ що відповідають 2+ критеріям: вимкнена / немає Zabbix-моніторингу / неактивний статус CMDB
        {data?.synced_at && (
          <span className="ml-2 text-gray-400">
            · Дані: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Criteria legend */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-800">
        <p className="font-semibold mb-1">Критерії (кожна ВМ отримує 0–3 балів):</p>
        <ul className="list-disc pl-4 space-y-0.5 text-xs text-amber-700">
          <li><b>+1</b> — ВМ вимкнена (poweredOff)</li>
          <li><b>+1</b> — відсутня в Zabbix-моніторингу</li>
          <li><b>+1</b> — статус в CMDB не є «Active»</li>
        </ul>
        <p className="mt-1.5 text-xs text-amber-600">Показуються ВМ з рейтингом ≥2.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-gray-800">{data?.total ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-0.5">Всього кандидатів</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-red-700">{critical3}</p>
          <p className="text-xs text-red-600 mt-0.5">Критично (3/3)</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-700">{warn2}</p>
          <p className="text-xs text-amber-600 mt-0.5">Увага (2/3)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Пошук за назвою / IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-400"
        />
        <select
          value={cluster}
          onChange={(e) => setCluster(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value="">Всі кластери</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value={3}>Тільки критичні (3/3)</option>
          <option value={2}>Увага + критичні (≥2/3)</option>
        </select>
        <span className="text-sm text-gray-400 self-center">{filtered.length} ВМ</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ВМ</th>
                <th className="px-4 py-3 text-left">Кластер</th>
                <th className="px-4 py-3 text-left">IP / FQDN</th>
                <th className="px-4 py-3 text-left">Стан</th>
                <th className="px-4 py-3 text-left">Статус CMDB</th>
                <th className="px-4 py-3 text-center">Zabbix</th>
                <th className="px-4 py-3 text-left">Рейтинг</th>
                <th className="px-4 py-3 text-left">Причини</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">Немає кандидатів</td>
                </tr>
              ) : (
                filtered.map((item: DecommissionItem) => (
                  <tr key={item.name} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{item.cluster ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {item.primary_ip ?? item.fqdn ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <PowerChip state={item.power_state} />
                      {item.power_state === "poweredOff" ? "Вимкнена" : item.power_state}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{item.cmdb_status ?? "—"}</td>
                    <td className="px-4 py-2.5 text-center text-xs">
                      {item.in_zabbix
                        ? <span className="text-green-600 font-medium">Є</span>
                        : <span className="text-red-500 font-medium">Немає</span>}
                    </td>
                    <td className="px-4 py-2.5"><ScoreBadge score={item.decommission_score} /></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs">
                      {item.reasons.join(" · ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
