/**
 * Pages list — every CMS page with its publication state, plus create
 * and delete. System pages (the seven original routes) cannot be
 * deleted; the server enforces that too and its message is surfaced.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, pagePath, pagesApi } from "../api";
import { useAuth } from "../AdminApp";
import type { PageAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, formatDateTime, inputCls } from "../ui";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function PagesList() {
  const { hasPermission } = useAuth();
  const [pages, setPages] = useState<PageAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<PageAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await pagesApi.list();
      setPages(data.items);
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
      await pagesApi.remove(deleting.id);
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
          <h1 className="font-display text-3xl tracking-wide">Pages</h1>
          <p className="text-sm text-muted-foreground">Drafts are private until published.</p>
        </div>
        {hasPermission("cms.pages.create") && (
          <Btn variant="accent" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New page
          </Btn>
        )}
      </div>

      <ErrorBox error={error} />

      {pages === null ? (
        <Spinner label="Loading pages…" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Title</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Slug</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Status</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Updated</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <span className="font-medium">{page.title}</span>{" "}
                    {page.isSystem && <Badge>System</Badge>}{" "}
                    {page.hasUnpublishedChanges && <Badge tone="accent">Unpublished changes</Badge>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{pagePath(page.slug)}</td>
                  <td className="px-4 py-3">{page.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(page.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <a
                        href={pagePath(page.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        View
                      </a>
                      <Link
                        to={`/admin/pages/${page.id}/edit`}
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                      >
                        <Pencil size={13} /> Edit
                      </Link>
                      {!page.isSystem && hasPermission("cms.pages.delete") && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(page);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreatePageDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete page"
        danger
        busy={deleteBusy}
        confirmLabel="Delete page"
        body={
          <div className="space-y-3">
            <p>
              Delete <strong>{deleting?.title}</strong> ({deleting ? pagePath(deleting.slug) : ""})? This removes the
              page and all its revisions. This cannot be undone.
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

function CreatePageDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pagesApi.create({ title: title.trim(), slug: slug.trim() });
      setTitle("");
      setSlug("");
      setSlugTouched(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not create the page."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New page">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
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
        <Field label="Slug" hint="Lowercase letters, numbers and hyphens. Reserved routes (admin, login, api…) are rejected by the server.">
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
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Creating…" : "Create page"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
