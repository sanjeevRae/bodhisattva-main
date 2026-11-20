import { useCallback, useEffect, useState } from "react";
import { invoiceTemplateApi, settingsApi } from "./api";
import { Btn, ErrorBox, Field, Notice, Spinner, Switch, inputCls } from "./ui";

/**
 * Store settings card (owner request, 2026-11-20): the shipping flat
 * fee, the VAT rate and the COD toggle, editable by Admin and Store
 * Admin (store.settings.manage) — previously these lived only as raw
 * key/value rows reachable by Super Admin. Saves go through the same
 * settings API the server scopes and validates: this card sends only
 * the three store keys, and the server rejects invalid values with
 * nothing written. Internal note: the VAT rate is stored under the
 * legacy key `store.tax_rate_percent`; "VAT" is its display name.
 */

const FEE_KEY = "store.shipping_flat_fee";
const RATE_KEY = "store.tax_rate_percent";
const COD_KEY = "store.cod_enabled";
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

function asText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

export default function StoreSettingsCard() {
  const [fee, setFee] = useState<string | null>(null);
  const [rate, setRate] = useState("0");
  const [cod, setCod] = useState(true);
  const [vatRegMissing, setVatRegMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await settingsApi.list();
      const byKey = new Map(data.items.map((item) => [item.key, item.value]));
      setFee(asText(byKey.get(FEE_KEY), "0.00"));
      setRate(asText(byKey.get(RATE_KEY), "0"));
      setCod(asBool(byKey.get(COD_KEY), true));
      setError(null);
    } catch (err) {
      setError(err);
    }
    // Soft check only: if VAT will be charged, invoices should carry
    // the shop's VAT registration number. Failure to load the template
    // (e.g. no template permission) just skips the warning.
    try {
      const state = await invoiceTemplateApi.get();
      const config = state.activeVersion?.config as
        | { taxRegistrationNumber?: string | null }
        | undefined;
      setVatRegMissing(!config?.taxRegistrationNumber);
    } catch {
      setVatRegMissing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rateNumber = Number(rate);
  const showVatWarning =
    vatRegMissing && DECIMAL_RE.test(rate.trim()) && Number.isFinite(rateNumber) && rateNumber > 0;

  const save = async () => {
    if (fee === null) return;
    const feeText = fee.trim();
    const rateText = rate.trim();
    if (!DECIMAL_RE.test(feeText) || Number(feeText) > 100_000) {
      setError(new Error("Shipping fee must be an amount in rupees (0 – 100,000) with at most 2 decimal places."));
      return;
    }
    if (!DECIMAL_RE.test(rateText) || Number(rateText) > 100) {
      setError(new Error("VAT rate must be a percentage between 0 and 100 with at most 2 decimal places."));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await settingsApi.update([
        { key: FEE_KEY, value: feeText },
        { key: RATE_KEY, value: rateText },
        { key: COD_KEY, value: cod },
      ]);
      setNotice(`Store settings saved at ${new Date().toLocaleTimeString()} — the shop, checkout and invoices now use these values; the change is recorded in the audit log.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-sm border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="font-display text-base font-medium">Store settings</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What the Gift Shop charges at checkout. Changes apply to new orders immediately; orders already
          placed keep the amounts they were placed with.
        </p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <ErrorBox error={error} />
        {notice && <Notice>{notice}</Notice>}
        {fee === null ? (
          <Spinner label="Loading store settings…" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shipping flat fee (Rs)" hint="Charged once per order. 0 means free delivery.">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="VAT rate (%)" hint="Added to the order subtotal at checkout. 0 means no VAT is charged.">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
            {showVatWarning && (
              <p className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                VAT is switched on but no VAT registration number is set, so invoices will show VAT without
                one. Add it under Invoice template → “VAT registration number” once the shop supplies it.
              </p>
            )}
            <div className="flex items-center justify-between gap-4">
              <Field label="Cash on delivery (COD)" hint="When off, customers cannot place COD orders.">
                <Switch checked={cod} onChange={setCod} label="Cash on delivery" />
              </Field>
              <Btn variant="primary" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save store settings"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
