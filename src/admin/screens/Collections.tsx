/**
 * Collections admin (Phase 5) — museum.collections.manage.
 * List with order buttons (reorder endpoint), create/edit form,
 * delete with confirm. Image: media-library cover + legacy URL fields.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, collectionsApi } from "../api";
import type { CollectionAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, Switch, inputCls } from "../ui";
import { ImageFields, moveAndReorder, orNull, recordThumb, slugify, OrderButtons } from "./module-shared";

export const COLLECTION_CATEGORIES = ["Sculpture", "Painting", "Manuscripts", "Coins", "Textiles", "Contemporary"];

export default function CollectionsScreen() {
  const [items, setItems] = useState<CollectionAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<CollectionAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CollectionAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await collectionsApi.list();
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
    void moveAndReorder(items, index, dir, (ids) => collectionsApi.reorder(ids), setItems, setError, load);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await collectionsApi.remove(deleting.id);
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
          <h1 className="font-display text-3xl tracking-wide">Collections</h1>
          <p className="text-sm text-muted-foreground">Permanent-collection records shown on Home and Museum. Order here is the public order.</p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New collection
        </Btn>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading collections…" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Collection</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((col, i) => {
                const thumb = recordThumb(col);
                return (
                  <tr key={col.id} className="border-t border-border bg-background hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-10 w-12 rounded-sm border border-border object-cover" />
                        ) : (
                          <span className="h-10 w-12 rounded-sm border border-dashed border-border" />
                        )}
                        <span>
                          <span className="font-medium">{col.name}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{col.slug}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{col.category ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="flex gap-1.5">
                        {col.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}
                        {col.isFeatured && <Badge tone="dark">Featured</Badge>}
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
                          onClick={() => setEditing(col)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(col);
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
        <CollectionForm
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
        title="Delete collection"
        danger
        busy={deleteBusy}
        confirmLabel="Delete collection"
        body={
          <div className="space-y-3">
            <p>
              Delete <strong>{deleting?.name}</strong>? It will disappear from the public site. This cannot be undone.
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

function CollectionForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: CollectionAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [category, setCategory] = useState(initial?.category ?? "");
  const [periodLabel, setPeriodLabel] = useState(initial?.periodLabel ?? "");
  const [itemCount, setItemCount] = useState(initial?.itemCount != null ? String(initial.itemCount) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [history, setHistory] = useState(initial?.history ?? "");
  const [coverMediaId, setCoverMediaId] = useState<number | null>(initial?.coverMediaId ?? null);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [imageAlt, setImageAlt] = useState(initial?.imageAlt ?? "");
  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const parsedCount = itemCount.trim() === "" ? null : Number(itemCount);
    if (parsedCount !== null && (!Number.isInteger(parsedCount) || parsedCount < 0)) {
      setError(new Error("Item count must be a whole number of 0 or more."));
      setBusy(false);
      return;
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      slug: slug.trim(),
      category: orNull(category),
      periodLabel: orNull(periodLabel),
      itemCount: parsedCount,
      description: orNull(description),
      history: orNull(history),
      coverMediaId,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isFeatured,
      isPublished,
    };
    try {
      if (initial) await collectionsApi.update(initial.id, body);
      else await collectionsApi.create(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the collection."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit collection — ${initial.name}` : "New collection"} wide>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
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
          <Field label="Category" hint="Drives the Museum page filter buttons.">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">No category</option>
              {COLLECTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period label" hint="Shown on the Home card, e.g. “1st – 5th Century CE”. Leave empty to omit.">
            <input className={inputCls} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
          </Field>
          <Field label="Item count" hint="Shown publicly as “N works”.">
            <input className={inputCls} type="number" min={0} step={1} value={itemCount} onChange={(e) => setItemCount(e.target.value)} />
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
        <Field label="History">
          <textarea className={inputCls} rows={3} value={history} onChange={(e) => setHistory(e.target.value)} />
        </Field>
        <ImageFields
          mediaId={coverMediaId}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          onPatch={(patch) => {
            if (patch.mediaId !== undefined) setCoverMediaId(patch.mediaId);
            if (patch.imageUrl !== undefined) setImageUrl(patch.imageUrl);
            if (patch.imageAlt !== undefined) setImageAlt(patch.imageAlt);
          }}
        />
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create collection"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
