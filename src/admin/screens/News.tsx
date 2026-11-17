/**
 * News admin (Phase 5) — news.manage.
 * Articles list + form (category select from the API's categories,
 * document via media picker) and a categories manager whose delete
 * surfaces the server's 409 guard when articles still reference it.
 * Articles have no sort order — the public list is newest first.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { ApiError, newsApi } from "../api";
import MediaPicker from "../MediaPicker";
import type { MediaAsset, NewsArticleAdmin, NewsCategoryAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, Switch, inputCls } from "../ui";
import { ImageFields, orNull, slugify } from "./module-shared";

export default function NewsScreen() {
  const [articles, setArticles] = useState<NewsArticleAdmin[] | null>(null);
  const [categories, setCategories] = useState<NewsCategoryAdmin[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<NewsArticleAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NewsArticleAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [articleData, categoryData] = await Promise.all([newsApi.listArticles(), newsApi.listCategories()]);
      setArticles(articleData.items);
      setCategories(categoryData.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? "—";

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await newsApi.removeArticle(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-wide">News articles</h1>
            <p className="text-sm text-muted-foreground">Press clippings for the News page and the Home “Latest News” cards. Newest published date first.</p>
          </div>
          <Btn variant="accent" onClick={() => setCreating(true)}>
            <Plus size={16} /> New article
          </Btn>
        </div>

        <ErrorBox error={error} />

        {articles === null ? (
          <Spinner label="Loading articles…" />
        ) : (
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card text-left">
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Article</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Published</th>
                  <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.id} className="border-t border-border bg-background hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <span className="font-medium">{article.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {article.outlet ?? "—"} · <span className="font-mono">{article.slug}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{categoryName(article.categoryId)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{article.publishedOn ?? "—"}</td>
                    <td className="px-4 py-3">{article.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                          onClick={() => setEditing(article)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(article);
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
      </div>

      <CategoriesManager categories={categories} onChanged={load} />

      {(creating || editing) && (
        <ArticleForm
          key={editing?.id ?? "new"}
          initial={editing}
          categories={categories}
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
        title="Delete article"
        danger
        busy={deleteBusy}
        confirmLabel="Delete article"
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

function ArticleForm({
  initial,
  categories,
  onClose,
  onSaved,
}: {
  initial: NewsArticleAdmin | null;
  categories: NewsCategoryAdmin[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [outlet, setOutlet] = useState(initial?.outlet ?? "");
  const [publishedOn, setPublishedOn] = useState(initial?.publishedOn ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId != null ? String(initial.categoryId) : "");
  const [externalUrl, setExternalUrl] = useState(initial?.externalUrl ?? "");
  const [documentMediaId, setDocumentMediaId] = useState<number | null>(initial?.documentMediaId ?? null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [coverMediaId, setCoverMediaId] = useState<number | null>(initial?.coverMediaId ?? null);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [imageAlt, setImageAlt] = useState(initial?.imageAlt ?? "");
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      slug: slug.trim(),
      outlet: orNull(outlet),
      publishedOn: orNull(publishedOn),
      summary: orNull(summary),
      categoryId: categoryId === "" ? null : Number(categoryId),
      externalUrl: orNull(externalUrl),
      documentMediaId,
      coverMediaId,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isPublished,
    };
    try {
      if (initial) await newsApi.updateArticle(initial.id, body);
      else await newsApi.createArticle(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the article."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit article — ${initial.title}` : "New article"} wide>
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
          <Field label="Source / outlet">
            <input className={inputCls} value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="The Hindu" />
          </Field>
          <Field label="Published date">
            <input className={inputCls} type="date" value={publishedOn} onChange={(e) => setPublishedOn(e.target.value)} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="External URL" hint="Where “Read Article” points, when set.">
            <input className={inputCls} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Document (PDF clipping)" hint="Where “Download PDF” points, when set.">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText size={15} />
                {documentMediaId != null ? (documentName ?? `Media #${documentMediaId}`) : "No document"}
              </span>
              <Btn type="button" size="sm" onClick={() => setDocPickerOpen(true)}>
                {documentMediaId != null ? "Change…" : "Choose…"}
              </Btn>
              {documentMediaId != null && (
                <Btn type="button" size="sm" variant="ghost" onClick={() => setDocumentMediaId(null)}>
                  <X size={13} /> Clear
                </Btn>
              )}
            </div>
          </Field>
          <div className="flex items-end gap-6 pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isPublished} onChange={setIsPublished} label="Published" /> Published
            </span>
          </div>
        </div>
        <Field label="Summary">
          <textarea className={inputCls} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
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
            {busy ? "Saving…" : initial ? "Save changes" : "Create article"}
          </Btn>
        </div>
      </form>
      <MediaPicker
        open={docPickerOpen}
        onClose={() => setDocPickerOpen(false)}
        onPick={(asset: MediaAsset) => {
          setDocumentMediaId(asset.id);
          setDocumentName(asset.originalName ?? `Media #${asset.id}`);
          setDocPickerOpen(false);
        }}
      />
    </Modal>
  );
}

function CategoriesManager({
  categories,
  onChanged,
}: {
  categories: NewsCategoryAdmin[];
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [colorToken, setColorToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<NewsCategoryAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await newsApi.createCategory({ name: name.trim(), slug: slug.trim(), colorToken: orNull(colorToken) });
      setName("");
      setSlug("");
      setSlugTouched(false);
      setColorToken("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not create the category."));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await newsApi.removeCategory(deleting.id);
      setDeleting(null);
      await onChanged();
    } catch (err) {
      // The server refuses with 409 while articles reference the
      // category; its message is surfaced verbatim here.
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl tracking-wide">Categories</h2>
        <p className="text-sm text-muted-foreground">Article types shown on the News page. The colour token is a Tailwind text-colour class pair.</p>
      </div>
      <ErrorBox error={error} />
      <div className="overflow-hidden rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card text-left">
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Name</th>
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Slug</th>
              <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Colour token</th>
              <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.id} className="border-t border-border bg-background hover:bg-secondary/40">
                <td className="px-4 py-3 font-medium">
                  <span className={cat.colorToken ?? undefined}>{cat.name}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{cat.slug}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cat.colorToken ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
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
      <form onSubmit={create} className="grid items-end gap-3 rounded-sm border border-border p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
          />
        </Field>
        <Field label="Slug">
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
        <Field label="Colour token">
          <input className={inputCls} value={colorToken} onChange={(e) => setColorToken(e.target.value)} placeholder="text-amber-700 dark:text-amber-400" />
        </Field>
        <Btn type="submit" variant="accent" disabled={busy}>
          <Plus size={14} /> {busy ? "Adding…" : "Add category"}
        </Btn>
      </form>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete category"
        danger
        busy={deleteBusy}
        confirmLabel="Delete category"
        body={
          <div className="space-y-3">
            <p>
              Delete the <strong>{deleting?.name}</strong> category? Categories still used by articles cannot be deleted — the server will refuse.
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
