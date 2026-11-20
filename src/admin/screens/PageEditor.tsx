/**
 * PageEditor — the three-panel visual builder (Roadmap Phase 4).
 *
 * Left: section navigator (dnd-kit drag reorder, visibility, duplicate,
 * delete, add from the 22-type library). Centre: live canvas rendering
 * the REAL PageRenderer components at desktop/tablet/mobile widths —
 * never a mock. Right: property inspector driven by field-specs.ts.
 *
 * Editing model: local draft state over the server's draft revision.
 * Saves PUT the whole section list with the loaded revision id AND
 * version (optimistic concurrency + revision binding): a 409 surfaces a
 * conflict banner with a reload action — the server copy is never
 * silently overwritten. Autosave runs 2s after changes settle; the
 * status indicator always reflects the true state (unsaved / saving /
 * saved / conflict), and a save that returns after further edits never
 * marks the newer state saved or overwrites it with its own snapshot.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  History,
  Monitor,
  Plus,
  Redo2,
  Send,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
} from "lucide-react";
import PageRenderer from "../../app/components/PageRenderer";
import {
  getCollections,
  getExhibitions,
  getFeaturedProducts,
  getFoundation,
  getNewsPayload,
  type CmsPage,
  type ModuleData,
} from "../../app/lib/api";
import { ApiError, pagePath, pagesApi } from "../api";
import { DESIGN_FIELDS, SECTION_SPECS, SECTION_TYPES, sectionSummary } from "../field-specs";
import { FieldRenderer, moveIndex, removeIndex } from "../fields";
import { setNavigationGuard } from "../guard";
import type { Draft, PageAdmin, PublicPage, Revision } from "../types";
import {
  Badge,
  Btn,
  ConfirmDialog,
  ErrorBox,
  Field,
  Modal,
  Notice,
  Spinner,
  Switch,
  cx,
  formatDateTime,
  inputCls,
} from "../ui";

// ---------------------------------------------------------------------------
// Local draft model
// ---------------------------------------------------------------------------

interface LocalSection {
  uid: string;
  id: number | null;
  type: string;
  isVisible: boolean;
  config: Record<string, any>;
  design: Record<string, any> | null;
}

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `s${uidCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function toLocal(draft: Draft): LocalSection[] {
  return draft.sections.map((section) => ({
    uid: nextUid(),
    id: section.id,
    type: section.type,
    isVisible: section.isVisible,
    config: section.config ?? {},
    design: section.design ?? null,
  }));
}

function toPayload(sections: LocalSection[]) {
  return sections.map((section) => ({
    type: section.type,
    isVisible: section.isVisible,
    config: section.config,
    design: section.design,
  }));
}

type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";
type Device = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "390px",
};

export default function PageEditor() {
  const params = useParams();
  const pageId = Number(params.id);

  const [page, setPage] = useState<PageAdmin | null>(null);
  const [allPages, setAllPages] = useState<PageAdmin[]>([]);
  const [sections, setSections] = useState<LocalSection[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const [savedVersion, setSavedVersion] = useState(0);
  const [baselineJson, setBaselineJson] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);

  const [device, setDevice] = useState<Device>("desktop");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublicPage | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastHistoryPush = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);
  const savingRef = useRef(false);
  const sectionsRef = useRef<LocalSection[]>([]);
  sectionsRef.current = sections;
  const versionRef = useRef(0);
  versionRef.current = savedVersion;
  // The draft revision this editor loaded; saves are bound to it
  // server-side, and it does not change when a save bumps the version.
  const revisionRef = useRef(0);

  const payloadJson = useMemo(() => JSON.stringify(toPayload(sections)), [sections]);
  const dirty = baselineJson !== "" && payloadJson !== baselineJson;

  // -------------------------------------------------------------- load ---
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pageData, draftData, pagesData] = await Promise.all([
        pagesApi.get(pageId),
        pagesApi.getDraft(pageId),
        pagesApi.list(),
      ]);
      const local = toLocal(draftData);
      setPage(pageData);
      setAllPages(pagesData.items);
      setSections(local);
      revisionRef.current = draftData.revisionId;
      setSavedVersion(draftData.version);
      setBaselineJson(JSON.stringify(toPayload(local)));
      setSelectedUid(local[0]?.uid ?? null);
      setSaveState("saved");
      setSaveError(null);
      undoStack.current = [];
      redoStack.current = [];
      setHistoryTick((t) => t + 1);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Phase 5: the canvas renders module sections (collections,
  // exhibitions, news, foundation) from the real public module
  // endpoints, fetched once per editor session (the getters are
  // promise-cached in lib/api). Phase 6 adds the store's featured
  // products to the same set. Failure leaves moduleData undefined —
  // sections then render chrome only, exactly as the public renderer
  // degrades.
  const [moduleData, setModuleData] = useState<ModuleData | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    Promise.all([getCollections(), getExhibitions(), getNewsPayload(), getFoundation(), getFeaturedProducts()]).then(
      ([collections, exhibitions, news, foundation, products]) => {
        if (alive) setModuleData({ collections, exhibitions, news, foundation, products });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  // ----------------------------------------------------------- editing ---
  const commit = useCallback((next: LocalSection[], structural = false) => {
    const now = Date.now();
    // Coalesce rapid-fire edits (typing) into one undo step; structural
    // actions always record their own step.
    if (structural || now - lastHistoryPush.current > 600) {
      undoStack.current = [...undoStack.current.slice(-99), JSON.stringify(toPayload(sectionsRef.current))];
      lastHistoryPush.current = now;
    }
    redoStack.current = [];
    setSections(next);
    setHistoryTick((t) => t + 1);
  }, []);

  const restoreFromJson = useCallback((json: string) => {
    const payload = JSON.parse(json) as ReturnType<typeof toPayload>;
    setSections((current) =>
      payload.map((item, index) => ({
        uid: current[index]?.uid ?? nextUid(),
        id: current[index]?.id ?? null,
        type: item.type,
        isVisible: item.isVisible,
        config: item.config,
        design: item.design,
      })),
    );
  }, []);

  const undo = useCallback(() => {
    const previous = undoStack.current[undoStack.current.length - 1];
    if (previous === undefined) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, JSON.stringify(toPayload(sectionsRef.current))];
    restoreFromJson(previous);
    setHistoryTick((t) => t + 1);
  }, [restoreFromJson]);

  const redo = useCallback(() => {
    const next = redoStack.current[redoStack.current.length - 1];
    if (next === undefined) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, JSON.stringify(toPayload(sectionsRef.current))];
    restoreFromJson(next);
    setHistoryTick((t) => t + 1);
  }, [restoreFromJson]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      // Let text fields keep their native undo.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const updateSection = useCallback(
    (uid: string, patch: Partial<LocalSection>, structural = false) => {
      commit(
        sectionsRef.current.map((section) => (section.uid === uid ? { ...section, ...patch } : section)),
        structural,
      );
    },
    [commit],
  );

  // -------------------------------------------------------------- save ---
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    try {
      const payload = toPayload(sectionsRef.current);
      const sentJson = JSON.stringify(payload);
      const result = await pagesApi.saveDraft(
        pageId,
        revisionRef.current,
        versionRef.current,
        payload,
      );
      // The version always advances to what the server acknowledged…
      setSavedVersion(result.version);
      revisionRef.current = result.revisionId;
      if (JSON.stringify(toPayload(sectionsRef.current)) === sentJson) {
        // …and when nothing newer was typed during the flight, adopt the
        // server's returned sections (picks up server-side sanitisation).
        // Preserve uids by position so selection/history stay meaningful.
        const local = toLocal(result);
        setSections((current) =>
          local.map((section, index) => ({ ...section, uid: current[index]?.uid ?? section.uid })),
        );
        setBaselineJson(JSON.stringify(toPayload(local)));
        setSaveState("saved");
        setSavedAt(new Date().toLocaleTimeString());
      } else {
        // The admin kept editing while this save was in flight: never
        // clobber the newer local state with the older snapshot. The
        // server truth is now the payload we sent — record it as the
        // baseline and stay "unsaved"; the autosave cycle persists the
        // newer state next.
        setBaselineJson(sentJson);
        setSaveState("unsaved");
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSaveState("conflict");
      } else {
        setSaveState("error");
        setSaveError(err);
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [pageId]);

  // Autosave: 2s after changes settle.
  useEffect(() => {
    if (!dirty || saveState === "conflict") return;
    setSaveState((state) => (state === "saving" ? state : "unsaved"));
    const timer = setTimeout(() => {
      void save();
    }, 2000);
    return () => clearTimeout(timer);
  }, [dirty, payloadJson, save, saveState === "conflict"]);

  // Unsaved-changes guards: tab close + in-app navigation.
  useEffect(() => {
    if (!dirty) {
      setNavigationGuard(null);
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    setNavigationGuard(() => window.confirm("You have unsaved changes in the page editor. Leave without saving?"));
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setNavigationGuard(null);
    };
  }, [dirty]);

  // ----------------------------------------------------------- actions ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.uid === active.id);
    const to = sections.findIndex((s) => s.uid === over.id);
    if (from < 0 || to < 0) return;
    commit(moveIndex(sections, from, to - from), true);
  };

  const addSection = (type: string) => {
    const spec = SECTION_SPECS[type];
    const fresh: LocalSection = {
      uid: nextUid(),
      id: null,
      type,
      isVisible: true,
      config: spec ? spec.defaultConfig() : {},
      design: null,
    };
    const index = selectedUid ? sections.findIndex((s) => s.uid === selectedUid) : -1;
    const next = [...sections];
    next.splice(index >= 0 ? index + 1 : next.length, 0, fresh);
    commit(next, true);
    setSelectedUid(fresh.uid);
    setLibraryOpen(false);
  };

  const duplicateSection = (uid: string) => {
    const index = sections.findIndex((s) => s.uid === uid);
    if (index < 0) return;
    const source = sections[index];
    const copy: LocalSection = {
      ...source,
      uid: nextUid(),
      id: null,
      config: structuredClone(source.config),
      design: source.design ? structuredClone(source.design) : null,
    };
    const next = [...sections];
    next.splice(index + 1, 0, copy);
    commit(next, true);
    setSelectedUid(copy.uid);
  };

  const openPreview = async () => {
    setPreviewBusy(true);
    setSaveError(null);
    try {
      if (dirty) {
        const ok = await save();
        if (!ok) return;
      }
      const { token } = await pagesApi.createPreviewToken(pageId);
      const data = await pagesApi.fetchPreview(page?.slug ?? "", token);
      setPreview(data);
    } catch (err) {
      setSaveError(err);
      setSaveState("error");
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmPublish = async () => {
    setPublishBusy(true);
    try {
      if (dirty) {
        const ok = await save();
        if (!ok) {
          setPublishOpen(false);
          return;
        }
      }
      const updated = await pagesApi.publish(pageId);
      setPage(updated);
      setPublishNotice(`Published at ${new Date().toLocaleTimeString()}.`);
      setPublishOpen(false);
    } catch (err) {
      setSaveError(err);
      setSaveState("error");
      setPublishOpen(false);
    } finally {
      setPublishBusy(false);
    }
  };

  // ------------------------------------------------------------- render --
  if (loading) return <Spinner label="Loading the editor…" />;
  if (loadError || !page) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <ErrorBox error={loadError ?? new Error("Page not found.")} />
        <Btn onClick={() => void loadAll()}>Retry</Btn>
      </div>
    );
  }

  const selected = sections.find((s) => s.uid === selectedUid) ?? null;
  const selectedSpec = selected ? SECTION_SPECS[selected.type] : null;
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  void historyTick;

  const saveStatusText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "conflict"
        ? "Conflict — this page changed elsewhere"
        : saveState === "error"
          ? "Save failed"
          : dirty
            ? "Unsaved changes"
            : savedAt
              ? `Saved ${savedAt}`
              : "Saved";

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/admin/pages"
          className="inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={(e) => {
            if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
          }}
        >
          <ArrowLeft size={15} /> Pages
        </Link>
        <h1 className="font-display text-2xl tracking-wide">{page.title}</h1>
        <Badge tone="dark">{page.status}</Badge>
        {page.hasUnpublishedChanges && <Badge tone="accent">Unpublished changes</Badge>}
        <span className="font-mono text-xs text-muted-foreground">{pagePath(page.slug)}</span>

        <div className="flex-1" />

        <span role="status" className={cx("text-xs", saveState === "conflict" || saveState === "error" ? "font-medium text-destructive" : "text-muted-foreground")}>
          {saveStatusText}
        </span>
        <Btn size="sm" onClick={() => void save()} disabled={!dirty || saveState === "saving" || saveState === "conflict"}>
          Save draft
        </Btn>
        <div className="flex rounded-sm border border-border">
          <button type="button" className="p-1.5 hover:bg-secondary disabled:opacity-30" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Undo2 size={15} />
          </button>
          <button type="button" className="p-1.5 hover:bg-secondary disabled:opacity-30" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <Redo2 size={15} />
          </button>
        </div>
        <div className="flex rounded-sm border border-border" role="group" aria-label="Preview width">
          {(
            [
              ["desktop", Monitor, "Desktop width"],
              ["tablet", Tablet, "Tablet width (768px)"],
              ["mobile", Smartphone, "Mobile width (390px)"],
            ] as Array<[Device, typeof Monitor, string]>
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={device === value}
              className={cx("p-1.5", device === value ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
              onClick={() => setDevice(value)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <Btn size="sm" onClick={() => setMetaOpen((v) => !v)} aria-expanded={metaOpen}>
          Page settings
        </Btn>
        <Btn size="sm" onClick={() => void openPreview()} disabled={previewBusy}>
          {previewBusy ? "Preparing…" : "Preview draft"}
        </Btn>
        <Btn size="sm" onClick={() => setRevisionsOpen(true)}>
          <History size={14} /> Revisions
        </Btn>
        <Btn size="sm" variant="accent" onClick={() => setPublishOpen(true)}>
          <Send size={14} /> Publish
        </Btn>
      </div>

      {publishNotice && <Notice>{publishNotice}</Notice>}
      <ErrorBox error={saveState === "error" ? saveError : null} />

      {saveState === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" role="alert">
          <span>
            <strong>This page changed elsewhere.</strong> Your draft is based on an older version, so saving would
            overwrite newer work. Reload the draft to continue — your unsaved edits here will be discarded.
          </span>
          <Btn size="sm" variant="danger" onClick={() => void loadAll()}>
            Reload draft
          </Btn>
        </div>
      )}

      {metaOpen && (
        <MetadataPanel
          page={page}
          onSaved={(updated) => {
            setPage(updated);
            void pagesApi.list().then((d) => setAllPages(d.items)).catch(() => undefined);
          }}
        />
      )}

      {/* Three panels */}
      <div className="flex items-start gap-3">
        {/* Navigator */}
        <div className="sticky top-[4.25rem] w-64 shrink-0 rounded-sm border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Sections</h2>
            <Btn size="sm" variant="accent" onClick={() => setLibraryOpen(true)}>
              <Plus size={14} /> Add
            </Btn>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sections.map((s) => s.uid)} strategy={verticalListSortingStrategy}>
              <ul className="max-h-[calc(100vh-13rem)] overflow-y-auto p-1.5" aria-label="Page sections">
                {sections.map((section) => (
                  <NavigatorItem
                    key={section.uid}
                    section={section}
                    selected={section.uid === selectedUid}
                    onSelect={() => setSelectedUid(section.uid)}
                    onToggleVisible={() => updateSection(section.uid, { isVisible: !section.isVisible }, true)}
                    onDuplicate={() => duplicateSection(section.uid)}
                    onDelete={() => {
                      commit(removeIndex(sections, sections.findIndex((s) => s.uid === section.uid)), true);
                      if (selectedUid === section.uid) setSelectedUid(null);
                    }}
                  />
                ))}
                {sections.length === 0 && (
                  <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No sections yet — add one to begin.
                  </li>
                )}
              </ul>
            </SortableContext>
          </DndContext>
        </div>

        {/* Canvas */}
        <div className="min-w-0 flex-1 rounded-sm border border-border bg-secondary/30 p-3">
          <div
            className="isolate mx-auto bg-background shadow-sm transition-[max-width] duration-200"
            style={{ maxWidth: DEVICE_WIDTH[device] }}
          >
            {sections.map((section, index) => (
              <div
                key={section.uid}
                role="button"
                tabIndex={0}
                aria-label={`Select section ${index + 1}: ${SECTION_SPECS[section.type]?.name ?? section.type}`}
                className={cx(
                  "group/canvas relative cursor-pointer",
                  section.uid === selectedUid && "outline outline-2 -outline-offset-2 outline-accent",
                )}
                onClickCapture={(e) => {
                  setSelectedUid(section.uid);
                  const interactive = (e.target as HTMLElement).closest("a,button,input,textarea,select,label");
                  if (interactive) e.preventDefault();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedUid(section.uid);
                }}
                onSubmitCapture={(e) => e.preventDefault()}
              >
                {section.uid === selectedUid && (
                  <span className="absolute left-2 top-2 z-20 rounded-sm bg-accent px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-accent-foreground">
                    {SECTION_SPECS[section.type]?.name ?? section.type}
                  </span>
                )}
                {!section.isVisible && (
                  <span className="absolute right-2 top-2 z-20 rounded-sm bg-primary px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-primary-foreground">
                    Hidden
                  </span>
                )}
                <div className={cx(!section.isVisible && "pointer-events-none opacity-40")}>
                  <PageRenderer
                    moduleData={moduleData}
                    page={{
                      slug: page.slug,
                      title: page.title,
                      seoTitle: null,
                      metaDescription: null,
                      sections: [
                        {
                          type: section.type,
                          sortOrder: index,
                          config: section.config,
                          design: section.design,
                        },
                      ],
                    }}
                  />
                </div>
              </div>
            ))}
            {sections.length === 0 && (
              <div className="py-20 text-center text-sm text-muted-foreground">
                This page has no sections. Add one from the library.
              </div>
            )}
          </div>
        </div>

        {/* Inspector */}
        <div className="sticky top-[4.25rem] max-h-[calc(100vh-5.5rem)] w-80 shrink-0 overflow-y-auto rounded-sm border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">Inspector</h2>
          </div>
          {selected && selectedSpec ? (
            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="font-display text-lg tracking-wide">{selectedSpec.name}</p>
                <p className="text-xs text-muted-foreground">{selectedSpec.description}</p>
              </div>
              <div className="flex items-center justify-between rounded-sm bg-secondary/50 px-3 py-2">
                <span className="text-sm">Visible on the site</span>
                <Switch
                  checked={selected.isVisible}
                  onChange={(next) => updateSection(selected.uid, { isVisible: next }, true)}
                  label="Section visible"
                />
              </div>
              {selectedSpec.note && <Notice tone="warn">{selectedSpec.note}</Notice>}
              {selectedSpec.fields.map((field) => (
                <FieldRenderer
                  key={field.path}
                  spec={field}
                  root={selected.config}
                  ctx={{ pages: allPages, sectionType: selected.type, sectionConfig: selected.config }}
                  onChange={(nextConfig) => updateSection(selected.uid, { config: nextConfig })}
                />
              ))}
              <fieldset className="rounded-sm border border-border p-3">
                <legend className="px-1 font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted-foreground">
                  Design
                </legend>
                <div className="space-y-3">
                  {DESIGN_FIELDS.map((field) => (
                    <FieldRenderer
                      key={field.path}
                      spec={field}
                      root={selected.design ?? {}}
                      ctx={{ pages: allPages }}
                      onChange={(nextDesign) => {
                        const clean = Object.fromEntries(
                          Object.entries(nextDesign).filter(([, v]) => v !== undefined),
                        );
                        updateSection(selected.uid, {
                          design: Object.keys(clean).length > 0 ? clean : null,
                        });
                      }}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Select a section in the list or on the canvas to edit its properties.
            </p>
          )}
        </div>
      </div>

      {/* Section library */}
      <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} title="Add a section" wide>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SECTION_TYPES.map((type) => {
            const spec = SECTION_SPECS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => addSection(type)}
                className="rounded-sm border border-border bg-card p-3 text-left hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="font-medium">{spec.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{spec.description}</p>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Draft preview */}
      <Modal open={preview !== null} onClose={() => setPreview(null)} title="Draft preview" wide>
        {preview && (
          <div className="overflow-hidden rounded-sm border border-border">
            <div className="border-b border-border bg-secondary px-3 py-1.5 font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted-foreground">
              Unpublished draft — revision {preview.revisionId}
            </div>
            <PageRenderer
              moduleData={moduleData}
              page={{
                slug: preview.slug,
                title: preview.title,
                seoTitle: preview.seoTitle,
                metaDescription: preview.metaDescription,
                sections: preview.sections,
              } as CmsPage}
            />
          </div>
        )}
      </Modal>

      {/* Publish confirm */}
      <ConfirmDialog
        open={publishOpen}
        title="Publish page"
        confirmLabel="Publish"
        busy={publishBusy}
        body={
          <p>
            Publish <strong>{page.title}</strong> now? The current draft becomes the live page at{" "}
            <span className="font-mono text-xs">{pagePath(page.slug)}</span>
            {dirty ? " (your unsaved edits are saved first)" : ""}.
          </p>
        }
        onConfirm={() => void confirmPublish()}
        onCancel={() => setPublishOpen(false)}
      />

      {/* Revisions drawer */}
      {revisionsOpen && (
        <RevisionsDrawer
          pageId={pageId}
          onClose={() => setRevisionsOpen(false)}
          onRolledBack={() => {
            setRevisionsOpen(false);
            void loadAll();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigator item (sortable)
// ---------------------------------------------------------------------------

function NavigatorItem({
  section,
  selected,
  onSelect,
  onToggleVisible,
  onDuplicate,
  onDelete,
}: {
  section: LocalSection;
  selected: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.uid });
  const spec = SECTION_SPECS[section.type];
  const summary = sectionSummary(section.config);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "mb-1 flex items-center gap-1 rounded-sm border px-1.5 py-1.5",
        selected ? "border-accent bg-background" : "border-transparent hover:bg-secondary/60",
        isDragging && "z-10 opacity-70 shadow",
        !section.isVisible && "opacity-60",
      )}
    >
      <button
        type="button"
        className="cursor-grab rounded-sm p-1 text-muted-foreground hover:bg-secondary active:cursor-grabbing"
        aria-label={`Drag to reorder ${spec?.name ?? section.type}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect} aria-current={selected}>
        <span className="block truncate text-sm font-medium">{spec?.name ?? section.type}</span>
        {summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
      </button>
      <button
        type="button"
        className="rounded-sm p-1 text-muted-foreground hover:bg-secondary"
        onClick={onToggleVisible}
        aria-label={section.isVisible ? `Hide ${spec?.name ?? section.type}` : `Show ${spec?.name ?? section.type}`}
        aria-pressed={section.isVisible}
      >
        {section.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        type="button"
        className="rounded-sm p-1 text-muted-foreground hover:bg-secondary"
        onClick={onDuplicate}
        aria-label={`Duplicate ${spec?.name ?? section.type}`}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        className="rounded-sm p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
        onClick={onDelete}
        aria-label={`Delete ${spec?.name ?? section.type}`}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Metadata panel (title / slug / SEO) — saved separately via PATCH
// ---------------------------------------------------------------------------

function MetadataPanel({ page, onSaved }: { page: PageAdmin; onSaved: (page: PageAdmin) => void }) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [seoTitle, setSeoTitle] = useState(page.seoTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(page.metaDescription ?? "");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(page.title);
    setSlug(page.slug);
    setSeoTitle(page.seoTitle ?? "");
    setMetaDescription(page.metaDescription ?? "");
  }, [page]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const patch: Record<string, unknown> = {
        title: title.trim(),
        seoTitle: seoTitle.trim() === "" ? null : seoTitle.trim(),
        metaDescription: metaDescription.trim() === "" ? null : metaDescription.trim(),
      };
      if (!page.isSystem && slug.trim() !== page.slug) patch.slug = slug.trim();
      const updated = await pagesApi.update(page.id, patch);
      onSaved(updated);
      setNotice("Page settings saved.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Page settings" className="rounded-sm border border-border bg-card px-4 py-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Page title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Slug" hint={page.isSystem ? "System page slugs are locked." : undefined}>
          <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} disabled={page.isSystem} />
        </Field>
        <Field label="SEO title">
          <input className={inputCls} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        </Field>
        <Field label="Meta description">
          <input className={inputCls} value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Btn size="sm" variant="accent" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save page settings"}
        </Btn>
        {notice && <span className="text-sm text-muted-foreground">{notice}</span>}
      </div>
      <div className="mt-2">
        <ErrorBox error={error} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Revisions drawer
// ---------------------------------------------------------------------------

function RevisionsDrawer({
  pageId,
  onClose,
  onRolledBack,
}: {
  pageId: number;
  onClose: () => void;
  onRolledBack: () => void;
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rollingBack, setRollingBack] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pagesApi
      .revisions(pageId)
      .then((data) => setRevisions(data.items))
      .catch((err) => setError(err));
  }, [pageId]);

  const confirmRollback = async () => {
    if (!rollingBack) return;
    setBusy(true);
    try {
      await pagesApi.rollback(pageId, rollingBack.id);
      setRollingBack(null);
      onRolledBack();
    } catch (err) {
      setError(err);
      setRollingBack(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-96 max-w-[92vw] flex-col border-l border-border bg-background shadow-xl" role="dialog" aria-label="Revisions">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-lg tracking-wide">Revisions</h2>
        <Btn size="sm" variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <ErrorBox error={error} />
        {revisions === null ? (
          <Spinner label="Loading revisions…" />
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No revisions yet.</p>
        ) : (
          revisions.map((revision) => (
            <div key={revision.id} className="rounded-sm border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">Revision {revision.revisionNo}</span>
                {revision.isPublished && <Badge tone="dark">Published</Badge>}
                {revision.isDraft && <Badge tone="accent">Current draft</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {revision.sectionCount} section(s) · {formatDateTime(revision.createdAt)}
                {revision.label ? ` · ${revision.label}` : ""}
              </p>
              {!revision.isPublished && !revision.isDraft && (
                <Btn size="sm" className="mt-2" onClick={() => setRollingBack(revision)}>
                  Roll back to this revision
                </Btn>
              )}
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Rolling back republishes the chosen revision and starts a fresh draft from it.
        </p>
      </div>
      <ConfirmDialog
        open={rollingBack !== null}
        title="Roll back page"
        confirmLabel="Roll back"
        danger
        busy={busy}
        body={
          <p>
            Publish revision {rollingBack?.revisionNo} again and replace the current draft with a copy of it? The
            current live revision stays in the history.
          </p>
        }
        onConfirm={() => void confirmRollback()}
        onCancel={() => setRollingBack(null)}
      />
    </div>
  );
}
