/**
 * Export builders (2026-11-27, Store insights) — CSV and XLSX
 * generation shared by the store-report and audit-log downloads.
 *
 * Safety rules (reviewed 2026-11-27):
 *  - CSV is UTF-8 with a BOM (Excel opens it correctly), RFC-4180
 *    quoting, and a spreadsheet formula-injection guard: a text
 *    cell whose first non-whitespace/control character is one of
 *    = + - @ | % is prefixed with an apostrophe. Numeric cells are
 *    written as numbers, never guarded.
 *  - XLSX is built with exceljs; untrusted values are assigned as
 *    plain strings (exceljs only creates a formula cell from an
 *    explicit { formula } object, which is never used here).
 *  - Row caps live with the callers (EXPORT_ROW_CAP); builders
 *    render exactly the rows they are given.
 */
import ExcelJS from "exceljs";

export const EXPORT_ROW_CAP = 10_000;

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FORMULA_LEAD = /^[=+\-@|%]/;
const LEADING_NOISE = /^[\s\u0000-\u001f]+/;

/** Guard one text value against spreadsheet formula injection. */
export function guardFormulaCell(text: string): string {
  const stripped = text.replace(LEADING_NOISE, "");
  return FORMULA_LEAD.test(stripped) ? `'${text}` : text;
}

function csvEscape(value: string | number): string {
  if (typeof value === "number") return String(value);
  const guarded = guardFormulaCell(value);
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Render rows (header first) as a BOM-prefixed RFC-4180 CSV string. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const body = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  return `\uFEFF${body}\r\n`;
}

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Build an XLSX workbook buffer from plain data. Text cells are
 * written as strings; the formula guard is applied to text too, so
 * a downloaded file opened in a spreadsheet never evaluates a
 * stored value as a formula.
 */
export async function toXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bodhisattva Museum Admin";
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.headers);
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) {
      ws.addRow(
        row.map((cell) =>
          typeof cell === "string" ? guardFormulaCell(cell) : cell,
        ),
      );
    }
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Attachment headers shared by every export download. */
export function exportHeaders(
  contentType: string,
  filename: string,
  truncated: boolean,
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Export-Truncated": truncated ? "true" : "false",
  };
}
