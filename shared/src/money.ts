/**
 * Money helpers (ARCHITECTURE.md §1 principle 5, §6.4).
 *
 * Money is `DECIMAL` in the database and a decimal string (e.g. "4500.50")
 * in the API — never binary floating point. All arithmetic here is done in
 * integer minor units (paisa for NPR) converted via string manipulation,
 * so "0.10" + "0.20" is exactly "0.30".
 *
 * A "money string" is an optionally negative decimal with at most two
 * fraction digits: /^-?\d+(\.\d{1,2})?$/ — matching DECIMAL(…, 2) values
 * as returned by the MySQL driver.
 */

export const DEFAULT_CURRENCY = "NPR";

/** Display symbol/prefix per currency for `formatMoney`. */
const CURRENCY_PREFIX: Record<string, string> = {
  NPR: "Rs. ",
};

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export type MoneyString = string;

export function isMoneyString(value: string): value is MoneyString {
  return MONEY_PATTERN.test(value);
}

export function assertMoneyString(value: string): MoneyString {
  if (!isMoneyString(value)) {
    throw new Error(`Invalid money string: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Convert a money string to integer minor units ("4500.50" → 450050). */
export function parseMoneyToMinorUnits(value: string): number {
  assertMoneyString(value);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor =
    Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Money value out of safe range: ${JSON.stringify(value)}`);
  }
  return negative ? -minor : minor;
}

/** Convert integer minor units back to a money string (450050 → "4500.50"). */
export function minorUnitsToMoneyString(minorUnits: number): MoneyString {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error(`Minor units must be a safe integer, got: ${minorUnits}`);
  }
  const negative = minorUnits < 0;
  const absolute = Math.abs(minorUnits);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function addMoney(a: string, b: string): MoneyString {
  return minorUnitsToMoneyString(
    parseMoneyToMinorUnits(a) + parseMoneyToMinorUnits(b),
  );
}

export function subtractMoney(a: string, b: string): MoneyString {
  return minorUnitsToMoneyString(
    parseMoneyToMinorUnits(a) - parseMoneyToMinorUnits(b),
  );
}

/** Multiply a money string by an integer quantity (e.g. cart line totals). */
export function multiplyMoney(value: string, quantity: number): MoneyString {
  if (!Number.isSafeInteger(quantity)) {
    throw new Error(`Quantity must be an integer, got: ${quantity}`);
  }
  return minorUnitsToMoneyString(parseMoneyToMinorUnits(value) * quantity);
}

/** Returns -1, 0 or 1 as `a` is less than, equal to, or greater than `b`. */
export function compareMoney(a: string, b: string): number {
  const diff = parseMoneyToMinorUnits(a) - parseMoneyToMinorUnits(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

function groupThousands(wholePart: string): string {
  return wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a money string for display: "1234567.89" → "Rs. 1,234,567.89"
 * (NPR default, matching the existing Gift Shop's "Rs." convention).
 * Pass `{ prefix: false }` for the bare grouped number.
 */
export function formatMoney(
  value: string,
  options: { currency?: string; prefix?: boolean } = {},
): string {
  assertMoneyString(value);
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const grouped = `${groupThousands(whole)}.${(fraction + "00").slice(0, 2)}`;
  const prefix =
    options.prefix === false ? "" : (CURRENCY_PREFIX[currency] ?? `${currency} `);
  return `${negative ? "-" : ""}${prefix}${grouped}`;
}
