/**
 * Foundation admin (Phase 5) — foundation.manage.
 * Programs and testimonials, each with list + order buttons (reorder
 * endpoints), create/edit forms and delete with confirm. The program
 * icon select offers exactly the Lucide names PageRenderer maps.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, foundationApi } from "../api";
import type { FoundationProgramAdmin, TestimonialAdmin } from "../types";
import { Badge, Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, Switch, inputCls } from "../ui";
import { ImageFields, moveAndReorder, orNull, recordThumb, slugify, OrderButtons } from "./module-shared";

/** Exactly the keys of PageRenderer's PROGRAM_ICONS map. */
const PROGRAM_ICONS = ["BookOpen", "Award", "Users", "Leaf"];
const TESTIMONIAL_CONTEXTS = ["foundation", "curator"];

export default function FoundationScreen() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <ProgramsSection />
      <TestimonialsSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

function ProgramsSection() {
  const [items, setItems] = useState<FoundationProgramAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<FoundationProgramAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FoundationProgramAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await foundationApi.listPrograms();
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
    void moveAndReorder(items, index, dir, (ids) => foundationApi.reorderPrograms(ids), setItems, setError, load);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await foundationApi.removeProgram(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Foundation programs</h1>
          <p className="text-sm text-muted-foreground">Programs shown on the Foundation page. Order here is the public order.</p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New program
        </Btn>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading programs…" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Program</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Category</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((program, i) => (
                <tr key={program.id} className="border-t border-border bg-background hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <span className="font-medium">{program.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{program.slug}</span>
                  </td>
                  <td className="px-4 py-3">{program.category ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1.5">
                      {program.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}
                      {program.isFeatured && <Badge tone="dark">Featured</Badge>}
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
                        onClick={() => setEditing(program)}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(program);
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
        <ProgramForm
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
        title="Delete program"
        danger
        busy={deleteBusy}
        confirmLabel="Delete program"
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

function ProgramForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: FoundationProgramAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [impactLabel, setImpactLabel] = useState(initial?.impactLabel ?? "");
  const [iconName, setIconName] = useState(initial?.iconName ?? "");
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
    const body: Record<string, unknown> = {
      name: name.trim(),
      slug: slug.trim(),
      category: orNull(category),
      description: orNull(description),
      impactLabel: orNull(impactLabel),
      iconName: orNull(iconName),
      coverMediaId,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isFeatured,
      isPublished,
    };
    try {
      if (initial) await foundationApi.updateProgram(initial.id, body);
      else await foundationApi.createProgram(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the program."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit program — ${initial.name}` : "New program"} wide>
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
          <Field label="Category label" hint="e.g. Education, Artist Support, Access, Heritage.">
            <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Impact label" hint="e.g. “6,200 students per year”.">
            <input className={inputCls} value={impactLabel} onChange={(e) => setImpactLabel(e.target.value)} />
          </Field>
          <Field label="Icon" hint="The renderer maps these Lucide names; anything else falls back to BookOpen.">
            <select className={inputCls} value={iconName} onChange={(e) => setIconName(e.target.value)}>
              <option value="">BookOpen (default)</option>
              {PROGRAM_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
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
            {busy ? "Saving…" : initial ? "Save changes" : "Create program"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

function TestimonialsSection() {
  const [items, setItems] = useState<TestimonialAdmin[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<TestimonialAdmin | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TestimonialAdmin | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await foundationApi.listTestimonials();
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
    void moveAndReorder(items, index, dir, (ids) => foundationApi.reorderTestimonials(ids), setItems, setError, load);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await foundationApi.removeTestimonial(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl tracking-wide">Testimonials</h2>
          <p className="text-sm text-muted-foreground">“foundation” testimonials grid on the Foundation page; the “curator” one is the Home quote band.</p>
        </div>
        <Btn variant="accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> New testimonial
        </Btn>
      </div>

      <ErrorBox error={error} />

      {items === null ? (
        <Spinner label="Loading testimonials…" />
      ) : (
        <div className="overflow-hidden rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-left">
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Author</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Context</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Quote</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">State</th>
                <th scope="col" className="px-4 py-2.5 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Order</th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => {
                const thumb = recordThumb(t);
                return (
                  <tr key={t.id} className="border-t border-border bg-background hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-9 w-9 rounded-full border border-border object-cover" />
                        ) : (
                          <span className="h-9 w-9 rounded-full border border-dashed border-border" />
                        )}
                        <span>
                          <span className="font-medium">{t.authorName}</span>
                          <span className="block text-xs text-muted-foreground">{t.authorRole ?? ""}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{t.context}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{t.quote}</td>
                    <td className="px-4 py-3">{t.isPublished ? <Badge tone="accent">Published</Badge> : <Badge>Draft</Badge>}</td>
                    <td className="px-4 py-3">
                      <OrderButtons index={i} total={items.length} onMove={move} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium hover:bg-secondary"
                          onClick={() => setEditing(t)}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(t);
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
        <TestimonialForm
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
        title="Delete testimonial"
        danger
        busy={deleteBusy}
        confirmLabel="Delete testimonial"
        body={
          <div className="space-y-3">
            <p>
              Delete the testimonial by <strong>{deleting?.authorName}</strong>? It will disappear from the public site. This cannot be undone.
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

function TestimonialForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: TestimonialAdmin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quote, setQuote] = useState(initial?.quote ?? "");
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");
  const [authorRole, setAuthorRole] = useState(initial?.authorRole ?? "");
  const [context, setContext] = useState(initial?.context ?? "foundation");
  const [avatarMediaId, setAvatarMediaId] = useState<number | null>(initial?.avatarMediaId ?? null);
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
      quote: quote.trim(),
      authorName: authorName.trim(),
      authorRole: orNull(authorRole),
      context,
      avatarMediaId,
      imageUrl: orNull(imageUrl),
      imageAlt: orNull(imageAlt),
      isPublished,
    };
    try {
      if (initial) await foundationApi.updateTestimonial(initial.id, body);
      else await foundationApi.createTestimonial(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Could not save the testimonial."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit testimonial — ${initial.authorName}` : "New testimonial"} wide>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <Field label="Quote">
          <textarea className={inputCls} rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Author name">
            <input className={inputCls} value={authorName} onChange={(e) => setAuthorName(e.target.value)} required />
          </Field>
          <Field label="Author role">
            <input className={inputCls} value={authorRole} onChange={(e) => setAuthorRole(e.target.value)} />
          </Field>
          <Field label="Context" hint="“foundation” grids on the Foundation page; “curator” is the Home quote band.">
            <select className={inputCls} value={context} onChange={(e) => setContext(e.target.value)}>
              {TESTIMONIAL_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end gap-6 pb-1">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={isPublished} onChange={setIsPublished} label="Published" /> Published
            </span>
          </div>
        </div>
        <ImageFields
          mediaId={avatarMediaId}
          mediaLabel="Avatar (media library)"
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          onPatch={(patch) => {
            if (patch.mediaId !== undefined) setAvatarMediaId(patch.mediaId);
            if (patch.imageUrl !== undefined) setImageUrl(patch.imageUrl);
            if (patch.imageAlt !== undefined) setImageAlt(patch.imageAlt);
          }}
        />
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn type="submit" variant="accent" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create testimonial"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
