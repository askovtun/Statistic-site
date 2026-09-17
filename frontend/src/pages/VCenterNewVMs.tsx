import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type VCenterNewVM, type ImportResult } from "../api/client";

const PAGE_SIZE = 100;

function PowerBadge({ state }: { state: string | null }) {
  if (state === "poweredOn")
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">● Увімкнена</span>;
  if (state === "poweredOff")
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400">○ Вимкнена</span>;
  if (state === "suspended")
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">⏸ Призупинена</span>;
  return <span className="text-xs text-gray-400">{state ?? "—"}</span>;
}

type ImportStatus = { type: "idle" } | { type: "loading" } | { type: "done"; result: ImportResult } | { type: "error"; msg: string };

export default function VCenterNewVMs() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["vcenter-new-vms"],
    queryFn: api.vcenterNewVMs,
  });

  const [search, setSearch]         = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [page, setPage]             = useState(1);
  const [importStatus, setImportStatus] = useState<ImportStatus>({ type: "idle" });

  const items = data?.items ?? [];

  const filtered = useMemo(() => {
    return items.filter((vm) => {
      if (onlyActive && vm.power_state !== "poweredOn") return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !vm.vc_name.toLowerCase().includes(q) &&
          !vm.cmdb_name.toLowerCase().includes(q) &&
          !(vm.cluster ?? "").toLowerCase().includes(q) &&
          !(vm.guest_hostname ?? "").toLowerCase().includes(q) &&
          !(vm.guest_ip ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [items, search, onlyActive]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allOnPage    = pageItems.every((vm) => selected.has(vm.moid));
  const someOnPage   = pageItems.some((vm) => selected.has(vm.moid));

  function toggleAll() {
    if (allOnPage) {
      setSelected((s) => {
        const n = new Set(s);
        pageItems.forEach((vm) => n.delete(vm.moid));
        return n;
      });
    } else {
      setSelected((s) => {
        const n = new Set(s);
        pageItems.forEach((vm) => n.add(vm.moid));
        return n;
      });
    }
  }

  function toggleOne(moid: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(moid)) n.delete(moid); else n.add(moid);
      return n;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((vm) => vm.moid)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleImport() {
    const moids = [...selected];
    if (!moids.length) return;
    setImportStatus({ type: "loading" });
    try {
      const result = await api.importVCenterVMs(moids);
      setImportStatus({ type: "done", result });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["vcenter-new-vms"] });
    } catch (err) {
      setImportStatus({ type: "error", msg: String(err) });
    }
  }

  if (isLoading) return (
    <div className="p-6"><p className="text-gray-400 animate-pulse">Завантаження...</p></div>
  );
  if (error) return (
    <div className="p-6">
      <p className="text-red-500 text-sm">Помилка: {String(error)}</p>
    </div>
  );

  const totalVcenter = data?.total_vcenter ?? 0;
  const notInCmdb   = data?.not_in_cmdb   ?? 0;
  const inCmdb      = totalVcenter - notInCmdb;
  const poweredOn   = items.filter((vm) => vm.power_state === "poweredOn").length;

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header */}
      <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-1">
        Нові ВМ з vCenter
      </h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
        Віртуальні машини, які існують у vCenter але відсутні в CMDB (створені більше 1 тижня тому). Можна імпортувати їх автоматично.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Всього у vCenter" value={totalVcenter} color="blue" />
        <StatCard label="Є в CMDB"         value={inCmdb}       color="green" />
        <StatCard label="Відсутні в CMDB"  value={notInCmdb}    color="red"   />
        <StatCard label="Увімкнені (нові)" value={poweredOn}    color="amber" />
      </div>

      {/* Import result banner */}
      {importStatus.type === "done" && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm">
          <p className="font-medium text-green-700 dark:text-green-400">
            ✓ Імпорт завершено: додано {importStatus.result.imported},
            пропущено {importStatus.result.skipped}
            {importStatus.result.errors.length > 0 && `, помилок ${importStatus.result.errors.length}`}
          </p>
          {importStatus.result.errors.length > 0 && (
            <ul className="mt-2 text-red-600 dark:text-red-400 space-y-0.5">
              {importStatus.result.errors.map((e, i) => (
                <li key={i} className="text-xs">• {e.name}: {e.error}</li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportStatus({ type: "idle" })}
            className="mt-2 text-xs text-green-600 dark:text-green-400 underline">
            Закрити
          </button>
        </div>
      )}
      {importStatus.type === "error" && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm">
          <p className="text-red-600 dark:text-red-400">✗ Помилка імпорту: {importStatus.msg}</p>
          <button onClick={() => setImportStatus({ type: "idle" })}
            className="mt-1 text-xs text-red-500 underline">Закрити</button>
        </div>
      )}

      {notInCmdb === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          <p className="text-4xl mb-3">✓</p>
          <p className="text-lg font-medium">Всі ВМ з vCenter вже є в CMDB</p>
        </div>
      ) : (
        <>
          {/* Filters + actions */}
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <input
              type="text"
              placeholder="Пошук за назвою, кластером, IP..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm
                         bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200
                         placeholder-gray-400 dark:placeholder-slate-500 w-72"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => { setOnlyActive(e.target.checked); setPage(1); clearSelection(); }}
                className="rounded"
              />
              Тільки увімкнені
            </label>

            <div className="flex-1" />

            <span className="text-xs text-gray-500 dark:text-slate-400">
              Вибрано: {selected.size} / {filtered.length}
            </span>
            <button
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40"
            >
              Вибрати всі видимі
            </button>
            <button
              onClick={clearSelection}
              disabled={selected.size === 0}
              className="text-xs text-gray-500 dark:text-slate-400 hover:underline disabled:opacity-40"
            >
              Скинути
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || importStatus.type === "loading"}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                         disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {importStatus.type === "loading"
                ? "Імпортую..."
                : `Імпортувати (${selected.size})`}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allOnPage && pageItems.length > 0}
                      ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPage; }}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Назва у vCenter</th>
                  <th className="px-3 py-2 text-left">Ім'я в CMDB</th>
                  <th className="px-3 py-2 text-left">Кластер</th>
                  <th className="px-3 py-2 text-right">vCPU</th>
                  <th className="px-3 py-2 text-right">vRAM ГБ</th>
                  <th className="px-3 py-2 text-left">Стан</th>
                  <th className="px-3 py-2 text-left">Hostname</th>
                  <th className="px-3 py-2 text-left">IP</th>
                  <th className="px-3 py-2 text-left">OS</th>
                  <th className="px-3 py-2 text-left">Дата створення</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageItems.map((vm) => (
                  <VmRow
                    key={vm.moid}
                    vm={vm}
                    checked={selected.has(vm.moid)}
                    onToggle={() => toggleOne(vm.moid)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-200 dark:border-slate-700
                           disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-slate-800"
              >‹</button>
              <span className="text-gray-500 dark:text-slate-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 dark:border-slate-700
                           disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-slate-800"
              >›</button>
            </div>
          )}
        </>
      )}

      {data?.synced_at && (
        <p className="mt-4 text-xs text-gray-400 dark:text-slate-500">
          Дані синхронізовано: {new Date(data.synced_at).toLocaleString("uk-UA")}
        </p>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, color,
}: {
  label: string; value: number; color: "blue" | "green" | "red" | "amber";
}) {
  const palette = {
    blue:  "bg-blue-50  dark:bg-blue-900/20  border-blue-200  dark:border-blue-800  text-blue-700  dark:text-blue-400",
    green: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400",
    red:   "bg-red-50   dark:bg-red-900/20   border-red-200   dark:border-red-800   text-red-700   dark:text-red-400",
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",
  }[color];
  return (
    <div className={`rounded-xl border p-4 ${palette}`}>
      <p className="text-2xl font-bold font-mono tabular-nums">{value}</p>
      <p className="text-xs mt-0.5 opacity-75">{label}</p>
    </div>
  );
}

function VmRow({
  vm, checked, onToggle,
}: {
  vm: VCenterNewVM; checked: boolean; onToggle: () => void;
}) {
  return (
    <tr
      onClick={onToggle}
      className={
        "cursor-pointer transition-colors " +
        (checked
          ? "bg-blue-50 dark:bg-blue-900/15"
          : "hover:bg-gray-50 dark:hover:bg-slate-800/50")
      }
    >
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="rounded" />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-slate-300 whitespace-nowrap">
        {vm.vc_name}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-blue-700 dark:text-blue-400 whitespace-nowrap">
        {vm.cmdb_name}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">
        {vm.cluster ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-xs font-mono tabular-nums text-gray-700 dark:text-slate-300">
        {vm.vcpu ?? "—"}
      </td>
      <td className="px-3 py-2 text-right text-xs font-mono tabular-nums text-gray-700 dark:text-slate-300">
        {vm.vram_gb ?? "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <PowerBadge state={vm.power_state} />
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
        {vm.guest_hostname ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2 text-xs font-mono text-gray-500 dark:text-slate-400 whitespace-nowrap">
        {vm.guest_ip ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 max-w-48 truncate">
        {vm.os_full_name ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
        {vm.created_at
          ? new Date(vm.created_at).toLocaleDateString("uk-UA")
          : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
    </tr>
  );
}
