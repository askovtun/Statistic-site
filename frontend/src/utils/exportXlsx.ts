import * as XLSX from "xlsx";

export function exportToXlsx(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[]
) {
  const ws = XLSX.utils.json_to_sheet(rows);

  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    ws["!cols"] = keys.map((k) => {
      const maxLen = Math.max(
        k.length,
        ...rows.map((r) => String(r[k] ?? "").length)
      );
      return { wch: Math.min(Math.max(maxLen + 2, 8), 60) };
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
