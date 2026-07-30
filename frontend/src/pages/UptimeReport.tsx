import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type UptimeItem } from "../api/client";

const PAGE_SIZE = 100;

function UptimeBadge({ days }: { days: number | null }) {
  if (days == null) return <span className="text-gray-300 text-xs">—</span>;
  const color =
    days > 365 ? "bg-red-100 text-red-700" :
    days > 90  ? "bg-amber-100 text-amber-700" :
                 "bg-green-100 text-green-700";
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${color}`}>
      {days} дн.
    </span>
  );
}

function StateChip({ state }: { state: string }) {
  if (state === "poweredOn")
    return <span className="inline-block text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">Увімкнена</span>;
  if (state === "poweredOff")
    return <span className="inline-block text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">Вимкнена</span>;
  return <span className="text-xs text-gray-400">{state}</span>;
}

type FilterState = "all" | "long_running" | "powered_off" | "short_uptime";

export default function UptimeReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["uptime"],
    queryFn: api.uptime,
  });

  const [filter, setFilter] = useState<FilterState>("all");
  const [search, setSearch] = useState("");
  const [cluster, setCluster] = useState("");
  const [page, setPage] = useState(1);

  const items = data?.items ?? [];

  const clusters = useMemo(() =>
    Array.from(new Set(items.map((i) => i.cluster).filter((c): c is string => !!c))).sort()
  , [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filter === "long_running" && (i.uptime_days ?? 0) <= 365) return false;
      if (filter === "powered_off" && i.power_state !== "poweredOff") return false;
      if (filter === "short_uptime" && ((i.uptime_days ?? 999) > 30 || i.power_state !== "poweredOn")) return false;
      if (cluster && i.cluster !== cluster) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!i.name.toLowerCase().includes(q) && !(i.cluster ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, search, cluster]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (isLoading) return (
    <div className="p-6"><p className="text-gray-400 animate-pulse">Завантаження...</p></div>
  );
  if (error) return (
    <div className="p-6"><p className="text-red-500 text-sm">Помилка: {String(error)}</p></div>
  );

  const longRunning = (data?.long_running ?? 0);
  const poweredOff  = (data?.powered_off  ?? 0);
  const poweredOn   = (data?.powered_on   ?? 0);
  const shortUptime = items.filter((i) => i.power_state === "poweredOn" && (i.uptime_days ?? 999) <= 30).length;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Аптайм ВМ</h1>
      <p className="text-sm text-gray-500 mb-5">
        Скільки днів ВМ не перезавантажувалась (за boot_time з vCenter)
        {data?.synced_at && (
          <span className="ml-2 text-gray-400">
            · Дані: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-gray-800">{data?.total ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-0.5">Всього ВМ</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-green-700">{poweredOn}</p>
          <p className="text-xs text-green-600 mt-0.5">Увімкнених</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-red-700">{longRunning}</p>
          <p className="text-xs text-red-600 mt-0.5">Аптайм &gt;365 днів</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-gray-600">{poweredOff}</p>
          <p className="text-xs text-gray-500 mt-0.5">Вимкнених</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {([
          { key: "all",          label: `Всі (${items.length})` },
          { key: "long_running", label: `Аптайм >365 дн. (${longRunning})` },
          { key: "powered_off",  label: `Вимкнені (${poweredOff})` },
          { key: "short_uptime", label: `Нещодавно перезавантажені (${shortUptime})` },
        ] as { key: FilterState; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setFilter(key); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ` +
              (filter === key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search + cluster filter */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Пошук за назвою..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-400"
        />
        <select
          value={cluster}
          onChange={(e) => { setCluster(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value="">Всі кластери</option>
          {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <th className="px-4 py-3 text-left">Стан</th>
                <th className="px-4 py-3 text-right">Аптайм</th>
                <th className="px-4 py-3 text-left">Останній boot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400">Немає даних</td>
                </tr>
              ) : (
                pageItems.map((item: UptimeItem) => (
                  <tr key={item.name} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{item.cluster ?? "—"}</td>
                    <td className="px-4 py-2.5"><StateChip state={item.power_state} /></td>
                    <td className="px-4 py-2.5 text-right"><UptimeBadge days={item.uptime_days} /></td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {item.boot_time
                        ? new Date(item.boot_time).toLocaleString("uk-UA", {
                            day: "2-digit", month: "2-digit", year: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>Сторінка {page} з {totalPages}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
              >←</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40"
              >→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
