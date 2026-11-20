import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CmdbCompletenessType, CmdbCompletenessField } from "../api/client";

function pctColor(pct: number): string {
  if (pct >= 90) return "text-green-600 dark:text-green-400";
  if (pct >= 70) return "text-amber-500 dark:text-amber-400";
  if (pct >= 40) return "text-orange-500 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function ProgressBar({ pct }: { pct: number }) {
  const color =
    pct >= 90
      ? "bg-green-500"
      : pct >= 70
      ? "bg-amber-400"
      : pct >= 40
      ? "bg-orange-400"
      : "bg-red-500";
  return (
    <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TypeSection({ t }: { t: CmdbCompletenessType }) {
  const icon = t.ci_type === "vm" ? "💻" : "🗄️";
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Type header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="font-semibold text-gray-900 dark:text-white">{t.label}</div>
            <div className="text-xs text-gray-400 dark:text-slate-500">{t.total.toLocaleString("uk-UA")} об'єктів</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${pctColor(t.overall_pct)}`}>{t.overall_pct}%</div>
          <div className="text-xs text-gray-400 dark:text-slate-500">середнє заповнення</div>
        </div>
      </div>

      {/* Fields table */}
      <div className="divide-y divide-gray-50 dark:divide-slate-800/60">
        {t.fields.map((f: CmdbCompletenessField) => (
          <div key={f.key} className="px-5 py-3 flex items-center gap-4">
            <div className="w-32 text-sm font-medium text-gray-700 dark:text-slate-200 flex-shrink-0">
              {f.label}
            </div>
            <div className="flex-1">
              <ProgressBar pct={f.pct} />
            </div>
            <div className={`text-sm font-bold w-14 text-right ${pctColor(f.pct)}`}>
              {f.pct}%
            </div>
            <div className="text-xs text-gray-400 dark:text-slate-500 w-28 text-right">
              {f.filled.toLocaleString("uk-UA")} / {f.total.toLocaleString("uk-UA")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

export default function CmdbCompleteness() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["cmdb-completeness"],
    queryFn: api.cmdbCompleteness,
  });

  const syncedAt = data?.synced_at
    ? new Date(data.synced_at).toLocaleString("uk-UA")
    : null;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">CMDB Completeness</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Відсоток заповнення ключових полів по кожному типу CI — виявляє «дірки» в даних
          </p>
        </div>
        {syncedAt && (
          <div className="text-xs text-gray-400 dark:text-slate-500">Дані на: {syncedAt}</div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap">
        <LegendItem color="bg-green-500"  label="≥ 90% — відмінно"  />
        <LegendItem color="bg-amber-400"  label="70–89% — добре"    />
        <LegendItem color="bg-orange-400" label="40–69% — є прогалини" />
        <LegendItem color="bg-red-500"    label="< 40% — критично" />
      </div>

      {isLoading && (
        <div className="text-center text-gray-400 py-12">Завантаження...</div>
      )}
      {isError && (
        <div className="text-center text-red-500 py-12">Помилка завантаження даних.</div>
      )}

      {data && data.types.length === 0 && (
        <div className="text-center text-gray-400 dark:text-slate-500 py-12">
          Дані не синхронізовані. Натисніть «Оновити дані».
        </div>
      )}

      {/* Type sections */}
      <div className="space-y-4">
        {(data?.types ?? []).map((t) => (
          <TypeSection key={t.ci_type} t={t} />
        ))}
      </div>

      {/* Insights */}
      {data && data.types.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="font-semibold text-blue-800 dark:text-blue-300 text-sm mb-2">
            💡 Пріоритети для заповнення
          </div>
          <ul className="space-y-1">
            {data.types.flatMap((t) =>
              t.fields
                .filter((f) => f.pct < 70)
                .sort((a, b) => a.pct - b.pct)
                .slice(0, 3)
                .map((f) => (
                  <li key={`${t.ci_type}-${f.key}`} className="text-sm text-blue-700 dark:text-blue-300">
                    <span className="font-medium">{t.label}</span> → поле{" "}
                    <span className="font-mono">{f.label}</span>:{" "}
                    заповнено лише{" "}
                    <span className={`font-bold ${pctColor(f.pct)}`}>{f.pct}%</span>{" "}
                    ({f.total - f.filled} порожніх)
                  </li>
                ))
            )}
            {data.types.every((t) => t.fields.every((f) => f.pct >= 70)) && (
              <li className="text-sm text-green-700 dark:text-green-400 font-medium">
                Всі ключові поля заповнені на ≥ 70%. Відмінний стан даних!
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
