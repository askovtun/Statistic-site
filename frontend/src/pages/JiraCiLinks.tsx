import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type JiraCiDatePoint,
  type JiraCiIssueRow,
  type JiraCiLinksResponse,
} from "../api/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "30 днів",  value: 30  },
  { label: "90 днів",  value: 90  },
  { label: "180 днів", value: 180 },
  { label: "365 днів", value: 365 },
];

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("uk-UA", {
    day: "2-digit", month: "2-digit",
  });
}

function fmtDateFull(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("uk-UA", {
    day: "numeric", month: "long", year: "numeric",
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label ? fmtDateFull(label) : ""}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JiraCiLinks() {
  const [days, setDays] = useState(180);

  const { data, isLoading, isError } = useQuery<JiraCiLinksResponse>({
    queryKey: ["jira-ci-links", days],
    queryFn: () => api.jiraCiLinks(days),
  });

  // Show only dates with activity OR last 60 dates for the chart
  const chartData = data?.by_date ?? [];
  const nonZeroDates = chartData.filter((d) => d.cumulative > 0);
  const displayData = nonZeroDates.length > 0
    ? chartData.filter((d) => d.date >= nonZeroDates[0].date)
    : chartData.slice(-60);

  // Weekly aggregation when period >= 180 to avoid crowded x-axis
  const aggregated: JiraCiDatePoint[] = days >= 180
    ? (() => {
        const weeks: JiraCiDatePoint[] = [];
        for (let i = 0; i < displayData.length; i += 7) {
          const slice = displayData.slice(i, i + 7);
          weeks.push({
            date: slice[0].date,
            issues_created: slice.reduce((s, d) => s + d.issues_created, 0),
            ci_count: slice.reduce((s, d) => s + d.ci_count, 0),
            cumulative: slice[slice.length - 1].cumulative,
          });
        }
        return weeks;
      })()
    : displayData;

  const maxBar = Math.max(...aggregated.map((d) => d.issues_created), 1);
  const maxLine = Math.max(...aggregated.map((d) => d.cumulative), 1);

  if (isLoading) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">Завантаження даних з Jira…</div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-6 text-center text-red-500 text-sm">Помилка завантаження даних</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Прив'язка CI до задач Jira</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Прогрес фахівців — скільки задач мають прив'язані Configuration Items
          </p>
        </div>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setDays(o.value)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                days === o.value
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Задач з CI"
          value={data.total_issues}
          icon="🔗"
          color="blue"
          sub="задач мають прив'язаний CI"
        />
        <SummaryCard
          label="Всього CI-посилань"
          value={data.total_ci_count}
          icon="📦"
          color="green"
          sub={`≈ ${data.total_issues ? (data.total_ci_count / data.total_issues).toFixed(1) : 0} CI на задачу`}
        />
        <SummaryCard
          label="Активних фахівців"
          value={data.active_specialists}
          icon="👥"
          color="purple"
          sub="прив'язують CI до задач"
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          Динаміка прив'язки CI{days >= 180 ? " (по тижнях)" : " (по днях)"}
        </h2>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={aggregated} margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={fmtDate}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="bar"
              orientation="left"
              tick={{ fontSize: 11 }}
              domain={[0, Math.ceil(maxBar * 1.2) || 1]}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="line"
              orientation="right"
              tick={{ fontSize: 11 }}
              domain={[0, Math.ceil(maxLine * 1.1) || 1]}
              allowDecimals={false}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(v) =>
                v === "issues_created" ? "Нових задач з CI" : v === "cumulative" ? "Накопичено задач" : v
              }
            />
            <Bar
              yAxisId="bar"
              dataKey="issues_created"
              name="issues_created"
              fill="#3b82f6"
              opacity={0.8}
              radius={[2, 2, 0, 0]}
              maxBarSize={30}
            />
            <Line
              yAxisId="line"
              dataKey="cumulative"
              name="cumulative"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Specialists table + Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Specialists */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Фахівці</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                  <th className="py-2 text-left">#</th>
                  <th className="py-2 text-left">Фахівець</th>
                  <th className="py-2 text-right">Задач</th>
                  <th className="py-2 text-right">CI-посилань</th>
                  <th className="py-2 text-right">CI / задача</th>
                  <th className="py-2 text-right">Остання активність</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.by_assignee.map((row, i) => (
                  <tr key={row.name} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-2 text-gray-400 text-xs">{i + 1}</td>
                    <td className="py-2 font-medium text-gray-800">{row.name}</td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{row.issues}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="inline-block h-1.5 rounded-full bg-blue-500"
                          style={{
                            width: `${Math.round(
                              (row.ci_count / (data.total_ci_count || 1)) * 80
                            )}px`,
                            minWidth: "4px",
                          }}
                        />
                        <span className="text-gray-700 font-medium">{row.ci_count}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-500">
                      {row.issues ? (row.ci_count / row.issues).toFixed(1) : "—"}
                    </td>
                    <td className="py-2 text-right text-gray-400 text-xs">
                      {row.last_activity ? fmtDateFull(row.last_activity) : "—"}
                    </td>
                  </tr>
                ))}
                {data.by_assignee.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-400 text-xs">
                      Немає даних за вибраний період
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Projects */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">По проектах</h2>
          <div className="space-y-2">
            {data.by_project.map((row) => {
              const pct = data.total_issues
                ? Math.round((row.issues / data.total_issues) * 100)
                : 0;
              return (
                <div key={row.project}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="font-medium text-gray-700">{row.project}</span>
                    <span className="text-gray-500">
                      {row.issues} задач · {row.ci_count} CI
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {data.by_project.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">Немає даних</p>
            )}
          </div>
        </div>
      </div>

      {/* Detail table */}
      <IssueDetailTable issues={data.issues} jiraUrl={data.jira_url} />

      <p className="text-xs text-gray-400">
        * Дата на графіку — дата створення задачі. Оновлення даних: кожні 5 хв.
      </p>
    </div>
  );
}

// ── Issue detail table ────────────────────────────────────────────────────────

function IssueDetailTable({
  issues,
  jiraUrl,
}: {
  issues: JiraCiIssueRow[];
  jiraUrl: string;
}) {
  const [search, setSearch] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const assignees = [...new Set(issues.map((i) => i.assignee))].sort();
  const projects = [...new Set(issues.map((i) => i.project))].sort();

  const filtered = issues.filter((i) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      i.key.toLowerCase().includes(q) ||
      i.summary.toLowerCase().includes(q) ||
      i.ci_items.some((ci) => ci.toLowerCase().includes(q));
    const matchAssignee = !filterAssignee || i.assignee === filterAssignee;
    const matchProject = !filterProject || i.project === filterProject;
    return matchSearch && matchAssignee && matchProject;
  });

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-gray-700">
          Задачі з прив'язаними CI
          <span className="ml-2 text-xs font-normal text-gray-400">
            ({filtered.length} з {issues.length})
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Пошук по задачі або CI…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Всі фахівці</option>
            {assignees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Всі проекти</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
              <th className="py-2 text-left w-24">Задача</th>
              <th className="py-2 text-left">Тема</th>
              <th className="py-2 text-left w-44">Фахівець</th>
              <th className="py-2 text-center w-16">CI</th>
              <th className="py-2 text-right w-24">Дата</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((row) => {
              const isOpen = expanded.has(row.key);
              const issueUrl = jiraUrl ? `${jiraUrl}/browse/${row.key}` : null;
              return (
                <>
                  <tr
                    key={row.key}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => toggleExpand(row.key)}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">
                      {issueUrl ? (
                        <a
                          href={issueUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 hover:underline"
                        >
                          {row.key}
                        </a>
                      ) : (
                        <span className="text-blue-600">{row.key}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 max-w-xs truncate" title={row.summary}>
                      <span className="mr-1 text-gray-400 text-xs">{isOpen ? "▾" : "▸"}</span>
                      {row.summary}
                    </td>
                    <td className="py-2 pr-3 text-gray-600 text-xs">{row.assignee}</td>
                    <td className="py-2 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                        {row.ci_count}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-400 text-xs tabular-nums">
                      {fmtDateFull(row.created)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${row.key}-ci`} className="bg-blue-50">
                      <td colSpan={5} className="py-2 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {row.ci_items.map((ci, idx) => (
                            <span
                              key={idx}
                              className="inline-block bg-white border border-blue-200 rounded px-2 py-0.5 text-xs text-blue-800 font-mono"
                            >
                              {ci}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-400 text-xs">
                  Нічого не знайдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  color,
  sub,
}: {
  label: string;
  value: number;
  icon: string;
  color: "blue" | "green" | "purple";
  sub: string;
}) {
  const colorMap = {
    blue:   "bg-blue-50 text-blue-600",
    green:  "bg-green-50 text-green-600",
    purple: "bg-purple-50 text-purple-600",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${colorMap[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-800 leading-tight">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
