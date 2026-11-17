import { describe, expect, it } from "vitest";
import {
  addMoney,
  decimalToPaisa,
  formatNpr,
  paisaToDecimal,
  sumMoney,
} from "../src/utils/money.js";

describe("money helpers (DECIMAL-safe)", () => {
  it("converts DECIMAL strings to integer paisa", () => {
    expect(decimalToPaisa("4500.00")).toBe(450000);
    expect(decimalToPaisa("0.10")).toBe(10);
    expect(decimalToPaisa("0.01")).toBe(1);
    expect(decimalToPaisa("-2.50")).toBe(-250);
    expect(decimalToPaisa("7")).toBe(700);
  });

  it("converts paisa back to DECIMAL strings", () => {
    expect(paisaToDecimal(450050)).toBe("4500.50");
    expect(paisaToDecimal(5)).toBe("0.05");
    expect(paisaToDecimal(0)).toBe("0.00");
    expect(paisaToDecimal(-250)).toBe("-2.50");
  });

  it("adds money exactly (no floating-point drift)", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(sumMoney(["10.00", "0.05", "-5.00"])).toBe("5.05");
    expect(sumMoney([])).toBe("0.00");
  });

  it("formats NPR amounts with grouping", () => {
    expect(formatNpr("4500.00")).toBe("Rs. 4,500.00");
    expect(formatNpr("1234567.89")).toBe("Rs. 1,234,567.89");
  });

  it("rejects malformed money strings", () => {
    expect(() => decimalToPaisa("12.345")).toThrow();
    expect(() => decimalToPaisa("abc")).toThrow();
    expect(() => decimalToPaisa("1,000.00")).toThrow();
    expect(() => paisaToDecimal(1.5)).toThrow();
  });
});
