/**
 * Exhibitions admin (Phase 5) — museum.exhibitions.manage.
 * List with order buttons, create/edit form, delete with confirm, and
 * a gallery-items manager inside the edit form (media picker add,
 * caption edit, reorder, delete) backed by the gallery-items endpoints.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ImagePlacement } from "../../app/lib/image-placement";
import { ApiError, exhibitionsApi, mediaApi } from "../api";
import MediaPicker from "../MediaPicker";
import type { ExhibitionAdmin, GalleryItemAdmin, MediaAsset } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, Switch, inputCls } from "../ui";
import { ImageFields, moveAndReorder, orNull, recordThumb, slugify, OrderButtons } from "./module-shared";

const EXHIBITION_CATEGORIES = ["buddhist", "historical", "thematic", "contemporary"];
const EXHIBITION_STATUSES = ["UPCOMING", "CURRENT", "PAST"];

export default function ExhibitionsScreen() {
  const [items, setItems] = useState<ExhibitionAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<ExhibitionAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ExhibitionAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await exhibitionsApi.list();
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = (index: number, dir: -1 | 1) => {
    if (!items) return;
    void moveAndReorder(items, index, dir, (ids) => exhibitionsApi.reorder(ids), setItems, setError, load);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await exhibitionsApi.remove(deleting.id);
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
          <h1 className="font-display text-3xl tracking-wide">Exhibitions</h1>
          <p className="text-sm text-muted-foreground">Exhibition records for the Gallery archive and the Home “On View Now” split. Order here is the public order.</p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New exhibition
        </Btn>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading exhibitions…" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Exhibition</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Dates</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ex, i) => {
                const thumb = recordThumb(ex);
                return (
                  <tr key={ex.id} className="border-t border-border bg-background hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-10 w-12 rounded-sm border border-border object-cover" />
                        ) : (
                          <span className="h-10 w-12 rounded-sm border border-dashed border-border" />
                        )}
                        <span>
                          <span className="font-medium">{ex.title}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{ex.slug}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{ex.status}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ex.startsOn ?? "—"} → {ex.endsOn ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex gap-1.5">
                        {ex.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}
                        {ex.isFeatured && <Badge tone="dark">Featured</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <OrderButtons index={i} total={items.length} onMove={move} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                          onClick={() => setEditing(ex)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(ex);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <ExhibitionForm
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
        title="Delete exhibition"
        danger
        busy={deleteBusy}
        confirmLabel="Delete exhibition"
        body={
          <div className="space-y-3">
            <p>
              Delete <strong>{deleting?.title}</strong>? It will disappear from the public site. This cannot be undone.
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

function ExhibitionForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ExhibitionAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [status, setStatus] = useState(initial?.status ?? "UPCOMING");
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [curator, setCurator] = useState(initial?.curator ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [coverAspect, setCoverAspect] = useState(initial?.coverAspect ?? "");
  const [coverMediaId, setCoverMediaId] = useState<number | null>(initial?.coverMediaId ?? null);
  const [coverPlacement, setCoverPlacement] = useState<ImagePlacement | null>(initial?.coverPlacement ?? null);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [imageAlt, setImageAlt] = useState(initial?.imageAlt ?? "");
  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // The placement editor previews the cover in its Gallery card frame,
  // which follows the Cover aspect select (placement itself is kept
  // when the aspect changes — the focal point is frame-independent).
  const coverPair: [number, number] = coverAspect === "tall" ? [3, 4] : [4, 3];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      slug: slug.trim(),
      location: orNull(location),
      status,
      startsOn: orNull(startsOn),
      endsOn: orNull(endsOn),
      description: orNull(description),
      curator: orNull(curator),
      category: orNull(category),
      coverAspect: orNull(coverAspect),
      coverMediaId,
      coverPlacement,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isFeatured,
      isPublished,
    };
    try {
      if (initial) await exhibitionsApi.update(initial.id, body);
      else await exhibitionsApi.create(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the exhibition."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit exhibition — ${initial.title}` : "New exhibition"} wide>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input
              className={inputCls}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
              autoFocus
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers and hyphens; must be unique.">
            <input
              className={inputCls}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              required
            />
          </Field>
          <Field label="Location" hint="Shown on the Home split, e.g. “Main Hall”.">
            <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Status" hint="“Current” records feed the Home split; the Gallery shows all published.">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {EXHIBITION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starts on">
            <input className={inputCls} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends on" hint="The Home “Until …” line derives from this date.">
            <input className={inputCls} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field label="Curator">
            <input className={inputCls} value={curator} onChange={(e) => setCurator(e.target.value)} />
          </Field>
          <Field label="Category" hint="Drives the Gallery category filter.">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">No category</option>
              {EXHIBITION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cover aspect" hint="Card shape in the Gallery masonry grid.">
            <select className={inputCls} value={coverAspect} onChange={(e) => setCoverAspect(e.target.value)}>
              <option value="">Standard (4:3)</option>
              <option value="tall">Tall (3:4)</option>
              <option value="standard">Standard (4:3)</option>
            </select>
          </Field>
          <div className="flex items-end gap-6 pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isFeatured} onChange={setIsFeatured} label="Featured" /> Featured
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isPublished} onChange={setIsPublished} label="Published" /> Published
            </span>
          </div>
        </div>
        <Field label="Description">
          <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ImageFields
          mediaId={coverMediaId}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          placement={coverPlacement}
          frame={{ label: "Gallery card", desktop: coverPair, tablet: coverPair, mobile: coverPair }}
          onPatch={(patch) => {
            if (patch.mediaId !== undefined) setCoverMediaId(patch.mediaId);
            if (patch.imageUrl !== undefined) setImageUrl(patch.imageUrl);
            if (patch.imageAlt !== undefined) setImageAlt(patch.imageAlt);
            if (patch.placement !== undefined) setCoverPlacement(patch.placement);
          }}
        />
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create exhibition"}
          </Btn>
        </div>
      </form>
      {initial && <GalleryItemsManager exhibitionId={initial.id} />}
    </Modal>
  );
}

/**
 * Gallery items for one exhibition. Items are managed live (each action
 * calls the API immediately), independent of the exhibition form above.
 */
function GalleryItemsManager({ exhibitionId }: { exhibitionId: number }) {
  const [items, setItems] = useState<GalleryItemAdmin[] | null>(null);
  const [mediaById, setMediaById] = useState<Map<number, MediaAsset>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newCaption, setNewCaption] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await exhibitionsApi.listGalleryItems(exhibitionId);
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [exhibitionId]);

  useEffect(() => {
    void load();
    mediaApi
      .list({ page: 1, pageSize: 100 })
      .then((data) => setMediaById(new Map(data.items.map((a) => [a.id, a]))))
      .catch(() => undefined);
  }, [load]);

  const move = (index: number, dir: -1 | 1) => {
    if (!items) return;
    void moveAndReorder(items, index, dir, (ids) => exhibitionsApi.reorderGalleryItems(ids), setItems, setError, load);
  };

  const addFromPicker = async (asset: MediaAsset) => {
    setPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      await exhibitionsApi.createGalleryItem(exhibitionId, {
        mediaId: asset.id,
        title: orNull(newTitle),
        caption: orNull(newCaption),
        isPublished: true,
      });
      setNewCaption("");
      setNewTitle("");
      setMediaById((prev) => new Map(prev).set(asset.id, asset));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const patchItem = async (item: GalleryItemAdmin, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await exhibitionsApi.updateGalleryItem(item.id, patch);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const removeItem = async (item: GalleryItemAdmin) => {
    setError(null);
    try {
      await exhibitionsApi.removeGalleryItem(item.id);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-5">
      <div>
        <h3 className="font-display text-lg tracking-wide">Gallery items</h3>
        <p className="text-sm text-muted-foreground">Images attached to this exhibition. Changes apply immediately.</p>
      </div>
      <ErrorBox error={error} />
      {items === null ? (
        <Spinner label="Loading gallery items…" />
      ) : (
        <>
          {items.length === 0 && <p className="text-sm text-muted-foreground">No gallery items yet.</p>}
          <ul className="space-y-2">
            {items.map((item, i) => {
              const asset = mediaById.get(item.mediaId);
              const thumb = asset ? (asset.urls.thumb ?? asset.urls.master) : `/api/media/${item.mediaId}/file/thumb`;
              return (
                <li key={item.id} className="flex items-center gap-3 rounded-sm border border-border px-3 py-2">
                  <img src={thumb} alt="" className="h-11 w-11 rounded-sm border border-border object-cover" />
                  <div className="min-w-0 flex-1">
                    <input
                      className={`${inputCls} mb-1`}
                      defaultValue={item.caption ?? ""}
                      placeholder="Caption…"
                      aria-label="Caption"
                      onBlur={(e) => {
                        const next = orNull(e.target.value);
                        if (next !== (item.caption ?? null)) void patchItem(item, { caption: next });
                      }}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      Media #{item.mediaId}
                      {item.title ? ` · ${item.title}` : ""}
                      {item.year ? ` · ${item.year}` : ""}
                    </span>
                  </div>
                  <span className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={item.isPublished}
                      onChange={(next) => void patchItem(item, { isPublished: next })}
                      label="Published"
                    />
                    Published
                  </span>
                  <OrderButtons index={i} total={items.length} onMove={move} />
                  <button
                    type="button"
                    aria-label="Delete gallery item"
                    className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    onClick={() => void removeItem(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New item title (optional)">
              <input className={inputCls} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </Field>
            <Field label="New item caption (optional)">
              <input className={inputCls} value={newCaption} onChange={(e) => setNewCaption(e.target.value)} />
            </Field>
          </div>
          <Btn type="button" size="sm" variant="accent" onClick={() => setPickerOpen(true)} disabled={busy}>
            <Plus size={14} /> {busy ? "Adding…" : "Add image from media library"}
          </Btn>
        </>
      )}
      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(asset) => void addFromPicker(asset)} />
    </div>
  );
}
