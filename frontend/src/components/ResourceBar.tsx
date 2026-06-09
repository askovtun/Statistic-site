function barColor(pct: number): string {
  if (pct > 85) return "bg-red-500";
  if (pct > 70) return "bg-yellow-400";
  if (pct < 20) return "bg-blue-300";
  return "bg-green-500";
}

export default function ResourceBar({
  pct,
  label,
}: {
  pct: number | null;
  label?: string;
}) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-16">
        <div
          className={`h-2 rounded-full ${barColor(clamped)} transition-all`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 w-12 text-right">
        {label ?? `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}
