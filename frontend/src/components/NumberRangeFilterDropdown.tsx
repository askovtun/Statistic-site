import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface NumberRange {
  min?: number;
  max?: number;
}

interface NumberRangeFilterDropdownProps {
  value: NumberRange | null;
  onChange: (value: NumberRange | null) => void;
  unit?: string;
}

export default function NumberRangeFilterDropdown({
  value,
  onChange,
  unit = "%",
}: NumberRangeFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(value?.min?.toString() ?? "");
  const [max, setMax] = useState(value?.max?.toString() ?? "");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const isActive = value !== null && (value.min !== undefined || value.max !== undefined);

  useEffect(() => {
    setMin(value?.min?.toString() ?? "");
    setMax(value?.max?.toString() ?? "");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((o) => !o);
  }

  function apply() {
    const minVal = min.trim() === "" ? undefined : Number(min);
    const maxVal = max.trim() === "" ? undefined : Number(max);
    onChange(minVal === undefined && maxVal === undefined ? null : { min: minVal, max: maxVal });
    setOpen(false);
  }

  function reset() {
    setMin("");
    setMax("");
    onChange(null);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
        className={`ml-1 px-1 rounded normal-case ${
          isActive ? "text-blue-600" : "text-gray-400"
        } hover:text-blue-500`}
        title="Фільтр за діапазоном"
      >
        ▾
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 100 }}
            className="bg-white border border-gray-200 rounded-lg shadow-lg w-48 p-3 text-xs normal-case font-normal text-gray-700"
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                type="number"
                placeholder={`від, ${unit}`}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-400"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                placeholder={`до, ${unit}`}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
            <div className="flex justify-between text-blue-600">
              <button onClick={apply} className="hover:underline">Застосувати</button>
              <button onClick={reset} className="hover:underline">Очистити</button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
