import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { VCenterSnapshotItem } from "../api/client";

type AgeFilter = "all" | "7" | "30";

const AGE_THRESHOLDS: { value: AgeFilter; label: string }[] = [
  { value: "all", label: "Всі" },
  { value: "7",   label: "> 7 днів" },
  { value: "30",  label: "> 30 днів" },
];

function ageBadge(days: number) {
  if (days > 30)
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold">
        {days}д
      </span>
    );
  if (days > 7)
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
        {days}д
      </span>
    );
  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-semibold">
      {days}д
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 min-w-[120px]">
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function VmSnapshots() {
  const qc = useQueryClient();
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vcenter-snapshots"],
    queryFn: api.vcenterSnapshots,
  });

  const refresh = useMutation({
    mutationFn: api.refreshSnapshots,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vcenter-snapshots"] }),
  });

  const snaps: VCenterSnapshotItem[] = data?.snapshots ?? [];

  const filtered = snaps
    .filter((s) => {
      if (ageFilter === "7" && s.age_days <= 7) return false;
      if (ageFilter === "30" && s.age_days <= 30) return false;
      if (search) {
        const q = search.toLowerCase();
        return s.vm_name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => sortDir === "desc" ? b.age_days - a.age_days : a.age_days - b.age_days);

  const old7  = snaps.filter((s) => s.age_days > 7).length;
  const old30 = snaps.filter((s) => s.age_days > 30).length;
  const uniqueVMs = new Set(snaps.map((s) => s.vm_name)).size;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">VM Snapshots</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Знімки VM у vCenter — стежте за старими снапшотами, що займають місце на сховищі
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

      {/* Summary cards */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <StatCard label="Всього знімків"    value={snaps.length} />
          <StatCard label="Унікальних VM"     value={uniqueVMs} />
          <StatCard label="> 7 днів"          value={old7}  sub={old7 > 0 ? "потребують уваги" : undefined} />
          <StatCard label="> 30 днів"         value={old30} sub={old30 > 0 ? "критично старі"  : undefined} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {AGE_THRESHOLDS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setAgeFilter(value)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (ageFilter === value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-400")
            }
          >
            {label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Пошук VM або знімку..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
        />
        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">
          {filtered.length} / {snaps.length} знімків
        </span>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="text-center text-gray-400 py-12">Завантаження...</div>
      )}
      {isError && (
        <div className="text-center text-red-500 py-12">
          Помилка завантаження. Натисніть «Оновити з vCenter» для першого завантаження.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && snaps.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-slate-500">
          <div className="text-4xl mb-3">📸</div>
          <div>Дані відсутні. Натисніть «Оновити з vCenter» для завантаження знімків.</div>
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">VM</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Знімок</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Кластер</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300">Створено</th>
                <th
                  className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-slate-300 cursor-pointer select-none"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                >
                  Вік {sortDir === "desc" ? "▼" : "▲"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {filtered.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700 dark:text-blue-400">{s.vm_name}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-slate-200 max-w-[220px] truncate" title={s.name}>
                    {s.name}
                    {s.description && (
                      <span className="ml-1 text-gray-400 dark:text-slate-500 text-xs" title={s.description}>
                        ({s.description.slice(0, 40)}{s.description.length > 40 ? "…" : ""})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">{s.cluster ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {new Date(s.created_at).toLocaleString("uk-UA")}
                  </td>
                  <td className="px-4 py-3">{ageBadge(s.age_days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
