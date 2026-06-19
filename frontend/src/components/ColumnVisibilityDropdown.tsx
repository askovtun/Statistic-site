import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ColumnDef {
  key: string;
  label: string;
}

interface Props {
  columns: ColumnDef[];
  visible: Set<string>;
  onChange: (visible: Set<string>) => void;
}

export default function ColumnVisibilityDropdown({ columns, visible, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const hiddenCount = columns.filter((c) => !visible.has(c.key)).length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const left = Math.max(4, r.right - 192);
      setPos({ top: r.bottom + 4, left });
    }
    setOpen((o) => !o);
  }

  function toggle(key: string) {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function showAll() {
    onChange(new Set(columns.map((c) => c.key)));
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        className={`text-sm px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
          hiddenCount > 0
            ? "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100"
            : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
        }`}
      >
        Колонки
        {hiddenCount > 0 && (
          <span className="bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {hiddenCount}
          </span>
        )}
        ▾
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 200 }}
            className="bg-white border border-gray-200 rounded-lg shadow-lg w-48 py-1 text-xs font-normal text-gray-700"
          >
            <div className="flex justify-between px-3 py-1.5 border-b border-gray-100 text-blue-600 mb-1">
              <button onClick={showAll} className="hover:underline">Показати всі</button>
            </div>
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  onChange={() => toggle(col.key)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
