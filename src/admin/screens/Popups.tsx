/**
 * Website Popup admin (2026-11-20) — popup.manage.
 *
 * Announcement / welcome / advertising popup shown ONCE per visitor
 * on the home page. Admins create popups with an image (media
 * library), heading, message and an optional button link, then Show
 * (activate) / Hide (deactivate) / delete them. At most one popup is
 * live at a time — showing one hides whichever was live. Editing the
 * content of a popup bumps its version, so visitors who saw the old
 * version see the updated one once more; merely hiding and re-showing
 * unchanged content does NOT re-show it.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { ApiError, popupsApi } from "../api";
import MediaPicker from "../MediaPicker";
import type { MediaAsset, PopupAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Notice, Spinner, formatDateTime, inputCls } from "../ui";
import { orNull } from "./module-shared";

export default function PopupsScreen() {
  const [items, setItems] = useState<PopupAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<PopupAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PopupAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const data = await popupsApi.list();
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (popup: PopupAdmin) => {
    setTogglingId(popup.id);
    setToggleError(null);
    try {
      if (popup.isActive) await popupsApi.deactivate(popup.id);
      else await popupsApi.activate(popup.id);
      await load();
    } catch (err) {
      setToggleError(err);
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await popupsApi.remove(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Site Announcement</h1>
          <p className="text-sm text-muted-foreground">
            A welcome or announcement popup on the home page. Each visitor sees it only once.
          </p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New popup
        </Btn>
      </div>

      <Notice>
        Only <strong>one popup is live at a time</strong> — showing a popup automatically hides the
        one that was live. Visitors see the live popup once; if you later edit its image, heading,
        message or link and save, they will see the updated version once more. Hiding and
        re-showing unchanged content does not show it again.
      </Notice>

      <ErrorBox error={error} />
      <ErrorBox error={toggleError} />

      {items === null ? (
        <Spinner label="Loading popups…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No popups yet. Create one, then press <strong>Show</strong> to put it on the home page.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Popup</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Button</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Version</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Updated</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((popup) => (
                <tr key={popup.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {popup.imageUrl ? (
                        <img src={popup.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded-sm object-cover" />
                      ) : (
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                          <ImagePlus size={15} />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{popup.heading}</span>
                        <span className="block max-w-72 truncate text-xs text-muted-foreground">{popup.message}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {popup.linkUrl ? (
                      <>
                        <span className="block font-medium text-foreground">{popup.buttonLabel}</span>
                        <span className="block max-w-44 truncate font-mono">{popup.linkUrl}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">v{popup.version}</td>
                  <td className="px-4 py-3">
                    {popup.isActive ? <Badge tone="accent">Live</Badge> : <Badge>Hidden</Badge>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(popup.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                        disabled={togglingId === popup.id}
                        onClick={() => void toggle(popup)}
                      >
                        {popup.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                        {togglingId === popup.id ? "Working…" : popup.isActive ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                        onClick={() => setEditing(popup)}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(popup);
                        }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <PopupForm
          key={editing?.id ?? "new"}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete popup"
        danger
        busy={deleteBusy}
        confirmLabel="Delete popup"
        body={
          <div className="space-y-3">
            <p>
              Delete <strong>{deleting?.heading}</strong>?
              {deleting?.isActive
                ? " It is LIVE right now — deleting it takes it off the home page immediately."
                : " This cannot be undone."}
            </p>
            <ErrorBox error={deleteError} />
          </div>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function PopupForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: PopupAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [heading, setHeading] = useState(initial?.heading ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [imageMediaId, setImageMediaId] = useState<number | null>(initial?.imageMediaId ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [buttonLabel, setButtonLabel] = useState(initial?.buttonLabel ?? "");
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const link = linkUrl.trim();
    const label = buttonLabel.trim();
    if (link && !label) {
      setError(new Error("Give the button a label — a link without button text cannot be shown."));
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      heading: heading.trim(),
      message: message.trim(),
      imageMediaId,
      buttonLabel: orNull(label),
      linkUrl: orNull(link),
    };
    try {
      if (initial) await popupsApi.update(initial.id, body);
      else await popupsApi.create(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the popup."));
    } finally {
      setBusy(false);
    }
  };

  const pickImage = (asset: MediaAsset) => {
    setImageMediaId(asset.id);
    setImageUrl(asset.urls.master);
    setPickerOpen(false);
  };

  return (
    <Modal open wide onClose={onClose} title={initial ? `Edit popup — ${initial.heading}` : "New popup"}>
      <form onSubmit={submit}>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <ErrorBox error={error} />
            <Field label="Heading">
              <input className={inputCls} value={heading} onChange={(e) => setHeading(e.target.value)} required maxLength={160} autoFocus />
            </Field>
            <Field label="Message" hint={`${message.length}/2000 characters. Line breaks are kept.`}>
              <textarea className={inputCls} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={2000} />
            </Field>
            <Field label="Image" hint="Optional. Shown at the top of the popup.">
              {imageUrl ? (
                <div className="flex items-start gap-3">
                  <img src={imageUrl} alt="" className="h-20 w-32 rounded-sm object-cover" />
                  <div className="flex flex-col gap-1.5">
                    <Btn type="button" size="sm" onClick={() => setPickerOpen(true)}>
                      <ImagePlus size={14} /> Change image
                    </Btn>
                    <Btn
                      type="button"
                      size="sm"
                      onClick={() => {
                        setImageMediaId(null);
                        setImageUrl(null);
                      }}
                    >
                      <X size={14} /> Remove
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn type="button" onClick={() => setPickerOpen(true)}>
                  <ImagePlus size={15} /> Choose from media library
                </Btn>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button label" hint="Required when a link is set.">
                <input className={inputCls} value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} maxLength={80} placeholder="Visit the Gift Shop" />
              </Field>
              <Field label="Button link" hint="A web address (https://…) or a page on this site (/shop, /exhibitions).">
                <input className={inputCls} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} maxLength={500} placeholder="/shop" />
              </Field>
            </div>
            {initial && (
              <p className="text-xs text-muted-foreground">
                Saving changes to the heading, message, image or link makes this version {initial.version + 1} —
                visitors who saw version {initial.version} will see the updated popup once more.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Visitor preview</p>
            <div className="rounded-md bg-black/40 p-4">
              <PopupPreview heading={heading} message={message} imageUrl={imageUrl} buttonLabel={buttonLabel.trim()} linkUrl={linkUrl.trim()} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Shown once, in the middle of the home page, shortly after it opens. The visitor closes
              it with the × button, the dark area around it, or the Esc key.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create popup"}
          </Btn>
        </div>
      </form>

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pickImage} />
    </Modal>
  );
}

/** The popup exactly as a visitor sees it (static preview). */
function PopupPreview({
  heading,
  message,
  imageUrl,
  buttonLabel,
  linkUrl,
}: {
  heading: string;
  message: string;
  imageUrl: string | null;
  buttonLabel: string;
  linkUrl: string;
}) {
  return (
    <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-md bg-background shadow-xl">
      <span className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/50 text-background">
        <X size={15} />
      </span>
      {imageUrl && <img src={imageUrl} alt="" className="aspect-[16/9] w-full object-cover" />}
      <div className="space-y-2 p-4 text-center">
        <p className="font-display text-lg leading-snug text-foreground">{heading || "Your heading"}</p>
        <p className="whitespace-pre-line text-sm font-light text-muted-foreground">{message || "Your message will appear here."}</p>
        {linkUrl && (
          <span className="mt-1 inline-block rounded-sm bg-accent px-4 py-2 text-xs font-medium tracking-wide text-accent-foreground">
            {buttonLabel || "Button"}
          </span>
        )}
      </div>
    </div>
  );
}
