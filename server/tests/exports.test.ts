/**
 * Export builders + insights range math (2026-11-27).
 *
 * The formula guard and the CSV/XLSX byte shape are security
 * surface (stored product/customer names flow into these files), so
 * they are pinned here, including the whitespace-prefixed payloads
 * the plan reviewers called out. Range windows are pinned against
 * hand-computed Asia/Kathmandu boundaries.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { rangeWindow } from "../src/modules/store/insights.service.js";
import {
  guardFormulaCell,
  toCsv,
  toXlsx,
} from "../src/services/exports.js";

describe("formula guard", () => {
  it("prefixes cells starting with a formula lead", () => {
    expect(guardFormulaCell("=2+2")).toBe("'=2+2");
    expect(guardFormulaCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(guardFormulaCell("-5")).toBe("'-5");
    expect(guardFormulaCell("@cmd")).toBe("'@cmd");
    expect(guardFormulaCell("|pipe")).toBe("'|pipe");
    expect(guardFormulaCell("%pct")).toBe("'%pct");
  });

  it("sees through leading whitespace and control characters", () => {
    expect(guardFormulaCell("  =SUM(A1)")).toBe("'  =SUM(A1)");
    expect(guardFormulaCell("\t@cmd")).toBe("'\t@cmd");
    expect(guardFormulaCell("\r\n+1")).toBe("'\r\n+1");
  });

  it("leaves ordinary text untouched", () => {
    expect(guardFormulaCell("Brass Singing Bowl")).toBe("Brass Singing Bowl");
    expect(guardFormulaCell("Rs. 1,500")).toBe("Rs. 1,500");
    expect(guardFormulaCell("")).toBe("");
    expect(guardFormulaCell("a=b")).toBe("a=b");
  });
});

describe("toCsv", () => {
  it("emits a BOM, CRLF rows and RFC-4180 quoting", () => {
    const csv = toCsv([
      ["Name", "Note", "Qty"],
      ['Bowl, "large"', "line1\nline2", 3],
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Bowl, ""large"""');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain(",3\r\n");
  });

  it("guards formula-looking text but never numbers", () => {
    const csv = toCsv([["=HYPERLINK(1)", 42]]);
    expect(csv).toContain("'=HYPERLINK(1),42");
  });
});

describe("toXlsx", () => {
  it("reopens with the same sheets and string-typed guarded cells", async () => {
    const buffer = await toXlsx([
      {
        name: "Orders",
        headers: ["Name", "Total"],
        rows: [
          ["=2+2", 1500],
          ["Plain", 0],
        ],
      },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = wb.getWorksheet("Orders");
    expect(ws).toBeDefined();
    const cell = ws!.getCell("A2");
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe("'=2+2");
    expect(ws!.getCell("B2").value).toBe(1500);
    expect(ws!.getCell("A3").value).toBe("Plain");
  });
});

describe("rangeWindow (Asia/Kathmandu)", () => {
  // 2026-11-27 10:00 UTC = 15:45 in Kathmandu, same calendar day.
  const now = new Date("2026-11-27T10:00:00.000Z");

  it("7d: half-open window ending at the next Kathmandu midnight", () => {
    const w = rangeWindow("7d", now);
    expect(w.end.toISOString()).toBe("2026-11-27T18:15:00.000Z");
    expect(w.start?.toISOString()).toBe("2026-11-20T18:15:00.000Z");
    expect(w.prevEnd?.toISOString()).toBe("2026-11-20T18:15:00.000Z");
    expect(w.prevStart?.toISOString()).toBe("2026-11-13T18:15:00.000Z");
    expect(w.bucketKeys).toEqual([
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
    ]);
  });

  it("12m: whole Kathmandu months, previous 12 months as the delta window", () => {
    const w = rangeWindow("12m", now);
    expect(w.start?.toISOString()).toBe("2025-11-30T18:15:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-30T18:15:00.000Z");
    expect(w.prevStart?.toISOString()).toBe("2024-11-30T18:15:00.000Z");
    expect(w.bucketKeys).toHaveLength(12);
    expect(w.bucketKeys[0]).toBe("2025-12");
    expect(w.bucketKeys[11]).toBe("2026-11");
  });

  it("all: unbounded start, no delta window", () => {
    const w = rangeWindow("all", now);
    expect(w.start).toBeNull();
    expect(w.prevEnd).toBeNull();
    expect(w.bucket).toBe("month");
  });
});
