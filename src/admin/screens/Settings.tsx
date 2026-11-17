/**
 * Settings — site-wide key/value editor over GET/PUT /api/admin/settings.
 * Values keep their JSON type (string / number / boolean / JSON). Keys
 * that look secret-bearing are rendered read-only: secrets are never
 * settings, and this screen must not become a place to paste one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { settingsApi } from "../api";
import type { Setting } from "../types";
import { Badge, Btn, ErrorBox, Field, Notice, Spinner, Switch, cx, inputCls } from "../ui";

const SECRET_KEY_PATTERN = /secret|password|passwd|token|api[_-]?key|private|credential/i;

interface DraftSetting {
  key: string;
  /** Editor representation: raw text for the value. */
  text: string;
  kind: "string" | "number" | "boolean" | "json";
  isPublic: boolean;
  isNew?: boolean;
}

function toDraft(setting: Setting): DraftSetting {
  const value = setting.value;
  if (typeof value === "string") return { key: setting.key, text: value, kind: "string", isPublic: setting.isPublic };
  if (typeof value === "number") return { key: setting.key, text: String(value), kind: "number", isPublic: setting.isPublic };
  if (typeof value === "boolean") return { key: setting.key, text: value ? "true" : "false", kind: "boolean", isPublic: setting.isPublic };
  return { key: setting.key, text: JSON.stringify(value, null, 2), kind: "json", isPublic: setting.isPublic };
}

function parseDraft(draft: DraftSetting): unknown {
  switch (draft.kind) {
    case "number": {
      const parsed = Number(draft.text);
      return Number.isNaN(parsed) ? draft.text : parsed;
    }
    case "boolean":
      return draft.text === "true";
    case "json":
      return JSON.parse(draft.text);
    default:
      return draft.text;
  }
}

export default function SettingsScreen() {
  const [drafts, setDrafts] = useState<DraftSetting[] | null>(null);
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await settingsApi.list();
      const next = data.items.map(toDraft);
      setDrafts(next);
      setBaseline(JSON.stringify(next));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => drafts !== null && JSON.stringify(drafts) !== baseline,
    [drafts, baseline],
  );

  const patch = (index: number, part: Partial<DraftSetting>) => {
    setDrafts((prev) => (prev ?? []).map((d, i) => (i === index ? { ...d, ...part } : d)));
  };

  const save = async () => {
    if (!drafts) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const baselineDrafts: DraftSetting[] = baseline ? JSON.parse(baseline) : [];
      const baselineByKey = new Map(baselineDrafts.map((d) => [d.key, JSON.stringify(d)]));
      const changed = drafts.filter((d) => baselineByKey.get(d.key) !== JSON.stringify(d));
      const payload: Array<{ key: string; value: unknown; isPublic: boolean }> = [];
      for (const draft of changed) {
        let value: unknown;
        try {
          value = parseDraft(draft);
        } catch {
          throw new Error(`Setting “${draft.key}” contains invalid JSON.`);
        }
        payload.push({ key: draft.key, value, isPublic: draft.isPublic });
      }
      if (payload.length === 0) return;
      const result = await settingsApi.update(payload);
      const next = result.items.map(toDraft);
      setDrafts(next);
      setBaseline(JSON.stringify(next));
      setNotice(`Saved ${payload.length} setting(s) at ${new Date().toLocaleTimeString()} — the change is recorded in the audit log.`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const addSetting = () => {
    const key = newKey.trim();
    if (!key || !drafts) return;
    if (drafts.some((d) => d.key === key)) {
      setError(new Error(`Setting “${key}” already exists — edit it in the list.`));
      return;
    }
    setError(null);
    setDrafts([...drafts, { key, text: newValue, kind: "string", isPublic: false, isNew: true }]);
    setNewKey("");
    setNewValue("");
  };

  if (drafts === null) {
    return (
      <div className="space-y-4">
        <ErrorBox error={error} />
        {!error && <Spinner label="Loading settings…" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Site-wide values. “Public” settings are exposed to the website (contact details, opening hours); everything
          else stays server-side.
        </p>
      </div>

      <ErrorBox error={error} />
      {notice && <Notice>{notice}</Notice>}

      <div className="overflow-hidden rounded-sm border border-border">
        {drafts.map((draft, index) => {
          const secretLooking = SECRET_KEY_PATTERN.test(draft.key);
          return (
            <div key={draft.key} className="grid gap-3 border-t border-border bg-background px-4 py-3 first:border-t-0 md:grid-cols-[220px_1fr_auto] md:items-start">
              <div>
                <p className="break-all font-mono text-sm">{draft.key}</p>
                <div className="mt-1 flex gap-1.5">
                  {draft.isPublic ? <Badge tone="accent">Public</Badge> : <Badge>Private</Badge>}
                  {draft.isNew && <Badge tone="dark">New</Badge>}
                </div>
              </div>
              <div>
                {secretLooking ? (
                  <p className="rounded-sm bg-secondary px-3 py-2 text-sm text-muted-foreground">
                    Read-only: this key looks secret-bearing. Secrets are managed as server environment variables,
                    never as settings.
                  </p>
                ) : draft.kind === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={draft.text === "true"}
                      onChange={(next) => patch(index, { text: next ? "true" : "false" })}
                      label={`${draft.key} value`}
                    />
                    {draft.text === "true" ? "true" : "false"}
                  </label>
                ) : draft.kind === "json" || draft.text.length > 90 ? (
                  <textarea
                    className={cx(inputCls, "font-mono text-xs")}
                    rows={4}
                    value={draft.text}
                    onChange={(e) => patch(index, { text: e.target.value })}
                    aria-label={`${draft.key} value`}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={draft.kind === "number" ? "number" : "text"}
                    value={draft.text}
                    onChange={(e) => patch(index, { text: e.target.value })}
                    aria-label={`${draft.key} value`}
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.isPublic}
                  onChange={(next) => patch(index, { isPublic: next })}
                  label={`${draft.key} public`}
                />
                Public
              </label>
            </div>
          );
        })}
        {drafts.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No settings yet.</p>}
      </div>

      <div className="flex items-center gap-3">
        <Btn variant="accent" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save settings"}
        </Btn>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>

      <section aria-label="Add a setting" className="rounded-sm border border-border bg-card px-4 py-4">
        <h2 className="font-display text-lg tracking-wide">Add a setting</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
          <Field label="Key" hint="lowercase_letters, numbers, underscores">
            <input className={inputCls} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. ticket_price_note" />
          </Field>
          <Field label="Value">
            <input className={inputCls} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </Field>
          <Btn onClick={addSetting} disabled={!newKey.trim()}>
            <Plus size={15} /> Add
          </Btn>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">New settings are private until you mark them public, and are stored when you save.</p>
      </section>
    </div>
  );
}
