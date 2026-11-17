/**
 * Product Categories admin (Phase 6) — store.categories.manage.
 * Simple CRUD over /api/admin/product-categories. Deleting a category
 * that products still reference is refused by the API (409) and the
 * message surfaces in the confirm dialog.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, storeApi } from "../api";
import type { ProductCategoryAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, Switch, inputCls } from "../ui";
import { orNull, slugify } from "./module-shared";

export default function ProductCategoriesScreen() {
  const [items, setItems] = useState<ProductCategoryAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<ProductCategoryAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProductCategoryAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await storeApi.listCategories();
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await storeApi.removeCategory(deleting.id);
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
          <h1 className="font-display text-3xl tracking-wide">Product Categories</h1>
          <p className="text-sm text-muted-foreground">The Gift Shop's category tabs, in sort order. Inactive categories are hidden from the shop.</p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New category
        </Btn>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading categories…" />
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No categories yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Description</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Sort</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((cat) => (
                <tr key={cat.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <span className="font-medium">{cat.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{cat.slug}</span>
                  </td>
                  <td className="max-w-72 truncate px-4 py-3 text-muted-foreground">{cat.description ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{cat.sortOrder}</td>
                  <td className="px-4 py-3">
                    {cat.isActive ? <Badge tone="accent">Active</Badge> : <Badge>Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                        onClick={() => setEditing(cat)}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(cat);
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
        <CategoryForm
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
        title="Delete category"
        danger
        busy={deleteBusy}
        confirmLabel="Delete category"
        body={
          <div className="space-y-3">
            <p>
              Delete <strong>{deleting?.name}</strong>? Categories referenced by products cannot be
              deleted — archive or recategorise those products first.
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

function CategoryForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ProductCategoryAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sortOrder, setSortOrder] = useState(initial != null ? String(initial.sortOrder) : "0");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedSort = Number(sortOrder);
    if (!Number.isInteger(parsedSort)) {
      setError(new Error("Sort order must be a whole number."));
      return;
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      slug: slug.trim(),
      description: orNull(description),
      sortOrder: parsedSort,
      isActive,
    };
    try {
      if (initial) await storeApi.updateCategory(initial.id, body);
      else await storeApi.createCategory(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the category."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit category — ${initial.name}` : "New category"}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
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
        <Field label="Description">
          <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sort order" hint="Lower numbers appear first in the shop tabs.">
            <input className={inputCls} type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <div className="flex items-end pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onChange={setIsActive} label="Active" /> Active
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create category"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
