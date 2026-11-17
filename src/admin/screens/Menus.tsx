/**
 * Menus — header/footer navigation management. One tab per menu code;
 * items are edited as a list (label, link type, target, visibility,
 * order) and saved wholesale with PUT /api/admin/menus/:code.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { menusApi, pagesApi } from "../api";
import { moveIndex, removeIndex } from "../fields";
import type { Menu, PageAdmin } from "../types";
import { Btn, ErrorBox, Notice, Spinner, Switch, cx, inputCls } from "../ui";

const KNOWN_CODES = ["primary", "footer_visit", "footer_engage", "footer_connect", "mobile"];

interface ItemDraft {
  label: string;
  linkType: "PAGE" | "EXTERNAL" | "ANCHOR";
  pageId: number | null;
  url: string;
  isVisible: boolean;
}

function toDraft(menu: Menu): ItemDraft[] {
  return menu.items.map((item) => ({
    label: item.label,
    linkType: item.linkType,
    pageId: item.pageId,
    url: item.url ?? "",
    isVisible: item.isVisible,
  }));
}

export default function MenusScreen() {
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [pages, setPages] = useState<PageAdmin[]>([]);
  const [activeCode, setActiveCode] = useState<string>("primary");
  const [drafts, setDrafts] = useState<Record<string, ItemDraft[]>>({});
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [menuData, pageData] = await Promise.all([menusApi.list(), pagesApi.list()]);
      setMenus(menuData.items);
      setPages(pageData.items);
      const next: Record<string, ItemDraft[]> = {};
      for (const menu of menuData.items) next[menu.code] = toDraft(menu);
      setDrafts(next);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const codes = useMemo(() => {
    const present = (menus ?? []).map((m) => m.code);
    const ordered = KNOWN_CODES.filter((code) => present.includes(code));
    return [...ordered, ...present.filter((code) => !KNOWN_CODES.includes(code))];
  }, [menus]);

  const items = drafts[activeCode] ?? [];
  const setItems = (next: ItemDraft[]) => setDrafts((prev) => ({ ...prev, [activeCode]: next }));
  const patchItem = (index: number, patch: Partial<ItemDraft>) => {
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    setItems(next);
  };

  const dirty = useMemo(() => {
    const menu = (menus ?? []).find((m) => m.code === activeCode);
    if (!menu) return false;
    return JSON.stringify(toDraft(menu)) !== JSON.stringify(items);
  }, [menus, activeCode, items]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await menusApi.replace(
        activeCode,
        items.map((item, index) => ({
          label: item.label,
          linkType: item.linkType,
          pageId: item.linkType === "PAGE" ? item.pageId : null,
          url: item.linkType === "PAGE" ? null : item.url || null,
          sortOrder: index,
          isVisible: item.isVisible,
        })),
      );
      setMenus((prev) => (prev ?? []).map((m) => (m.code === activeCode ? updated : m)));
      setDrafts((prev) => ({ ...prev, [activeCode]: toDraft(updated) }));
      setNotice(`Menu “${updated.name}” saved.`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  if (menus === null) {
    return (
      <div className="space-y-4">
        <ErrorBox error={error} />
        {!error && <Spinner label="Loading menus…" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Menus</h1>
        <p className="text-sm text-muted-foreground">Navigation shown in the header and footer of the public site.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Menus">
        {codes.map((code) => (
          <button
            key={code}
            role="tab"
            aria-selected={activeCode === code}
            className={cx(
              "rounded-t-sm px-3 py-2 text-sm",
              activeCode === code ? "bg-card font-medium" : "text-muted-foreground hover:bg-secondary/60",
            )}
            onClick={() => {
              setActiveCode(code);
              setNotice(null);
              setError(null);
            }}
          >
            {(menus.find((m) => m.code === code)?.name ?? code)} <span className="font-mono text-xs text-muted-foreground">({code})</span>
          </button>
        ))}
      </div>

      <ErrorBox error={error} />
      {notice && <Notice>{notice}</Notice>}

      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card px-3 py-2.5">
            <div className="flex flex-col">
              <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:bg-secondary disabled:opacity-30" disabled={index === 0} onClick={() => setItems(moveIndex(items, index, -1))} aria-label={`Move ${item.label || "item"} up`}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className="rounded-sm p-0.5 text-muted-foreground hover:bg-secondary disabled:opacity-30" disabled={index === items.length - 1} onClick={() => setItems(moveIndex(items, index, 1))} aria-label={`Move ${item.label || "item"} down`}>
                <ArrowDown size={13} />
              </button>
            </div>
            <input
              className={cx(inputCls, "w-44")}
              value={item.label}
              onChange={(e) => patchItem(index, { label: e.target.value })}
              placeholder="Label"
              aria-label={`Item ${index + 1} label`}
            />
            <select
              className={cx(inputCls, "w-32")}
              value={item.linkType}
              onChange={(e) => patchItem(index, { linkType: e.target.value as ItemDraft["linkType"] })}
              aria-label={`Item ${index + 1} link type`}
            >
              <option value="PAGE">Page</option>
              <option value="EXTERNAL">External URL</option>
              <option value="ANCHOR">Anchor</option>
            </select>
            {item.linkType === "PAGE" ? (
              <select
                className={cx(inputCls, "w-56")}
                value={item.pageId != null ? String(item.pageId) : ""}
                onChange={(e) => patchItem(index, { pageId: e.target.value === "" ? null : Number(e.target.value) })}
                aria-label={`Item ${index + 1} target page`}
              >
                <option value="">— Choose a page —</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title} (/{page.slug === "home" ? "" : page.slug})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={cx(inputCls, "w-56")}
                value={item.url}
                onChange={(e) => patchItem(index, { url: e.target.value })}
                placeholder={item.linkType === "ANCHOR" ? "#section-id" : "https://…"}
                aria-label={`Item ${index + 1} URL`}
              />
            )}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={item.isVisible} onChange={(next) => patchItem(index, { isVisible: next })} label={`Item ${index + 1} visible`} />
              Visible
            </label>
            <button
              type="button"
              className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
              onClick={() => setItems(removeIndex(items, index))}
              aria-label={`Remove item ${index + 1}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">This menu has no items.</p>}
      </div>

      <div className="flex items-center gap-3">
        <Btn
          onClick={() => setItems([...items, { label: "", linkType: "PAGE", pageId: null, url: "", isVisible: true }])}
        >
          <Plus size={15} /> Add item
        </Btn>
        <Btn variant="accent" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save menu"}
        </Btn>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}
