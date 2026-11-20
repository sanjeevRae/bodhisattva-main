/**
 * Store settings (2026-11-20): the role grants behind the owner's
 * "Admin and Store Admin set the shipping fee and VAT rate" request,
 * and the write-path validation that keeps a typo from silently
 * zeroing the shop's shipping or VAT (the checkout-side parsers are
 * deliberately lenient, so the write path must be strict).
 */
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "../src/database/seed-data/permissions.js";
import {
  STORE_SETTING_KEYS,
  validateStoreSettingEntries,
} from "../src/modules/cms/service.js";

describe("store settings role grants", () => {
  it("Admin and Store Admin hold store.settings.manage; Admin does NOT hold global settings.manage", () => {
    expect(ROLE_PERMISSIONS.ADMIN).toContain("store.settings.manage");
    expect(ROLE_PERMISSIONS.STORE_ADMIN).toContain("store.settings.manage");
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("settings.manage");
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain("store.settings.manage");
  });

  it("the allowlist is exactly the three store keys", () => {
    expect([...STORE_SETTING_KEYS].sort()).toEqual(
      ["store.cod_enabled", "store.shipping_flat_fee", "store.tax_rate_percent"].sort(),
    );
  });
});

describe("validateStoreSettingEntries", () => {
  it("accepts well-formed values (string or number forms)", () => {
    expect(() =>
      validateStoreSettingEntries([
        { key: "store.shipping_flat_fee", value: "250.00" },
        { key: "store.tax_rate_percent", value: "13" },
        { key: "store.cod_enabled", value: true },
      ]),
    ).not.toThrow();
    expect(() =>
      validateStoreSettingEntries([
        { key: "store.shipping_flat_fee", value: 0 },
        { key: "store.tax_rate_percent", value: 12.5 },
        { key: "store.cod_enabled", value: "false" },
      ]),
    ).not.toThrow();
  });

  it("ignores non-store keys (the generic editor writes many keys)", () => {
    expect(() =>
      validateStoreSettingEntries([{ key: "site_name", value: { any: "thing" } }]),
    ).not.toThrow();
  });

  it.each([
    ["negative fee", { key: "store.shipping_flat_fee", value: "-5" }],
    ["fee over the cap", { key: "store.shipping_flat_fee", value: "100000.01" }],
    ["fee with 3 decimal places", { key: "store.shipping_flat_fee", value: "10.999" }],
    ["non-numeric fee", { key: "store.shipping_flat_fee", value: "abc" }],
    ["object fee", { key: "store.shipping_flat_fee", value: { rs: 5 } }],
    ["null fee", { key: "store.shipping_flat_fee", value: null }],
    ["rate over 100", { key: "store.tax_rate_percent", value: "101" }],
    ["negative rate", { key: "store.tax_rate_percent", value: -1 }],
    ["non-numeric rate", { key: "store.tax_rate_percent", value: "13%" }],
    ["non-boolean COD", { key: "store.cod_enabled", value: "yes" }],
  ])("rejects %s", (_label, entry) => {
    expect(() => validateStoreSettingEntries([entry])).toThrow();
  });

  it("rejects a mixed batch as a whole (all-or-nothing)", () => {
    expect(() =>
      validateStoreSettingEntries([
        { key: "store.shipping_flat_fee", value: "150.00" },
        { key: "store.tax_rate_percent", value: "not-a-number" },
      ]),
    ).toThrow();
  });
});
