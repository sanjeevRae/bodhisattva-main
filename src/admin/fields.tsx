/**
 * Inspector field renderers — one component per FieldSpec kind, driven by
 * field-specs.ts. All edits are immutable path updates on the section
 * config object; the editor owns the state, these components only render
 * and report changes.
 */
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import type { FieldSpec } from "./field-specs";
import type { MediaAsset, PageAdmin } from "./types";
import MediaPicker from "./MediaPicker";
import { Btn, Field, cx, inputCls } from "./ui";

// ---------------------------------------------------------------------------
// Path helpers (dot paths; numeric segments index arrays)
// ---------------------------------------------------------------------------

export function getPath(root: any, path: string): any {
  if (!path) return root;
  let node = root;
  for (const segment of path.split(".")) {
    if (node == null) return undefined;
    node = node[segment];
  }
  return node;
}

export function setPath(root: any, path: string, value: any): any {
  const segments = path.split(".");
  const walk = (node: any, depth: number): any => {
    const segment = segments[depth];
    const base = Array.isArray(node) ? [...node] : { ...(node ?? {}) };
    if (depth === segments.length - 1) {
      if (value === undefined) delete base[segment];
      else base[segment] = value;
      return base;
    }
    base[segment] = walk(base[segment], depth + 1);
    return base;
  };
  return walk(root, 0);
}

export function removeIndex(list: any[], index: number): any[] {
  return list.filter((_, i) => i !== index);
}

export function moveIndex(list: any[], index: number, delta: number): any[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Shared context the inspector passes down
// ---------------------------------------------------------------------------

export interface FieldContext {
  pages: PageAdmin[];
}

interface FieldProps {
  spec: FieldSpec;
  root: Record<string, any>;
  onChange: (nextRoot: Record<string, any>) => void;
  ctx: FieldContext;
}

export function FieldRenderer({ spec, root, onChange, ctx }: FieldProps) {
  const value = getPath(root, spec.path);
  const set = (next: any) => onChange(setPath(root, spec.path, next));

  switch (spec.kind) {
    case "text":
      return (
        <Field label={spec.label}>
          <input
            className={inputCls}
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={spec.placeholder}
            onChange={(e) => set(e.target.value === "" ? undefined : e.target.value)}
            aria-label={spec.label}
          />
        </Field>
      );

    case "textarea":
    case "richtext":
      return (
        <Field label={spec.label} hint={spec.kind === "richtext" ? "Basic formatting HTML is allowed; it is sanitised on save." : undefined}>
          <textarea
            className={inputCls}
            rows={spec.rows ?? 3}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(e.target.value === "" ? undefined : e.target.value)}
            aria-label={spec.label}
          />
        </Field>
      );

    case "number":
      return (
        <Field label={spec.label}>
          <input
            className={inputCls}
            type="number"
            min={spec.min}
            max={spec.max}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return set(undefined);
              const parsed = Number(raw);
              set(Number.isNaN(parsed) ? undefined : parsed);
            }}
            aria-label={spec.label}
          />
        </Field>
      );

    case "select":
      return (
        <Field label={spec.label}>
          <select
            className={inputCls}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return set(undefined);
              const option = spec.options.find((o) => String(o.value) === raw);
              set(option ? option.value : raw);
            }}
            aria-label={spec.label}
          >
            {spec.allowUnset && <option value="">— Not set —</option>}
            {!spec.allowUnset && value === undefined && <option value="">— Choose —</option>}
            {spec.options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      );

    case "checkbox":
      return (
        <label className="flex cursor-pointer items-center gap-2.5 py-1">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#9A6F2A]"
            checked={value === true}
            onChange={(e) => set(e.target.checked ? true : undefined)}
          />
          <span className="text-sm text-foreground">{spec.label}</span>
        </label>
      );

    case "link":
      return (
        <LinkEditor
          label={spec.label}
          value={value}
          onChange={set}
          pages={ctx.pages}
          withStyle={spec.withStyle}
        />
      );

    case "image":
      return <ImageEditor label={spec.label} value={value} onChange={set} />;

    case "object":
      return (
        <fieldset className="rounded-sm border border-border p-3">
          <legend className="px-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
            {spec.label}
          </legend>
          {value == null ? (
            <Btn size="sm" onClick={() => onChange(setPath(root, spec.path, {}))}>
              <Plus size={14} /> Add {spec.label.toLowerCase()}
            </Btn>
          ) : (
            <div className="space-y-3">
              {spec.fields.map((field) => (
                <FieldRenderer
                  key={field.path}
                  spec={field}
                  root={value}
                  ctx={ctx}
                  onChange={(nextItem) => set(nextItem)}
                />
              ))}
              <Btn size="sm" variant="ghost" onClick={() => set(undefined)}>
                <Trash2 size={14} /> Remove
              </Btn>
            </div>
          )}
        </fieldset>
      );

    case "stringList":
    case "richtextList": {
      const list: string[] = Array.isArray(value) ? value : [];
      return (
        <ListShell
          label={spec.label}
          count={list.length}
          onAdd={() => set([...list, ""])}
          addLabel={`Add ${spec.itemLabel.toLowerCase()}`}
        >
          {list.map((item, index) => (
            <ListRow
              key={index}
              index={index}
              count={list.length}
              onMove={(delta) => set(moveIndex(list, index, delta))}
              onRemove={() => set(removeIndex(list, index))}
            >
              {spec.kind === "richtextList" ? (
                <textarea
                  className={inputCls}
                  rows={3}
                  value={item}
                  aria-label={`${spec.itemLabel} ${index + 1}`}
                  onChange={(e) => {
                    const next = [...list];
                    next[index] = e.target.value;
                    set(next);
                  }}
                />
              ) : (
                <input
                  className={inputCls}
                  type="text"
                  value={item}
                  aria-label={`${spec.itemLabel} ${index + 1}`}
                  onChange={(e) => {
                    const next = [...list];
                    next[index] = e.target.value;
                    set(next);
                  }}
                />
              )}
            </ListRow>
          ))}
        </ListShell>
      );
    }

    case "imageList": {
      const list: Array<{ url: string; alt: string }> = Array.isArray(value) ? value : [];
      return (
        <ListShell
          label={spec.label}
          count={list.length}
          onAdd={() => set([...list, { url: "", alt: "" }])}
          addLabel="Add image"
        >
          {list.map((item, index) => (
            <ListRow
              key={index}
              index={index}
              count={list.length}
              onMove={(delta) => set(moveIndex(list, index, delta))}
              onRemove={() => set(removeIndex(list, index))}
            >
              <ImageEditor
                label={`Image ${index + 1}`}
                value={item}
                onChange={(next) => {
                  const copy = [...list];
                  copy[index] = next ?? { url: "", alt: "" };
                  set(copy);
                }}
              />
            </ListRow>
          ))}
        </ListShell>
      );
    }

    case "objectList": {
      const list: Array<Record<string, any>> = Array.isArray(value) ? value : [];
      return (
        <ListShell
          label={spec.label}
          count={list.length}
          onAdd={() => set([...list, spec.newItem()])}
          addLabel={`Add ${spec.itemLabel.toLowerCase()}`}
        >
          {list.map((item, index) => (
            <ListRow
              key={index}
              index={index}
              count={list.length}
              onMove={(delta) => set(moveIndex(list, index, delta))}
              onRemove={() => set(removeIndex(list, index))}
            >
              <div className="w-full space-y-3">
                {spec.fields.map((field) => (
                  <FieldRenderer
                    key={field.path}
                    spec={field}
                    root={item}
                    ctx={ctx}
                    onChange={(nextItem) => {
                      const copy = [...list];
                      copy[index] = nextItem;
                      set(copy);
                    }}
                  />
                ))}
              </div>
            </ListRow>
          ))}
        </ListShell>
      );
    }

    case "groups": {
      const groups: Array<{ title: string; items: string[] }> = Array.isArray(value) ? value : [];
      return (
        <ListShell
          label={spec.label}
          count={groups.length}
          onAdd={() => set([...groups, { title: "", items: [""] }])}
          addLabel="Add group"
        >
          {groups.map((group, gi) => (
            <ListRow
              key={gi}
              index={gi}
              count={groups.length}
              onMove={(delta) => set(moveIndex(groups, gi, delta))}
              onRemove={() => set(removeIndex(groups, gi))}
            >
              <div className="w-full space-y-2">
                <input
                  className={inputCls}
                  type="text"
                  value={group.title}
                  placeholder="Group title (e.g. floor name)"
                  aria-label={`Group ${gi + 1} title`}
                  onChange={(e) => {
                    const copy = [...groups];
                    copy[gi] = { ...group, title: e.target.value };
                    set(copy);
                  }}
                />
                {(group.items ?? []).map((item, ii) => (
                  <div key={ii} className="flex items-center gap-1.5">
                    <input
                      className={inputCls}
                      type="text"
                      value={item}
                      aria-label={`Group ${gi + 1} item ${ii + 1}`}
                      onChange={(e) => {
                        const items = [...group.items];
                        items[ii] = e.target.value;
                        const copy = [...groups];
                        copy[gi] = { ...group, items };
                        set(copy);
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      aria-label={`Remove item ${ii + 1}`}
                      onClick={() => {
                        const copy = [...groups];
                        copy[gi] = { ...group, items: removeIndex(group.items, ii) };
                        set(copy);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const copy = [...groups];
                    copy[gi] = { ...group, items: [...group.items, ""] };
                    set(copy);
                  }}
                >
                  <Plus size={14} /> Add item
                </Btn>
              </div>
            </ListRow>
          ))}
        </ListShell>
      );
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// List scaffolding
// ---------------------------------------------------------------------------

function ListShell({
  label,
  count,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  count: number;
  onAdd: () => void;
  addLabel: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rounded-sm border border-border p-3">
      <legend className="px-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
        {label} {count > 0 && <span className="text-foreground">({count})</span>}
      </legend>
      <div className="space-y-3">{children}</div>
      <Btn size="sm" className="mt-3" onClick={onAdd}>
        <Plus size={14} /> {addLabel}
      </Btn>
    </fieldset>
  );
}

function ListRow({
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-1.5 rounded-sm bg-secondary/40 p-2">
      <div className="flex flex-col gap-0.5 pt-1">
        <button
          type="button"
          className="rounded-sm p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
          aria-label={`Move item ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className="rounded-sm p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
          aria-label={`Move item ${index + 1} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
          aria-label={`Remove item ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link editor — { kind: "page" | "url", label, pageId?, url?, style? }
// ---------------------------------------------------------------------------

export function LinkEditor({
  label,
  value,
  onChange,
  pages,
  withStyle = false,
}: {
  label: string;
  value: any;
  onChange: (next: any) => void;
  pages: PageAdmin[];
  withStyle?: boolean;
}) {
  const link = value && typeof value === "object" ? value : null;
  if (!link) {
    return (
      <Field label={label}>
        <Btn size="sm" onClick={() => onChange({ kind: "page", label: "" })}>
          <Plus size={14} /> Add link
        </Btn>
      </Field>
    );
  }
  const patch = (part: Record<string, any>) => onChange({ ...link, ...part });
  return (
    <fieldset className="rounded-sm border border-border p-3">
      <legend className="px-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">{label}</legend>
      <div className="space-y-3">
        <Field label="Link text">
          <input
            className={inputCls}
            type="text"
            value={link.label ?? ""}
            onChange={(e) => patch({ label: e.target.value })}
            aria-label={`${label} text`}
          />
        </Field>
        <Field label="Link type">
          <select
            className={inputCls}
            value={link.kind ?? "page"}
            onChange={(e) => patch({ kind: e.target.value })}
            aria-label={`${label} type`}
          >
            <option value="page">Page on this site</option>
            <option value="url">External URL</option>
          </select>
        </Field>
        {link.kind === "url" ? (
          <Field label="URL">
            <input
              className={inputCls}
              type="url"
              value={link.url ?? ""}
              placeholder="https://…"
              onChange={(e) => patch({ url: e.target.value })}
              aria-label={`${label} URL`}
            />
          </Field>
        ) : (
          <Field label="Target page">
            <select
              className={inputCls}
              value={link.pageId != null ? String(link.pageId) : ""}
              onChange={(e) => patch({ pageId: e.target.value === "" ? undefined : Number(e.target.value) })}
              aria-label={`${label} target page`}
            >
              <option value="">— Choose a page —</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title} (/{page.slug === "home" ? "" : page.slug})
                </option>
              ))}
            </select>
          </Field>
        )}
        {withStyle && (
          <Field label="Button style">
            <select
              className={inputCls}
              value={link.style ?? "solid"}
              onChange={(e) => patch({ style: e.target.value })}
              aria-label={`${label} style`}
            >
              <option value="solid">Solid</option>
              <option value="outline">Outline</option>
            </select>
          </Field>
        )}
        <Btn size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          <Trash2 size={14} /> Remove link
        </Btn>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Image editor — { url, alt } + media library picker
// ---------------------------------------------------------------------------

export function ImageEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: any;
  onChange: (next: { url: string; alt: string } | undefined) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const image = value && typeof value === "object" ? value : null;

  if (!image) {
    return (
      <Field label={label}>
        <Btn size="sm" onClick={() => onChange({ url: "", alt: "" })}>
          <Plus size={14} /> Add image
        </Btn>
      </Field>
    );
  }

  const pick = (asset: MediaAsset) => {
    onChange({ url: asset.urls.master, alt: asset.altText ?? image.alt ?? "" });
    setPickerOpen(false);
  };

  return (
    <fieldset className="rounded-sm border border-border p-3">
      <legend className="px-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">{label}</legend>
      <div className="space-y-3">
        {image.url && (
          <img src={image.url} alt="" className="h-28 w-full rounded-sm border border-border object-cover" />
        )}
        <Field label="Image URL">
          <input
            className={inputCls}
            type="text"
            value={image.url ?? ""}
            onChange={(e) => onChange({ ...image, url: e.target.value })}
            aria-label={`${label} URL`}
          />
        </Field>
        <Field label="Alt text">
          <input
            className={inputCls}
            type="text"
            value={image.alt ?? ""}
            onChange={(e) => onChange({ ...image, alt: e.target.value })}
            aria-label={`${label} alt text`}
          />
        </Field>
        <div className="flex gap-2">
          <Btn size="sm" onClick={() => setPickerOpen(true)}>
            <ImagePlus size={14} /> Choose from media library
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            <Trash2 size={14} /> Remove
          </Btn>
        </div>
      </div>
      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={pick} />
    </fieldset>
  );
}
