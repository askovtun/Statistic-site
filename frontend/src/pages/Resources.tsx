import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ResourceItem } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import ResourceBar from "../components/ResourceBar";

const statusVariant = (s: ResourceItem["resource_status"]) => {
  switch (s) {
    case "optimal": return "success";
    case "oversized": return "info";
    case "undersized": return "danger";
    default: return "neutral";
  }
};

const statusLabel: Record<ResourceItem["resource_status"], string> = {
  optimal: "Оптимально",
  oversized: "Oversized",
  undersized: "Undersized",
  no_data: "Немає даних",
};

export default function Resources() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["resources", days],
    queryFn: () => api.resources(days),
  });

  const [filter, setFilter] = useState<ResourceItem["resource_status"] | "all">("all");
  const [search, setSearch] = useState("");

  const items = (data?.items ?? []).filter((i) => {
    if (filter !== "all" && i.resource_status !== filter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Аналіз ресурсів ВМ</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500">
            Період:&nbsp;
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value={7}>7 днів</option>
              <option value={14}>14 днів</option>
              <option value={30}>30 днів</option>
              <option value={90}>90 днів</option>
            </select>
          </label>
          <button
            onClick={() => refetch()}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Оновити
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Середнє використання CPU / RAM на основі Zabbix за останні {days} днів
      </p>

      {data && (
        <div className="flex gap-3 mb-5">
          {(
            [
              { key: "all", label: `Всі (${data.total})` },
              { key: "optimal", label: `Оптимальні (${data.optimal})` },
              { key: "oversized", label: `Oversized (${data.oversized})` },
              { key: "undersized", label: `Undersized (${data.undersized})` },
              { key: "no_data", label: `Без даних (${data.no_data})` },
            ] as { key: typeof filter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ` +
                (filter === key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="Пошук за назвою..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />

      {isLoading && <p className="text-gray-400 animate-pulse">Завантаження...</p>}
      {error && <p className="text-red-500 text-sm">Помилка: {String(error)}</p>}

      {!isLoading && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ВМ</th>
                <th className="px-4 py-3 text-left">Кластер</th>
                <th className="px-4 py-3 text-left">OS</th>
                <th className="px-4 py-3 text-left">vCPU</th>
                <th className="px-4 py-3 text-left">vRAM</th>
                <th className="px-4 py-3 text-left w-36">CPU %</th>
                <th className="px-4 py-3 text-left w-36">RAM %</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Рекомендації</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{item.cluster ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{item.os_family ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center">{item.vcpu ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    {item.vram_gb != null ? `${item.vram_gb} GB` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResourceBar pct={item.avg_cpu_pct} />
                  </td>
                  <td className="px-4 py-2.5">
                    <ResourceBar pct={item.avg_ram_pct} />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      label={statusLabel[item.resource_status]}
                      variant={statusVariant(item.resource_status)}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-xs">
                    {item.recommendations.length > 0 ? (
                      <ul className="space-y-0.5">
                        {item.recommendations.map((r, i) => (
                          <li key={i} className="text-xs">{r}</li>
                        ))}
                      </ul>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">Нічого не знайдено</p>
          )}
        </div>
      )}
    </div>
  );
}
