function barColor(pct: number): string {
  if (pct > 85) return "bg-red-500";
  if (pct > 70) return "bg-yellow-400";
  if (pct < 20) return "bg-blue-300";
  return "bg-green-500";
}

export default function ResourceBar({
  pct,
  peakPct,
  label,
}: {
  pct: number | null;
  peakPct?: number | null;
  label?: string;
}) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  const clampedPeak =
    peakPct !== null && peakPct !== undefined
      ? Math.min(100, Math.max(0, peakPct))
      : null;
  return (
    <div className="flex items-center gap-1">
      <div className="relative flex-1 bg-gray-200 rounded-full h-2 min-w-10">
        <div
          className={`h-2 rounded-full ${barColor(clamped)} transition-all`}
          style={{ width: `${clamped}%` }}
        />
        {clampedPeak !== null && (
          <div
            title={`Пік: ${peakPct!.toFixed(1)}%`}
            className="absolute top-0 h-2 w-0.5 bg-gray-700"
            style={{ left: `${clampedPeak}%` }}
          />
        )}
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">
        {label ?? `${pct.toFixed(1)}%`}
      </span>
      {clampedPeak !== null && (
        <span className="text-xs text-gray-400 w-11 text-right" title={`Пік: ${peakPct!.toFixed(1)}%`}>
          /{peakPct!.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
