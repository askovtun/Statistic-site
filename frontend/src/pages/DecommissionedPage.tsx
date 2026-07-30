import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type DecommissionedCIItem } from "../api/client";

function ZabbixModal({
  items,
  onClose,
}: {
  items: DecommissionedCIItem[];
  onClose: () => void;
}) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-amber-700 flex items-center gap-2">
              <span className="text-lg">⚠</span> Виведені CI в Zabbix-моніторингу
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {items.length} CI зі статусом Decommissioned ще присутні в Zabbix — рекомендується їх прибрати
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-amber-50 text-xs text-amber-800 uppercase">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Назва</th>
                <th className="px-4 py-2.5 text-left font-semibold">Тип</th>
                <th className="px-4 py-2.5 text-left font-semibold">Кластер / Локація</th>
                <th className="px-4 py-2.5 text-left font-semibold">IP / FQDN</th>
                <th className="px-4 py-2.5 text-left font-semibold">Оновлено CMDB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={`${item.ci_type}-${item.name}`} className="hover:bg-amber-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                  <td className="px-4 py-2.5">
                    {item.ci_type === "vm"
                      ? <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded">ВМ</span>
                      : <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded">Фіз.</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{item.cluster ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{item.primary_ip ?? item.fqdn ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{formatDate(item.jira_updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm text-gray-600 transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}

function PowerChip({ state }: { state: string }) {
  if (state === "poweredOn")
    return <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" title="Увімкнена" />;
  if (state === "poweredOff")
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1.5" title="Вимкнена" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1.5" title="Невідомо" />;
}

function TypeChip({ type }: { type: "vm" | "physical" }) {
  return type === "vm"
    ? <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded">ВМ</span>
    : <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded">Фіз.</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("uk-UA");
}

export default function DecommissionedPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["decommissioned"],
    queryFn: api.decommissioned,
  });

  const [search, setSearch]       = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "vm" | "physical">("all");
  const [clusterFilter, setClusterFilter] = useState("");
  const [showZabbixModal, setShowZabbixModal] = useState(false);

  const items = data?.items ?? [];

  const zabbixItems = useMemo(() => items.filter((i) => i.in_zabbix), [items]);

  const clusters = useMemo(() =>
    Array.from(new Set(items.map((i) => i.cluster).filter((c): c is string => !!c))).sort()
  , [items]);

  const filtered = useMemo(() => items.filter((i) => {
    if (typeFilter !== "all" && i.ci_type !== typeFilter) return false;
    if (clusterFilter && i.cluster !== clusterFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !i.name.toLowerCase().includes(q) &&
        !(i.fqdn ?? "").toLowerCase().includes(q) &&
        !(i.primary_ip ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }), [items, search, typeFilter, clusterFilter]);

  if (isLoading) return <div className="p-6"><p className="text-gray-400 animate-pulse">Завантаження...</p></div>;
  if (error)     return <div className="p-6"><p className="text-red-500 text-sm">Помилка: {String(error)}</p></div>;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Виведені з експлуатації</h1>
      <p className="text-sm text-gray-500 mb-5">
        CI зі статусом «Decommissioned» в CMDB — виключені з усіх інших звітів
        {data?.synced_at && (
          <span className="ml-2 text-gray-400">
            · Дані: {new Date(data.synced_at).toLocaleString("uk-UA")}
          </span>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-2xl font-bold text-gray-800">{(data?.total_vms ?? 0) + (data?.total_physical ?? 0)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Всього CI</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-blue-700">{data?.total_vms ?? 0}</p>
          <p className="text-xs text-blue-600 mt-0.5">Віртуальних машин</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-purple-700">{data?.total_physical ?? 0}</p>
          <p className="text-xs text-purple-600 mt-0.5">Фізичних серверів</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Пошук за назвою / IP / FQDN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-blue-400"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
        >
          <option value="all">Всі типи</option>
          <option value="vm">Тільки ВМ</option>
          <option value="physical">Тільки фізичні</option>
        </select>
        {clusters.length > 0 && (
          <select
            value={clusterFilter}
            onChange={(e) => setClusterFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          >
            <option value="">Всі кластери / локації</option>
            {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span className="text-sm text-gray-400 self-center">{filtered.length} записів</span>
      </div>

      {items.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-700 text-sm">
          В CMDB немає CI зі статусом «Decommissioned»
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Назва</th>
                  <th className="px-4 py-3 text-left">Тип</th>
                  <th className="px-4 py-3 text-left">Кластер / Локація</th>
                  <th className="px-4 py-3 text-left">IP / FQDN</th>
                  <th className="px-4 py-3 text-left">ОС</th>
                  <th className="px-4 py-3 text-left">Стан (vCenter)</th>
                  <th className="px-4 py-3 text-center">Zabbix</th>
                  <th className="px-4 py-3 text-left">Статус CMDB</th>
                  <th className="px-4 py-3 text-left">Оновлено CMDB</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-gray-400">Немає записів за фільтром</td>
                  </tr>
                ) : (
                  filtered.map((item: DecommissionedCIItem) => (
                    <tr key={`${item.ci_type}-${item.name}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{item.name}</td>
                      <td className="px-4 py-2.5"><TypeChip type={item.ci_type} /></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{item.cluster ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {item.primary_ip ?? item.fqdn ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{item.os_family ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {item.ci_type === "vm" ? (
                          <span className="flex items-center">
                            <PowerChip state={item.power_state} />
                            {item.power_state === "poweredOff" ? "Вимкнена"
                              : item.power_state === "poweredOn" ? "Увімкнена"
                              : "Невідомо"}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs">
                        {item.in_zabbix
                          ? <span className="text-amber-600 font-medium">Є ⚠</span>
                          : <span className="text-gray-400">Немає</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {item.cmdb_status ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">
                        {formatDate(item.jira_updated)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Note about Zabbix — clickable */}
      {zabbixItems.length > 0 && (
        <button
          onClick={() => setShowZabbixModal(true)}
          className="mt-3 flex items-center gap-2 text-xs text-amber-600 hover:text-amber-800 hover:underline transition-colors text-left"
        >
          <span className="text-sm">⚠</span>
          <span>
            {zabbixItems.length} виведених CI ще присутні в Zabbix-моніторингу — рекомендується їх прибрати.
            <span className="ml-1 font-medium underline">Переглянути список →</span>
          </span>
        </button>
      )}

      {showZabbixModal && (
        <ZabbixModal items={zabbixItems} onClose={() => setShowZabbixModal(false)} />
      )}
    </div>
  );
}
