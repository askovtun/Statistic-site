type Variant = "success" | "warning" | "danger" | "info" | "neutral";

const styles: Record<Variant, string> = {
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  neutral: "bg-gray-100 text-gray-700",
};

export default function StatusBadge({
  label,
  variant = "neutral",
}: {
  label: string;
  variant?: Variant;
}) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[variant]}`}>
      {label}
    </span>
  );
}
