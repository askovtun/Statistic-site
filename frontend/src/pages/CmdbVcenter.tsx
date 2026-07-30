import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type CmdbVcenterDiffItem } from "../api/client";

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterTab = "all" | "diff" | "vcpu" | "vram" | "cluster" | "cmdb_only" | "vm" | "physical";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all",       label: "Всі" },
  { id: "diff",      label: "З відмінностями" },
  { id: "vcpu",      label: "vCPU" },
  { id: "vram",      label: "RAM (ГБ)" },
  { id: "cluster",   label: "Кластер" },
  { id: "cmdb_only", label: "Тільки CMDB" },
  { id: "vm",        label: "Лише VM" },
  { id: "physical",  label: "Лише фізичні" },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

function DiffCell({
  cmdb,
  vc,
  hasDiff,
  suffix = "",
}: {
  cmdb: string | number | null;
  vc: string | number | null;
  hasDiff: boolean;
  suffix?: string;
}) {
  const fmt = (v: string | number | null) =>
    v != null ? `${v}${suffix}` : "—";

  if (!hasDiff) {
    return (
      <td className="px-4 py-2.5 text-sm text-gray-700 text-center">
        {fmt(cmdb)}
      </td>
    );
  }

  return (
    <td className="px-4 py-2.5">
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 leading-tight">
          CMDB: {fmt(cmdb)}
        </span>
        <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-300 rounded px-1.5 py-0.5 leading-tight">
          vCenter: {fmt(vc)}
        </span>
      </div>
    </td>
  );
}

function PowerBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-gray-400 text-xs">—</span>;
  const on = state === "poweredOn";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${
        on ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-green-500" : "bg-gray-400"}`} />
      {on ? "Увімк." : "Вимк."}
    </span>
  );
}

function DiffBadge({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-gray-400">ОК</span>;
  return (
    <span className="inline-block bg-red-100 text-red-700 border border-red-300 text-xs font-bold px-2 py-0.5 rounded-full">
      {count}
    </span>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "amber" | "red" | "gray";
}) {
  const palettes = {
    blue:  "bg-blue-50 border-blue-200 text-blue-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red:   "bg-red-50 border-red-200 text-red-700",
    gray:  "bg-gray-50 border-gray-200 text-gray-600",
  };
  return (
    <div className={`rounded-xl border px-5 py-4 ${palettes[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-75">{label}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function CmdbVcenter() {
  const [tab, setTab]         = useState<FilterTab>("diff");
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cmdb-vcenter-diff"],
    queryFn:  api.cmdbVcenterDiff,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let items: CmdbVcenterDiffItem[] = [...data.items];

    if (tab === "diff")          items = items.filter((i) => i.diff_count > 0);
    else if (tab === "vcpu")     items = items.filter((i) => i.vcpu_diff);
    else if (tab === "vram")     items = items.filter((i) => i.vram_diff);
    else if (tab === "cluster")  items = items.filter((i) => i.cluster_diff);
    else if (tab === "cmdb_only") items = items.filter((i) => !i.in_vcenter);
    else if (tab === "vm")       items = items.filter((i) => i.ci_type === "vm");
    else if (tab === "physical") items = items.filter((i) => i.ci_type === "physical");

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.fqdn ?? "").toLowerCase().includes(q) ||
          (i.primary_ip ?? "").toLowerCase().includes(q) ||
          (i.cmdb_cluster ?? "").toLowerCase().includes(q),
      );
    }

    return items;
  }, [data, tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleTabChange = (t: FilterTab) => {
    setTab(t);
    setPage(1);
  };
  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  if (isLoading) return <div className="p-8 text-gray-400 animate-pulse">Завантаження...</div>;
  if (error)     return <div className="p-8 text-red-500 text-sm">Помилка: {String(error)}</div>;
  if (!data)     return null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Порівняння CMDB vs vCenter</h1>
        <p className="text-sm text-gray-500 mt-1">
          Параметри серверів з CMDB та vCenter — виявлення розбіжностей у конфігурації
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        <SummaryCard label="Усього серверів CMDB"  value={data.total}           color="blue"  />
        <SummaryCard label="Знайдено у vCenter"    value={data.matched}         color="blue"  />
        <SummaryCard label="Тільки CMDB"           value={data.cmdb_only}       color="gray"  />
        <SummaryCard label="З відмінностями"       value={data.with_diff}       color="red"   />
        <SummaryCard label="Розбіжність vCPU"      value={data.vcpu_diff_count} color="amber" />
        <SummaryCard label="Розбіжність RAM"       value={data.vram_diff_count} color="amber" />
        <SummaryCard label="Розбіжність кластеру"  value={data.cluster_diff_count} color="amber" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                tab === t.id
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Пошук по назві, IP, кластеру..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400 w-64"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {filtered.length} записів
          </span>
          <span className="text-xs text-gray-400">
            Помаранчевий = значення CMDB · Синій = значення vCenter
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-semibold">Сервер</th>
                <th className="px-4 py-3 text-center font-semibold">Різниць</th>
                <th className="px-4 py-3 text-center font-semibold">vCPU</th>
                <th className="px-4 py-3 text-center font-semibold">RAM (ГБ)</th>
                <th className="px-4 py-3 text-left font-semibold">Кластер</th>
                <th className="px-4 py-3 text-left font-semibold">Стан vCenter</th>
                <th className="px-4 py-3 text-left font-semibold">IP / FQDN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    Нічого не знайдено
                  </td>
                </tr>
              ) : (
                pageItems.map((item) => (
                  <tr
                    key={item.name}
                    className={`hover:bg-gray-50 transition-colors ${
                      item.diff_count > 0
                        ? "border-l-4 border-l-amber-400"
                        : !item.in_vcenter
                        ? "border-l-4 border-l-gray-300 opacity-60"
                        : ""
                    }`}
                  >
                    {/* Server name */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          item.ci_type === "physical"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {item.ci_type === "physical" ? "ФІЗИЧ." : "VM"}
                        </span>
                        <p className="font-medium text-gray-800 truncate">{item.name}</p>
                      </div>
                      {item.cmdb_status && (
                        <p className="text-xs text-gray-400 mt-0.5 pl-10">{item.cmdb_status}</p>
                      )}
                    </td>

                    {/* Diff count */}
                    <td className="px-4 py-2.5 text-center">
                      {item.in_vcenter ? (
                        <DiffBadge count={item.diff_count} />
                      ) : (
                        <span className="text-xs text-gray-400 italic">Не в vCenter</span>
                      )}
                    </td>

                    {/* vCPU */}
                    <DiffCell
                      cmdb={item.cmdb_vcpu}
                      vc={item.vc_vcpu}
                      hasDiff={item.vcpu_diff}
                    />

                    {/* RAM */}
                    <DiffCell
                      cmdb={item.cmdb_vram_gb}
                      vc={item.vc_vram_gb}
                      hasDiff={item.vram_diff}
                      suffix=" ГБ"
                    />

                    {/* Cluster */}
                    <td className="px-4 py-2.5">
                      {item.cluster_diff ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">
                            CMDB: {item.cmdb_cluster ?? "—"}
                          </span>
                          <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-300 rounded px-1.5 py-0.5">
                            vCenter: {item.vc_cluster ?? "—"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-700">
                          {item.cmdb_cluster ?? item.vc_cluster ?? "—"}
                        </span>
                      )}
                    </td>

                    {/* vCenter power state */}
                    <td className="px-4 py-2.5">
                      <PowerBadge state={item.vc_power_state} />
                    </td>

                    {/* IP / FQDN */}
                    <td className="px-4 py-2.5">
                      <p className="text-xs text-gray-600">{item.primary_ip ?? "—"}</p>
                      {item.fqdn && item.fqdn !== item.primary_ip && (
                        <p className="text-xs text-gray-400 truncate max-w-[160px]" title={item.fqdn}>
                          {item.fqdn}
                        </p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Сторінка {page} з {totalPages}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-50"
              >
                ← Назад
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-300 text-xs disabled:opacity-40 hover:bg-gray-50"
              >
                Вперед →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-l-4 border-l-amber-400 inline-block" />
          Є відмінності
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-l-4 border-l-gray-300 opacity-60 inline-block" />
          Тільки в CMDB (немає у vCenter)
        </span>
      </div>
    </div>
  );
}
