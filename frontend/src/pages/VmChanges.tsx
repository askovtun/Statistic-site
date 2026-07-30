import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type VmChangeItem } from "../api/client";
import Pagination from "../components/Pagination";

const PAGE = 100;

const CHANGE_LABELS: Record<string, string> = {
  added:     "Додано",
  removed:   "Видалено",
  vcpu:      "CPU",
  vram_gb:   "RAM (ГБ)",
  cluster:   "Кластер",
  status:    "Статус",
  os_family: "ОС",
};

const CHANGE_COLORS: Record<string, string> = {
  added:     "bg-green-100 text-green-700 border-green-200",
  removed:   "bg-red-100 text-red-700 border-red-200",
  vcpu:      "bg-blue-100 text-blue-700 border-blue-200",
  vram_gb:   "bg-blue-100 text-blue-700 border-blue-200",
  cluster:   "bg-purple-100 text-purple-700 border-purple-200",
  status:    "bg-amber-100 text-amber-700 border-amber-200",
  os_family: "bg-gray-100 text-gray-700 border-gray-200",
};

const CHANGE_ROW_BG: Record<string, string> = {
  added:   "border-l-4 border-green-400",
  removed: "border-l-4 border-red-400",
};

function ChangeBadge({ type }: { type: string }) {
  const cls = CHANGE_COLORS[type] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {CHANGE_LABELS[type] ?? type}
    </span>
  );
}

function ValueChange({ item }: { item: VmChangeItem }) {
  if (item.change_type === "added") return <span className="text-xs text-green-700 font-medium">новий сервер</span>;
  if (item.change_type === "removed") return <span className="text-xs text-red-700 font-medium">видалено з CMDB</span>;
  return (
    <span className="text-xs text-gray-600 flex items-center gap-1.5">
      {item.old_value != null
        ? <span className="line-through text-gray-400">{item.old_value}</span>
        : <span className="text-gray-300 italic">пусто</span>}
      <span className="text-gray-400">→</span>
      {item.new_value != null
        ? <span className="font-medium text-gray-700">{item.new_value}</span>
        : <span className="text-gray-300 italic">пусто</span>}
    </span>
  );
}

function groupByDate(items: VmChangeItem[]): [string, VmChangeItem[]][] {
  const map = new Map<string, VmChangeItem[]>();
  for (const item of items) {
    const date = item.detected_at.slice(0, 10);
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(item);
  }
  return Array.from(map.entries());
}

export default function VmChanges() {
  const [days, setDays]             = useState(30);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(1);
  const [groupMode, setGroupMode]   = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vmChanges", days],
    queryFn:  () => api.vmChanges(days),
    staleTime: 60_000,
  });

  const changeTypes = ["all", "added", "removed", "vcpu", "vram_gb", "cluster", "status", "os_family"];

  const filtered = (data?.items ?? []).filter((i) => {
    if (typeFilter !== "all" && i.change_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        (i.old_value ?? "").toLowerCase().includes(q) ||
        (i.new_value ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageItems  = filtered.slice((page - 1) * PAGE, page * PAGE);
  const grouped    = groupByDate(pageItems);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Зміни в інфраструктурі</h1>
      <p className="text-sm text-gray-500 mb-6">
        Журнал змін конфігурації VM: CPU, RAM, кластер, статус, ОС — порівняння між синхронізаціями
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => { setDays(d); setPage(1); }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                days === d ? "bg-white shadow-sm text-blue-700" : "text-gray-600 hover:text-gray-800"
              }`}
            >
              {d} дн.
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          {changeTypes.map((t) => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setPage(1); }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                typeFilter === t
                  ? (CHANGE_COLORS[t] ?? "bg-gray-700 text-white border-gray-700")
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {t === "all" ? "Всі" : (CHANGE_LABELS[t] ?? t)}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Пошук за назвою VM..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="ml-auto w-full max-w-xs px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />

        <button
          onClick={() => setGroupMode((m) => !m)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
            groupMode ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-600"
          }`}
        >
          {groupMode ? "По даті" : "Списком"}
        </button>
      </div>

      {/* Stats */}
      {data && (
        <div className="flex gap-4 mb-5 text-sm text-gray-500">
          <span>Всього змін: <strong className="text-gray-800">{data.total}</strong></span>
          <span>Відфільтровано: <strong className="text-gray-800">{filtered.length}</strong></span>
          {data.total === 0 && (
            <span className="text-amber-600">Змін не знайдено — дані накопичуються після першого синку</span>
          )}
        </div>
      )}

      {isLoading && <div className="text-gray-400 py-8 text-center">Завантаження...</div>}
      {error    && <div className="text-red-500 py-4 text-sm">Помилка: {String(error)}</div>}

      {/* Table */}
      {!isLoading && filtered.length > 0 && (
        <>
          {groupMode ? (
            <div className="space-y-6">
              {grouped.map(([date, dayItems]) => (
                <div key={date}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-700">
                      {new Date(date).toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    <span className="text-xs text-gray-400">{dayItems.length} змін</span>
                    <hr className="flex-1 border-gray-200" />
                  </div>
                  <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {dayItems.map((item) => (
                          <tr
                            key={item.id}
                            className={`transition-colors hover:bg-gray-50 ${CHANGE_ROW_BG[item.change_type] ?? ""}`}
                          >
                            <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap w-64">
                              {item.name}
                            </td>
                            <td className="px-3 py-2.5 w-32">
                              <ChangeBadge type={item.change_type} />
                            </td>
                            <td className="px-3 py-2.5">
                              <ValueChange item={item} />
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap text-right">
                              {new Date(item.detected_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">VM</th>
                      <th className="px-4 py-3 text-left">Зміна</th>
                      <th className="px-4 py-3 text-left">Значення</th>
                      <th className="px-4 py-3 text-left whitespace-nowrap">Виявлено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageItems.map((item) => (
                      <tr
                        key={item.id}
                        className={`transition-colors hover:bg-gray-50 ${CHANGE_ROW_BG[item.change_type] ?? ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                          {item.name}
                        </td>
                        <td className="px-4 py-2.5">
                          <ChangeBadge type={item.change_type} />
                        </td>
                        <td className="px-4 py-2.5">
                          <ValueChange item={item} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(item.detected_at).toLocaleString("uk-UA")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filtered.length > PAGE && (
            <>
              <p className="text-center text-xs text-gray-400 mt-3">
                {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, filtered.length)} з {filtered.length}
              </p>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </>
      )}

      {!isLoading && filtered.length === 0 && data && data.total > 0 && (
        <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено за вибраними фільтрами</p>
      )}
    </div>
  );
}
