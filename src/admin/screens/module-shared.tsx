/**
 * Shared building blocks for the Phase 5 museum-module screens
 * (Collections, Exhibitions, News, Foundation): slug helper, the
 * cover-image field group (media-library asset + legacy remote URL),
 * and the list order buttons used with the modules' reorder endpoints.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, Crop, ImagePlus, X } from "lucide-react";
import { isDefaultPlacement, type ImagePlacement } from "../../app/lib/image-placement";
import ImagePlacementEditor from "../ImagePlacementEditor";
import type { FrameSpec } from "../image-frames";
import MediaPicker from "../MediaPicker";
import type { MediaAsset } from "../types";
import { Btn, Field, inputCls } from "../ui";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Empty form strings become null for nullable API fields. */
export function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Store money helpers (Phase 6): the admin API speaks DECIMAL strings
 * in rupees ("4500.00"); forms edit rupees, displays use the shop's
 * "Rs. X,XXX" format.
 */
export function formatRsDecimal(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const [whole, frac] = Math.abs(num).toFixed(2).split(".");
  const grouped = Number(whole).toLocaleString("en-IN");
  const sign = num < 0 ? "−" : "";
  return frac === "00" ? `${sign}Rs. ${grouped}` : `${sign}Rs. ${grouped}.${frac}`;
}

/** Format an integer-paisa amount (orders/invoices API) as "Rs. X,XXX". */
export function formatRsPaisa(paisa: number | null | undefined): string {
  if (paisa == null || !Number.isFinite(paisa)) return "—";
  return formatRsDecimal((paisa / 100).toFixed(2));
}

/** Validate a rupee form value; returns the canonical DECIMAL string or null. */
export function rupeeInputToDecimal(value: string, allowNegative = false): string | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  if (!allowNegative && num < 0) return null;
  return num.toFixed(2);
}

/** Public URL for a record's resolved image (media asset wins, as in the API). */
export function recordThumb(record: { coverMediaId?: number | null; avatarMediaId?: number | null; imageUrl?: string | null }): string | null {
  const mediaId = record.coverMediaId ?? record.avatarMediaId ?? null;
  if (mediaId != null) return `/api/media/${mediaId}/file/thumb`;
  return record.imageUrl ?? null;
}

export function OrderButtons({
  index,
  total,
  onMove,
  disabled = false,
}: {
  index: number;
  total: number;
  onMove: (index: number, dir: -1 | 1) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        aria-label="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, -1)}
        className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ArrowUp size={13} />
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={disabled || index >= total - 1}
        onClick={() => onMove(index, 1)}
        className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ArrowDown size={13} />
      </button>
    </span>
  );
}

/**
 * Cover/avatar image fields: a media-library asset (wins over the
 * legacy URL in the public payload) plus the legacy remote image URL +
 * alt text kept for records whose imagery has not been migrated into
 * the media library yet.
 *
 * Cover placement (migration 0024): screens that pass BOTH `placement`
 * and `frame` additionally offer the Page Editor's "Edit position"
 * control (the ImagePlacementEditor modal, reused unchanged). Screens
 * that pass neither (Foundation, News) render exactly as before.
 * Changing the image source — picking or clearing the media asset, or
 * editing the legacy URL — clears the placement in the same patch,
 * mirroring the server-side invariant; alt-text edits keep it.
 */
export function ImageFields({
  mediaId,
  mediaLabel = "Cover image (media library)",
  imageUrl,
  imageAlt,
  onPatch,
  placement,
  frame,
}: {
  mediaId: number | null;
  mediaLabel?: string;
  imageUrl: string;
  imageAlt: string;
  onPatch: (patch: { mediaId?: number | null; imageUrl?: string; imageAlt?: string; placement?: ImagePlacement | null }) => void;
  placement?: ImagePlacement | null;
  frame?: FrameSpec;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<MediaAsset | null>(null);
  const [placementOpen, setPlacementOpen] = useState(false);

  const thumb = picked && picked.id === mediaId ? (picked.urls.thumb ?? picked.urls.master) : mediaId != null ? `/api/media/${mediaId}/file/thumb` : null;

  const placementEnabled = placement !== undefined && frame !== undefined;
  // The image the editor positions: the media asset wins, exactly as
  // the public payload resolves it; the legacy URL is the fallback.
  const editorUrl =
    mediaId != null
      ? picked && picked.id === mediaId
        ? picked.urls.master
        : `/api/media/${mediaId}/file/master`
      : imageUrl.trim() !== ""
        ? imageUrl
        : null;

  return (
    <div className="space-y-3 rounded-sm border border-border p-3">
      <Field label={mediaLabel} hint="A media-library image takes precedence over the legacy URL below.">
        <div className="flex items-center gap-3">
          {thumb ? (
            <img src={thumb} alt="" className="h-12 w-12 rounded-sm border border-border object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground">
              <ImagePlus size={16} />
            </span>
          )}
          <span className="text-sm text-muted-foreground">{mediaId != null ? `Media #${mediaId}` : "No media image"}</span>
          <Btn type="button" size="sm" onClick={() => setPickerOpen(true)}>
            {mediaId != null ? "Change…" : "Choose…"}
          </Btn>
          {mediaId != null && (
            <Btn
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicked(null);
                onPatch(placementEnabled ? { mediaId: null, placement: null } : { mediaId: null });
              }}
            >
              <X size={13} /> Clear
            </Btn>
          )}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legacy image URL">
          <input
            className={inputCls}
            value={imageUrl}
            onChange={(e) => onPatch(placementEnabled ? { imageUrl: e.target.value, placement: null } : { imageUrl: e.target.value })}
            placeholder="https://…"
          />
        </Field>
        <Field label="Image alt text">
          <input className={inputCls} value={imageAlt} onChange={(e) => onPatch({ imageAlt: e.target.value })} />
        </Field>
      </div>
      {placementEnabled && editorUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn type="button" size="sm" onClick={() => setPlacementOpen(true)}>
            <Crop size={14} /> Edit position
          </Btn>
          {placement && !isDefaultPlacement(placement) && (
            <span className="text-xs text-muted-foreground">Custom position set for this cover — the original image is unchanged.</span>
          )}
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(asset) => {
          setPicked(asset);
          onPatch(placementEnabled ? { mediaId: asset.id, placement: null } : { mediaId: asset.id });
          setPickerOpen(false);
        }}
      />
      {placementEnabled && frame && (
        <ImagePlacementEditor
          open={placementOpen}
          image={{ url: editorUrl ?? "", alt: imageAlt, placement: placement ?? undefined }}
          frame={frame}
          onClose={() => setPlacementOpen(false)}
          onSave={(next) => {
            onPatch({ placement: next ?? null });
            setPlacementOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Move one item in a list and persist the new order via the reorder endpoint. */
export async function moveAndReorder<T extends { id: number }>(
  items: T[],
  index: number,
  dir: -1 | 1,
  reorder: (ids: number[]) => Promise<unknown>,
  apply: (next: T[]) => void,
  onError: (err: unknown) => void,
  reload: () => Promise<void>,
): Promise<void> {
  const target = index + dir;
  if (target < 0 || target >= items.length) return;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  apply(next);
  try {
    await reorder(next.map((i) => i.id));
  } catch (err) {
    onError(err);
    await reload();
  }
}
