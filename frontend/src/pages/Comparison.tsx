import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ComparisonItem } from "../api/client";
import StatusBadge from "../components/StatusBadge";

const statusLabel: Record<ComparisonItem["comparison_status"], string> = {
  both: "✅ CMDB + Zabbix",
  cmdb_only: "⚠️ Тільки CMDB",
  zabbix_only: "⚠️ Тільки Zabbix",
};

const statusVariant = (s: ComparisonItem["comparison_status"]) =>
  s === "both" ? "success" : s === "cmdb_only" ? "warning" : "danger";

type FilterKey = "all" | ComparisonItem["comparison_status"];

export default function Comparison() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["comparison"],
    queryFn: api.comparison,
  });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const items = (data?.items ?? []).filter((i) => {
    if (filter !== "all" && i.comparison_status !== filter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">CMDB vs Zabbix</h1>
        <button
          onClick={() => refetch()}
          className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          Оновити
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Порівняння серверів з Jira CMDB та хостів у Zabbix моніторингу
      </p>

      {/* Summary chips */}
      {data && (
        <div className="flex gap-3 mb-5">
          {(
            [
              { key: "all", label: `Всі (${data.total})` },
              { key: "both", label: `Моніторяться (${data.monitored})` },
              { key: "cmdb_only", label: `Не в Zabbix (${data.cmdb_only})` },
              { key: "zabbix_only", label: `Тіньові (${data.zabbix_only})` },
            ] as { key: FilterKey; label: string }[]
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
                <th className="px-4 py-3 text-left">Назва</th>
                <th className="px-4 py-3 text-left">FQDN</th>
                <th className="px-4 py-3 text-left">Статус CMDB</th>
                <th className="px-4 py-3 text-left">Статус Zabbix</th>
                <th className="px-4 py-3 text-left">Результат</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{item.fqdn ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {item.cmdb_status ? (
                      <StatusBadge label={item.cmdb_status} variant="info" />
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {item.zabbix_status ? (
                      <StatusBadge
                        label={item.zabbix_status}
                        variant={item.zabbix_status === "enabled" ? "success" : "warning"}
                      />
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      label={statusLabel[item.comparison_status]}
                      variant={statusVariant(item.comparison_status)}
                    />
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
