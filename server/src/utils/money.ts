/**
 * Server-side money helpers (ARCHITECTURE.md §4.2 `utils/`).
 *
 * The canonical DECIMAL-safe implementation lives in @bodhisattva/shared
 * (money.ts) so the frontend and API can never drift; this module re-exports
 * it under the names server code uses when talking to DECIMAL columns and
 * adds server-only conveniences. All arithmetic is integer minor units
 * (paisa) — never binary floating point.
 */
import {
  addMoney,
  formatMoney,
  minorUnitsToMoneyString,
  parseMoneyToMinorUnits,
} from "@bodhisattva/shared/money";

export * from "@bodhisattva/shared/money";

/** DECIMAL string from the database → integer paisa. */
export const decimalToPaisa = parseMoneyToMinorUnits;

/** Integer paisa → DECIMAL string for the database / API. */
export const paisaToDecimal = minorUnitsToMoneyString;

/** Format a DECIMAL string for display in NPR ("Rs. 4,500.00"). */
export function formatNpr(value: string): string {
  return formatMoney(value, { currency: "NPR" });
}

/** Sum a list of DECIMAL strings exactly (e.g. order line totals). */
export function sumMoney(values: readonly string[]): string {
  return values.reduce((total, value) => addMoney(total, value), "0.00");
}
