import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ColumnFilterDropdownProps {
  options: string[];
  /** null = no filter active (all values shown) */
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
}

export default function ColumnFilterDropdown({
  options,
  selected,
  onChange,
}: ColumnFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const isActive = selected !== null;

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
    setSearch("");
    setOpen((o) => !o);
  }

  const isChecked = (v: string) => selected === null || selected.has(v);

  function toggleValue(v: string) {
    const current = selected === null ? new Set(options) : new Set(selected);
    if (current.has(v)) current.delete(v);
    else current.add(v);
    onChange(current.size === options.length ? null : current);
  }

  const filteredOptions = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

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
        title="Фільтр"
      >
        ▾
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 100 }}
            className="bg-white border border-gray-200 rounded-lg shadow-lg w-56 max-h-72 flex flex-col text-xs normal-case font-normal text-gray-700"
          >
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                placeholder="Пошук..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
            <div className="flex justify-between px-2 py-1 border-b border-gray-100 text-blue-600">
              <button onClick={() => onChange(null)} className="hover:underline">
                Обрати все
              </button>
              <button onClick={() => onChange(new Set())} className="hover:underline">
                Зняти все
              </button>
            </div>
            <div className="overflow-y-auto p-1">
              {filteredOptions.map((o) => (
                <label
                  key={o}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(o)}
                    onChange={() => toggleValue(o)}
                  />
                  <span className="truncate">{o || "—"}</span>
                </label>
              ))}
              {filteredOptions.length === 0 && (
                <p className="text-center text-gray-400 py-2">Нічого не знайдено</p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
