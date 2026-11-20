/**
 * Policies — the three legal pages (Privacy Policy, Terms of Use,
 * Accessibility). Fixed pages: no create/delete. Editing publishes
 * immediately, but the server snapshots the previous content as a
 * revision on every save, and any revision can be viewed and
 * restored from here. Saves carry the loaded version; if someone
 * else saved first, the server answers 409 and this screen offers a
 * reload instead of silently overwriting their work.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, History, Pencil, RotateCcw } from "lucide-react";
import { ApiError, policiesApi } from "../api";
import { RichTextFieldLazy } from "../fields";
import MediaPicker from "../MediaPicker";
import type { MediaAsset, PolicyAdmin, PolicyRevision, PolicyRevisionDetail } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Notice, Spinner, formatDateTime, inputCls } from "../ui";

const PUBLIC_PATH: Record<string, string> = {
  "privacy-policy": "/privacy-policy",
  "terms-of-use": "/terms-of-use",
  accessibility: "/accessibility",
};

export default function PoliciesScreen() {
  const [items, setItems] = useState<PolicyAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<PolicyAdmin | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await policiesApi.list();
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (selected) {
    return (
      <PolicyEditor
        policy={selected}
        onBack={() => {
          setSelected(null);
          void load();
        }}
        onSaved={(next) => {
          setSelected(next);
          setItems((prev) => prev.map((p) => (p.slug === next.slug ? next : p)));
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-foreground">Policy Pages</h1>
        <p className="mt-1 max-w-2xl font-sans text-sm text-muted-foreground">
          The three pages linked at the bottom of every page of the website. Saving an edit publishes it
          immediately — the previous version is kept in the page history and can be restored at any time.
        </p>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          {items.map((policy) => (
            <div
              key={policy.slug}
              className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-sans text-sm font-medium text-foreground">{policy.title}</span>
                  <Badge>Version {policy.version}</Badge>
                  {policy.revisionsCount > 0 ? <Badge tone="muted">{policy.revisionsCount} in history</Badge> : null}
                </div>
                <div className="mt-0.5 font-mono text-[0.68rem] tracking-wider text-muted-foreground">
                  {PUBLIC_PATH[policy.slug]} · Updated {formatDateTime(policy.updatedAt)}
                </div>
              </div>
              <a
                href={PUBLIC_PATH[policy.slug]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-sans text-xs text-accent hover:underline"
              >
                View page <ExternalLink size={12} />
              </a>
              <Btn size="sm" onClick={() => setSelected(policy)}>
                <Pencil size={13} /> Edit
              </Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyEditor({
  policy,
  onBack,
  onSaved,
}: {
  policy: PolicyAdmin;
  onBack: () => void;
  onSaved: (next: PolicyAdmin) => void;
}) {
  const [title, setTitle] = useState(policy.title);
  const [bodyHtml, setBodyHtml] = useState(policy.bodyHtml);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [revisions, setRevisions] = useState<PolicyRevision[]>([]);
  const [viewing, setViewing] = useState<PolicyRevisionDetail | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<PolicyRevision | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickResolver = useRef<((value: { url: string; alt: string } | null) => void) | null>(null);

  const loadRevisions = useCallback(async () => {
    try {
      const data = await policiesApi.revisions(policy.slug);
      setRevisions(data.items);
    } catch {
      // History is auxiliary; the editor itself reports its own errors.
    }
  }, [policy.slug]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions, policy.version]);

  // When a save/restore replaces the policy, adopt the server copy.
  useEffect(() => {
    setTitle(policy.title);
    setBodyHtml(policy.bodyHtml);
  }, [policy]);

  const mediaPick = useCallback(
    () =>
      new Promise<{ url: string; alt: string } | null>((resolve) => {
        pickResolver.current = resolve;
        setPickerOpen(true);
      }),
    [],
  );

  const settlePick = (value: { url: string; alt: string } | null) => {
    setPickerOpen(false);
    pickResolver.current?.(value);
    pickResolver.current = null;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const next = await policiesApi.update(policy.slug, { title, bodyHtml, version: policy.version });
      onSaved(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setError(err);
    } finally {
      setSaving(false);
      setConfirmPublish(false);
    }
  };

  const reloadLatest = async () => {
    try {
      const fresh = await policiesApi.get(policy.slug);
      onSaved(fresh);
      setConflict(false);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    try {
      const next = await policiesApi.restore(policy.slug, {
        revisionId: restoreTarget.id,
        version: policy.version,
      });
      onSaved(next);
      setRestoreTarget(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setError(err);
    } finally {
      setRestoring(false);
    }
  };

  const dirty = title !== policy.title || bodyHtml !== policy.bodyHtml;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Btn size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} /> All policy pages
        </Btn>
        <h1 className="font-serif text-2xl text-foreground">{policy.title}</h1>
        <Badge>Version {policy.version}</Badge>
      </div>

      <Notice tone="warn">
        Saving publishes to the live website immediately. The current version is kept in the history below and can
        be restored. This text began as a starter draft — please have it reviewed before relying on it legally.
      </Notice>
      {error ? <ErrorBox error={error} /> : null}
      {conflict ? (
        <Notice tone="warn">
          Someone else saved this page after you opened it, so your save was stopped to protect their work.{" "}
          <button type="button" className="underline" onClick={() => void reloadLatest()}>
            Reload the latest version
          </button>{" "}
          and make your edit again.
        </Notice>
      ) : null}

      <Field label="Page title">
        <input className={inputCls} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Page content" hint="Use Heading 2 for each section — the public page builds its table of contents from them.">
        <RichTextFieldLazy value={bodyHtml} onChange={setBodyHtml} ariaLabel="Policy content" mediaPick={mediaPick} />
      </Field>

      <div className="flex items-center gap-2">
        <Btn variant="primary" disabled={!dirty || saving} onClick={() => setConfirmPublish(true)}>
          {saving ? "Publishing…" : "Save and publish"}
        </Btn>
        <a
          href={PUBLIC_PATH[policy.slug]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-sans text-xs text-accent hover:underline"
        >
          View live page <ExternalLink size={12} />
        </a>
      </div>

      <div className="pt-2">
        <h2 className="flex items-center gap-2 font-sans text-sm font-medium text-foreground">
          <History size={14} /> History
        </h2>
        {revisions.length === 0 ? (
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            No earlier versions yet. The first time you save, the current content will be kept here.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-sm border border-border">
            {revisions.map((rev) => (
              <div
                key={rev.id}
                className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-sans text-sm text-foreground">Version {rev.version}</span>
                  <span className="ml-2 font-mono text-[0.68rem] tracking-wider text-muted-foreground">
                    Replaced {formatDateTime(rev.createdAt)}
                  </span>
                </div>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      setViewing(await policiesApi.revision(policy.slug, rev.id));
                    } catch (err) {
                      setError(err);
                    }
                  }}
                >
                  View
                </Btn>
                <Btn size="sm" onClick={() => setRestoreTarget(rev)}>
                  <RotateCcw size={13} /> Restore
                </Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmPublish}
        title="Publish this page now?"
        body="The new text becomes the live page as soon as you confirm. The current version moves into the history and can be restored."
        confirmLabel="Publish"
        busy={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirmPublish(false)}
      />
      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore this earlier version?"
        body="The restored text becomes the live page. The version currently live moves into the history, so this can be undone."
        confirmLabel="Restore"
        busy={restoring}
        onConfirm={() => void restore()}
        onCancel={() => setRestoreTarget(null)}
      />
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing ? `Version ${viewing.version} — ${viewing.title}` : ""} wide>
        {viewing ? (
          <div
            className="font-sans text-sm leading-relaxed text-foreground [&_h2]:mb-1.5 [&_h2:mt-4 [&_h2:text-lg [&_h2:font-medium [&_h3]:mb-1 [&_h3:mt-3 [&_h3:font-medium [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: viewing.bodyHtml }}
          />
        ) : null}
      </Modal>
      <MediaPicker
        open={pickerOpen}
        onClose={() => settlePick(null)}
        onPick={(asset: MediaAsset) => settlePick({ url: asset.urls.master, alt: asset.altText ?? "" })}
      />
    </div>
  );
}
