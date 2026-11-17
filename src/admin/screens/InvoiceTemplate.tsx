/**
 * Invoice template editor (Phase 7) — store.invoice_templates.manage.
 *
 * The template is validated configuration only (company identity,
 * prefix, colours, footer/terms, field toggles, logo) — never markup.
 * Every save creates a NEW immutable version and makes it active;
 * invoices already issued keep the version frozen in their snapshot,
 * so edits apply to the next approved order only.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ImagePlus, X } from "lucide-react";
import { invoiceTemplateApi } from "../api";
import MediaPicker from "../MediaPicker";
import type {
  InvoiceTemplateConfigAdmin,
  InvoiceTemplateStateAdmin,
  MediaAsset,
} from "../types";
import {
  Badge,
  Btn,
  ErrorBox,
  Field,
  Notice,
  Spinner,
  Switch,
  formatDateTime,
  inputCls,
} from "../ui";
import { orNull } from "./module-shared";

const TOGGLES: Array<{ key: keyof InvoiceTemplateConfigAdmin["show"]; label: string }> = [
  { key: "logo", label: "Logo in the header" },
  { key: "companyPhone", label: "Company phone" },
  { key: "companyEmail", label: "Company email" },
  { key: "taxRegistrationNumber", label: "Tax registration number" },
  { key: "deliveryAddress", label: "Delivery address block" },
  { key: "paymentMethod", label: "Payment method line" },
  { key: "terms", label: "Terms text" },
  { key: "footer", label: "Footer text" },
];

export default function InvoiceTemplateScreen() {
  const [state, setState] = useState<InvoiceTemplateStateAdmin | null>(null);
  const [config, setConfig] = useState<InvoiceTemplateConfigAdmin | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const applyState = useCallback((next: InvoiceTemplateStateAdmin) => {
    setState(next);
    setConfig(next.activeVersion ? structuredClone(next.activeVersion.config) : null);
  }, []);

  useEffect(() => {
    invoiceTemplateApi
      .get()
      .then(applyState)
      .catch((err) => setError(err));
  }, [applyState]);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="font-display text-3xl tracking-wide">Invoice Template</h1>
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!state || !config) {
    return (
      <div className="mx-auto max-w-4xl">
        <Spinner label="Loading invoice template…" />
      </div>
    );
  }

  const set = <K extends keyof InvoiceTemplateConfigAdmin>(key: K, value: InvoiceTemplateConfigAdmin[K]) =>
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  const setToggle = (key: keyof InvoiceTemplateConfigAdmin["show"], value: boolean) =>
    setConfig((prev) => (prev ? { ...prev, show: { ...prev.show, [key]: value } } : prev));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const next = await invoiceTemplateApi.update({
        ...config,
        companyPhone: orNull(config.companyPhone ?? ""),
        companyEmail: orNull(config.companyEmail ?? ""),
        taxRegistrationNumber: orNull(config.taxRegistrationNumber ?? ""),
        footerText: orNull(config.footerText ?? ""),
        termsText: orNull(config.termsText ?? ""),
      });
      applyState(next);
      setNotice(
        `Saved as version ${next.activeVersion?.versionNo}. Invoices already issued keep their version — this one applies to the next approved order.`,
      );
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const onPickLogo = (asset: MediaAsset) => {
    set("logoMediaId", asset.id);
    setPickerOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Invoice Template</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            How invoices look and what they say. Saving creates a new version —{" "}
            <strong>issued invoices never change</strong>; the new version applies to the next
            approved order.
          </p>
        </div>
        <a
          href={invoiceTemplateApi.previewUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-border bg-background px-4 text-sm font-medium hover:bg-secondary"
        >
          <ExternalLink size={15} /> Preview PDF
        </a>
      </div>

      <Notice>{notice}</Notice>
      <ErrorBox error={saveError} />

      <section className="space-y-4 rounded-sm border border-border p-5">
        <h2 className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
          Company identity
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <input className={inputCls} value={config.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Invoice prefix" hint="Starts every invoice number, e.g. INV → INV-2026-00001.">
            <input className={inputCls} value={config.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value)} />
          </Field>
        </div>
        <Field label="Company address">
          <textarea className={inputCls} rows={3} value={config.companyAddress} onChange={(e) => set("companyAddress", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company phone">
            <input className={inputCls} value={config.companyPhone ?? ""} onChange={(e) => set("companyPhone", e.target.value)} />
          </Field>
          <Field label="Company email">
            <input className={inputCls} type="email" value={config.companyEmail ?? ""} onChange={(e) => set("companyEmail", e.target.value)} />
          </Field>
        </div>
        <Field
          label="Tax registration number (optional)"
          hint="Shown on invoices only when filled in — leave empty until the client supplies it."
        >
          <input
            className={inputCls}
            value={config.taxRegistrationNumber ?? ""}
            onChange={(e) => set("taxRegistrationNumber", e.target.value)}
          />
        </Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {config.logoMediaId != null ? (
              <>
                <img
                  src={`/api/media/${config.logoMediaId}/file/master`}
                  alt="Invoice logo"
                  className="h-12 max-w-40 rounded-sm border border-border bg-white object-contain p-1"
                />
                <Btn size="sm" onClick={() => setPickerOpen(true)}>
                  <ImagePlus size={13} /> Change logo
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => set("logoMediaId", null)}>
                  <X size={13} /> Remove
                </Btn>
              </>
            ) : (
              <Btn size="sm" onClick={() => setPickerOpen(true)}>
                <ImagePlus size={13} /> Choose from media library
              </Btn>
            )}
          </div>
        </Field>
      </section>

      <section className="space-y-4 rounded-sm border border-border p-5">
        <h2 className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
          Appearance & content
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary colour">
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={config.primaryColor}
                onChange={(e) => set("primaryColor", e.target.value)}
                className="h-9 w-12 shrink-0 rounded-sm border border-border bg-background p-1"
                aria-label="Primary colour picker"
              />
              <input className={inputCls} value={config.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
            </span>
          </Field>
          <Field label="Accent colour">
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={config.accentColor}
                onChange={(e) => set("accentColor", e.target.value)}
                className="h-9 w-12 shrink-0 rounded-sm border border-border bg-background p-1"
                aria-label="Accent colour picker"
              />
              <input className={inputCls} value={config.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
            </span>
          </Field>
        </div>
        <Field label="Footer text">
          <input className={inputCls} value={config.footerText ?? ""} onChange={(e) => set("footerText", e.target.value)} />
        </Field>
        <Field label="Terms text">
          <textarea className={inputCls} rows={4} value={config.termsText ?? ""} onChange={(e) => set("termsText", e.target.value)} />
        </Field>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{toggle.label}</span>
              <Switch
                checked={config.show[toggle.key]}
                onChange={(next) => setToggle(toggle.key, next)}
                label={toggle.label}
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <Btn variant="accent" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save as new version"}
        </Btn>
      </div>

      <section className="overflow-hidden rounded-sm border border-border">
        <h2 className="border-b border-border bg-card px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
          Versions
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {[...state.versions]
              .sort((a, b) => b.versionNo - a.versionNo)
              .map((version) => (
                <tr key={version.id} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-3 font-medium">Version {version.versionNo}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(version.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {version.createdBy ? `By user #${version.createdBy}` : "Seeded default"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {state.activeVersion?.id === version.id && <Badge tone="accent">Active</Badge>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onPickLogo} />
    </div>
  );
}
