import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ZombieServerItem, type ZombieSignal } from "../api/client";
import { exportToXlsx } from "../utils/exportXlsx";

// ── Tokens (mirrors CSS custom properties approach via inline Tailwind) ────────

const SIGNAL_META: Record<ZombieSignal, { label: string; chipCls: string; tip: string }> = {
  low_cpu:      { label: "CPU idle",    chipCls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",         tip: "CPU avg < 3% та пік < 20% — стабільно без навантаження" },
  low_ram:      { label: "RAM idle",    chipCls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800", tip: "RAM avg < 10% та пік < 30% — стабільно мало задіяна" },
  no_zabbix:    { label: "Без Zabbix", chipCls: "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800", tip: "ВМ увімкнена, але відсутня в Zabbix-моніторингу" },
  no_metrics:   { label: "Сліпа зона", chipCls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",   tip: "Жодних метрик ні з Zabbix, ні з vCenter" },
  wasted_alloc: { label: "≥8vCPU ↓",  chipCls: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800", tip: "≥8 vCPU виділено при CPU avg < 3% — марнотратство ресурсів" },
};

// score 1=yellow 2=orange 3=red 4=deep-red 5=near-black
const SCORE_STRIPE: Record<number, string> = {
  1: "border-l-yellow-300",
  2: "border-l-orange-400",
  3: "border-l-red-500",
  4: "border-l-red-700",
  5: "border-l-red-900",
};

const SCORE_BADGE_CLS: Record<number, string> = {
  1: "bg-yellow-50  text-yellow-700  border-yellow-300  dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-700",
  2: "bg-orange-50  text-orange-700  border-orange-300  dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700",
  3: "bg-red-50     text-red-700     border-red-300     dark:bg-red-900/20 dark:text-red-300 dark:border-red-700",
  4: "bg-red-100    text-red-800     border-red-400     dark:bg-red-900/30 dark:text-red-200 dark:border-red-600",
  5: "bg-red-200    text-red-900     border-red-500     dark:bg-red-900/50 dark:text-red-100 dark:border-red-500",
};

const SCORE_LABEL: Record<number, string> = {
  1: "Підозрілий",
  2: "Можливий",
  3: "Вірогідний",
  4: "Майже точно",
  5: "Зомбі",
};

const CARD_META: Array<{
  label: string;
  sub?: string;
  value: (d: ReturnType<typeof useQuery<typeof api.zombieServers extends (...a: any[]) => infer R ? Awaited<R> : never>>["data"], items: ZombieServerItem[]) => number;
  cls: string;
}> = [
  { label: "Знайдено",           value: (d)       => d?.total ?? 0,
    cls: "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900" },
  { label: "Score ≥3",           sub: "пріоритет",
    value: (d) => (d?.score3 ?? 0) + (d?.score4 ?? 0) + (d?.score5 ?? 0),
    cls: "border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20" },
  { label: "Score 2",
    value: (d) => d?.score2 ?? 0,
    cls: "border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20" },
  { label: "Score 1",
    value: (d) => d?.score1 ?? 0,
    cls: "border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20" },
  { label: "Без Zabbix",         sub: "без моніторингу",
    value: (_, items) => items.filter((i) => i.signals.includes("no_zabbix")).length,
    cls: "border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20" },
  { label: "Без метрик",         sub: "сліпа зона",
    value: (_, items) => items.filter((i) => i.signals.includes("no_metrics")).length,
    cls: "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900" },
];

// ── Small components ──────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const s = Math.min(score, 5);
  const cls = SCORE_BADGE_CLS[s] ?? SCORE_BADGE_CLS[5];
  return (
    <span className={`inline-flex items-center gap-0.5 border text-[11px] font-bold px-2 py-0.5 rounded-full leading-none ${cls}`}>
      {score}/5 · {SCORE_LABEL[s]}
    </span>
  );
}

function SignalChip({ signal }: { signal: ZombieSignal }) {
  const m = SIGNAL_META[signal];
  return (
    <span title={m.tip}
      className={`inline-block border text-[10px] font-semibold px-1.5 py-0.5 rounded-md leading-none ${m.chipCls}`}>
      {m.label}
    </span>
  );
}

function PctBar({
  avg, max, danger,
}: { avg: number | null; max?: number | null; danger: number }) {
  if (avg == null) return <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>;
  const pct = Math.min(avg, 100);
  const low = avg < danger;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <div className="w-12 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex-shrink-0">
          <div
            className={`h-full rounded-full ${low ? "bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-xs font-medium tabular-nums ${low ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
          {avg.toFixed(1)}%
        </span>
      </div>
      {max != null && (
        <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 pl-14 leading-none">
          пік {max.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function CoverageChip({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const cls = pct < 25
    ? "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
    : "text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 bg-transparent";
  return (
    <span title={`Покриття даних: ${pct.toFixed(0)}% годин`}
      className={`text-[9px] border rounded px-1 py-0.5 leading-none ${cls}`}>
      {pct.toFixed(0)}%
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="space-y-1.5">
        <div className="h-7 w-52 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
        <div className="h-4 w-80 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="h-16 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg animate-pulse" />
      <div className="h-8 w-full bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="h-10 bg-slate-50 dark:bg-slate-800 animate-pulse" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`h-14 border-b border-slate-100 dark:border-slate-800 animate-pulse ${
            i % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/50 dark:bg-slate-800/20"
          }`} />
        ))}
      </div>
    </div>
  );
}

// ── Whitelist helpers ─────────────────────────────────────────────────────────

function loadWhitelist(): Set<string> {
  try {
    const v = localStorage.getItem("zombie_whitelist");
    return new Set(v ? (JSON.parse(v) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveWhitelist(s: Set<string>) {
  localStorage.setItem("zombie_whitelist", JSON.stringify([...s]));
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PERIODS = [7, 14, 30, 90] as const;
const PAGE_SIZE = 50;

function lsInt(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  return v != null && !isNaN(+v) ? +v : fallback;
}

export default function ZombieServers() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(
    () => {
      const v = lsInt("zs_days", 90);
      return (PERIODS.includes(v as any) ? v : 90) as 7 | 14 | 30 | 90;
    }
  );
  const [minScore, setMinScore]           = useState(() => lsInt("zs_minScore", 1));
  const [search, setSearch]               = useState("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [signalFilter, setSignalFilter]   = useState<ZombieSignal | "">("");
  const [page, setPage]                   = useState(1);

  // Whitelist
  const [whitelist, setWhitelist]         = useState<Set<string>>(loadWhitelist);
  const [hideWhitelisted, setHideWhitelisted] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["zombie-servers", days, minScore],
    queryFn:  () => api.zombieServers(days, minScore),
    staleTime: 5 * 60 * 1000,
  });

  const items = data?.items ?? [];

  const clusters = useMemo(() =>
    Array.from(new Set(items.map((i) => i.cluster).filter((c): c is string => !!c))).sort()
  , [items]);

  const filtered = useMemo(() => {
    let r = items;
    if (hideWhitelisted) r = r.filter((i) => !whitelist.has(i.name));
    if (clusterFilter) r = r.filter((i) => i.cluster === clusterFilter);
    if (signalFilter)  r = r.filter((i) => i.signals.includes(signalFilter as ZombieSignal));
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((i) =>
        i.name.toLowerCase().includes(q) ||
        (i.fqdn ?? "").toLowerCase().includes(q) ||
        (i.primary_ip ?? "").toLowerCase().includes(q) ||
        (i.cluster ?? "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [items, clusterFilter, signalFilter, search, whitelist, hideWhitelisted]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const resetPage  = () => setPage(1);

  function toggleWhitelist(name: string) {
    setWhitelist((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      saveWhitelist(next);
      return next;
    });
  }

  function clearWhitelist() {
    setWhitelist(new Set());
    localStorage.removeItem("zombie_whitelist");
  }

  function handleDays(p: typeof PERIODS[number]) {
    setDays(p);
    localStorage.setItem("zs_days", String(p));
    resetPage();
  }

  function handleMinScore(s: number) {
    setMinScore(s);
    localStorage.setItem("zs_minScore", String(s));
    resetPage();
  }

  function handleExport() {
    exportToXlsx(`zombie-servers-${days}d.xlsx`, "Зомбі-сервери", filtered.map((i) => ({
      "Сервер":              i.name,
      "FQDN":                i.fqdn ?? "",
      "IP":                  i.primary_ip ?? "",
      "Кластер":             i.cluster ?? "",
      "OS":                  i.os_family ?? "",
      "vCPU":                i.vcpu ?? "",
      "vRAM (ГБ)":           i.vram_gb ?? "",
      "Score":               i.zombie_score,
      "Сигнали":             i.signals.join(", "),
      "CPU avg %":           i.avg_cpu_pct ?? "",
      "CPU пік %":           i.max_cpu_pct ?? "",
      "RAM avg %":           i.avg_ram_pct ?? "",
      "RAM пік %":           i.max_ram_pct ?? "",
      "Покриття даних %":    i.data_coverage_pct ?? "",
      "В Zabbix":            i.in_zabbix ? "Так" : "Ні",
      "В vCenter":           i.in_vcenter ? "Так" : "Ні",
      "Стан живлення":       i.power_state,
      "Переглянуто":         whitelist.has(i.name) ? "Так" : "Ні",
    })));
  }

  const btnBase = "px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
  const btnOff  = `${btnBase} border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 bg-white dark:bg-slate-900`;
  const selectCls = "border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300";

  if (isLoading) return <Skeleton />;
  if (error) return (
    <div className="p-10 text-red-500 text-sm">Помилка: {String(error)}</div>
  );
  if (!data) return null;

  return (
    <div className="p-6 space-y-5 min-h-0">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span aria-hidden>💀</span> Зомбі-сервери
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            Увімкнені ВМ без реального навантаження — аналіз за <strong className="text-slate-600 dark:text-slate-300">{days}&nbsp;днів</strong>
            {data.synced_at && (
              <span className="ml-2">
                · дані: {new Date(data.synced_at).toLocaleString("uk-UA")}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {CARD_META.map(({ label, sub, value, cls }) => (
          <div key={label} className={`rounded-lg border px-3 py-2.5 ${cls}`}>
            <p className="text-xl font-bold tabular-nums leading-none">
              {value(data, items)}
            </p>
            <p className="text-[11px] font-medium mt-1 leading-none opacity-80">{label}</p>
            {sub && <p className="text-[10px] opacity-50 mt-0.5 leading-none">{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Signal legend ── */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5">
        <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1.5 uppercase tracking-wide">
          Як нараховується бал (кожен критерій = +1) · аналіз за {days}&nbsp;днів
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(SIGNAL_META) as [ZombieSignal, (typeof SIGNAL_META)[ZombieSignal]][]).map(([key, m]) => (
            <span key={key} title={m.tip}
              className={`border rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${m.chipCls}`}>
              {m.label} — {m.tip}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5 opacity-75">
          ★ CPU idle та RAM idle перевіряють <strong>і середнє, і пік</strong> за весь період — VМ з рідкісними сплесками навантаження не потрапляє до зомбі.
        </p>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Period */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
            Аналіз за:
          </span>
          {PERIODS.map((p) => (
            <button
              key={p}
              title={`Аналізувати метрики за останні ${p} днів`}
              onClick={() => handleDays(p)}
              className={days === p
                ? `${btnBase} bg-blue-600 text-white border-blue-600`
                : btnOff}
            >
              {p} дн
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Min score */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
            Підозрілість:
          </span>
          {([
            [1, "Будь-яка",   "Показати всі підозрілі ВМ (бал ≥ 1)"],
            [2, "Можлива",    "Показати ВМ з балом ≥ 2 (два та більше сигналів)"],
            [3, "Вірогідна",  "Показати ВМ з балом ≥ 3 — найвірогідніші зомбі"],
          ] as [number, string, string][]).map(([s, label, tip]) => (
            <button
              key={s}
              title={tip}
              onClick={() => handleMinScore(s)}
              className={minScore === s
                ? `${btnBase} bg-red-600 text-white border-red-600`
                : btnOff}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Whitelist toggle */}
        {whitelist.size > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setHideWhitelisted((h) => !h); resetPage(); }}
              title={hideWhitelisted ? "Показати переглянуті" : "Сховати переглянуті ВМ"}
              className={hideWhitelisted
                ? `${btnBase} bg-green-600 text-white border-green-600`
                : btnOff}
            >
              {hideWhitelisted ? `✓ Сховано ${whitelist.size}` : `Сховати переглянуті (${whitelist.size})`}
            </button>
            <button onClick={clearWhitelist} title="Очистити список переглянутих" className={btnOff}>
              Очистити
            </button>
          </div>
        )}

        {/* Signal filter */}
        <select value={signalFilter}
          onChange={(e) => { setSignalFilter(e.target.value as ZombieSignal | ""); resetPage(); }}
          className={selectCls}>
          <option value="">Всі сигнали</option>
          {(Object.entries(SIGNAL_META) as [ZombieSignal, (typeof SIGNAL_META)[ZombieSignal]][]).map(([key, m]) => (
            <option key={key} value={key}>{m.label}</option>
          ))}
        </select>

        {/* Cluster filter */}
        {clusters.length > 0 && (
          <select value={clusterFilter}
            onChange={(e) => { setClusterFilter(e.target.value); resetPage(); }}
            className={selectCls}>
            <option value="">Всі кластери</option>
            {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Пошук за назвою / IP / кластером…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          className={`${selectCls} ml-auto w-60`}
        />
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">

        {/* Table header bar */}
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
            {filtered.length} серверів
            {whitelist.size > 0 && !hideWhitelisted && (
              <span className="ml-2 text-slate-400 dark:text-slate-500 font-normal">
                · {whitelist.size} позначено як переглянуто
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Сортування: score ↓
            </span>
            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              title="Експортувати поточну вибірку в Excel"
              className={`${btnOff} disabled:opacity-40`}
            >
              Експорт XLSX ↓
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {["Сервер", "Score", "Сигнали", "CPU avg · пік", "RAM avg · пік", "vCPU / RAM", "Кластер", "IP", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/80">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                    Жодного зомбі-сервера за вибраними фільтрами
                  </td>
                </tr>
              ) : pageItems.map((item: ZombieServerItem) => {
                const stripe = SCORE_STRIPE[Math.min(item.zombie_score, 5)] ?? SCORE_STRIPE[5];
                const isReviewed = whitelist.has(item.name);
                return (
                  <tr key={item.name}
                    className={`border-l-4 ${stripe} transition-colors ${
                      isReviewed
                        ? "opacity-50 hover:opacity-100"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    }`}>

                    {/* Name */}
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
                      {item.fqdn && item.fqdn !== item.name && (
                        <p className="text-slate-400 dark:text-slate-500 truncate text-[10px] mt-0.5">{item.fqdn}</p>
                      )}
                      <div className="flex gap-1 mt-1 flex-wrap items-center">
                        {!item.in_zabbix && (
                          <span className="text-[9px] bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 px-1 py-0.5 rounded">
                            Без Zabbix
                          </span>
                        )}
                        {item.power_state === "poweredOn" && (
                          <span className="text-[9px] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-1 py-0.5 rounded">
                            Увімкнена
                          </span>
                        )}
                        <CoverageChip pct={item.data_coverage_pct} />
                      </div>
                    </td>

                    {/* Score */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <ScoreBadge score={item.zombie_score} />
                    </td>

                    {/* Signals */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {item.signals.map((s) => (
                          <SignalChip key={s} signal={s} />
                        ))}
                      </div>
                    </td>

                    {/* CPU */}
                    <td className="px-3 py-2.5">
                      <PctBar avg={item.avg_cpu_pct} max={item.max_cpu_pct} danger={3} />
                    </td>

                    {/* RAM */}
                    <td className="px-3 py-2.5">
                      <PctBar avg={item.avg_ram_pct} max={item.max_ram_pct} danger={10} />
                    </td>

                    {/* Alloc */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {item.vcpu != null ? `${item.vcpu}vCPU` : "—"}
                      {" / "}
                      {item.vram_gb != null ? `${item.vram_gb}ГБ` : "—"}
                    </td>

                    {/* Cluster */}
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.cluster ?? "—"}
                    </td>

                    {/* IP */}
                    <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500 font-mono whitespace-nowrap">
                      {item.primary_ip ?? "—"}
                    </td>

                    {/* Reviewed toggle */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button
                        onClick={() => toggleWhitelist(item.name)}
                        title={isReviewed ? "Скасувати позначку" : "Позначити як переглянуто"}
                        className={`text-[10px] border rounded px-1.5 py-0.5 leading-none transition-colors ${
                          isReviewed
                            ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
                            : "text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-500 dark:hover:text-slate-400"
                        }`}
                      >
                        {isReviewed ? "✓ Переглянуто" : "Переглянуто?"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Сторінка {page} / {totalPages} · {filtered.length} записів
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`${btnOff} disabled:opacity-30`}>
                ← Назад
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`${btnOff} disabled:opacity-30`}>
                Вперед →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
