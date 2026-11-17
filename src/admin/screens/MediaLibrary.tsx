/**
 * Media Library — browse/search/filter/upload, folder management, and
 * per-asset editing (rename, alt text, caption, folder) with the
 * server's reference-blocked delete surfaced verbatim (409).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Upload } from "lucide-react";
import { ApiError, mediaApi } from "../api";
import { useAuth } from "../AdminApp";
import { AssetGrid, FolderSidebar } from "../media-shared";
import type { MediaAsset, MediaFolder } from "../types";
import { Btn, ConfirmDialog, ErrorBox, Field, Modal, Spinner, formatDateTime, inputCls } from "../ui";

export default function MediaLibrary() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("media.create");
  const canUpdate = hasPermission("media.update");
  const canDelete = hasPermission("media.delete");

  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<MediaFolder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFolders = useCallback(async () => {
    try {
      const data = await mediaApi.listFolders();
      setFolders(data.items);
    } catch (err) {
      setError(err);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mediaApi.list({
        page,
        pageSize: 48,
        search: search || undefined,
        folderId: folderId ?? undefined,
      });
      setAssets(data.items);
      setTotal(data.meta.total);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, folderId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    const timer = setTimeout(() => void loadAssets(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadAssets, search]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      for (const file of Array.from(files)) {
        await mediaApi.upload(file, folderId);
      }
      setNotice(`${files.length} file(s) uploaded.`);
      setPage(1);
      await loadAssets();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Upload failed."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const createFolder = async (name: string, parentId: number | null) => {
    try {
      await mediaApi.createFolder(name, parentId);
      await loadFolders();
    } catch (err) {
      setError(err);
    }
  };

  const renameFolder = async (id: number, name: string) => {
    try {
      await mediaApi.updateFolder(id, { name });
      await loadFolders();
    } catch (err) {
      setError(err);
    }
  };

  const confirmDeleteFolder = async () => {
    if (!deletingFolder) return;
    try {
      await mediaApi.removeFolder(deletingFolder.id);
      if (folderId === deletingFolder.id) setFolderId(null);
      setDeletingFolder(null);
      await loadFolders();
      await loadAssets();
    } catch (err) {
      setError(err);
      setDeletingFolder(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 48));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-wide">Media library</h1>
          <p className="text-sm text-muted-foreground">{total} asset(s). Uploads are sniffed, re-encoded and stored under random names.</p>
        </div>
        <div className="flex-1" />
        <input
          className={inputCls}
          style={{ maxWidth: 300 }}
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name…"
          aria-label="Search media"
        />
        {canCreate && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} aria-label="Upload images" />
            <Btn variant="accent" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload size={15} /> {uploading ? "Uploading…" : "Upload"}
            </Btn>
          </>
        )}
      </div>

      <ErrorBox error={error} />
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

      <div className="flex gap-5">
        <FolderSidebar
          folders={folders}
          selectedId={folderId}
          onSelect={(id) => {
            setFolderId(id);
            setPage(1);
          }}
          onCreate={(name, parentId) => void createFolder(name, parentId)}
          onRename={(id, name) => void renameFolder(id, name)}
          onDelete={setDeletingFolder}
          canEdit={canUpdate}
        />
        <div className="min-w-0 flex-1">
          {loading ? (
            <Spinner label="Loading media…" />
          ) : (
            <AssetGrid assets={assets} onAssetClick={setSelected} selectedId={selected?.id ?? null} />
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center gap-2">
              <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Btn>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Btn size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Btn>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <AssetDetail
          asset={selected}
          folders={folders}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
          onChanged={async (updated) => {
            setSelected(updated);
            await loadAssets();
          }}
          onDeleted={async () => {
            setSelected(null);
            await loadAssets();
          }}
        />
      )}

      <ConfirmDialog
        open={deletingFolder !== null}
        title="Delete folder"
        danger
        confirmLabel="Delete folder"
        body={
          <p>
            Delete the folder <strong>{deletingFolder?.name}</strong>? The server refuses if the folder still
            contains folders or assets.
          </p>
        }
        onConfirm={() => void confirmDeleteFolder()}
        onCancel={() => setDeletingFolder(null)}
      />
    </div>
  );
}

function AssetDetail({
  asset,
  folders,
  canUpdate,
  canDelete,
  onClose,
  onChanged,
  onDeleted,
}: {
  asset: MediaAsset;
  folders: MediaFolder[];
  canUpdate: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: (asset: MediaAsset) => void;
  onDeleted: () => void;
}) {
  const [originalName, setOriginalName] = useState(asset.originalName ?? "");
  const [altText, setAltText] = useState(asset.altText ?? "");
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [folderId, setFolderId] = useState<string>(asset.folderId != null ? String(asset.folderId) : "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await mediaApi.update(asset.id, {
        originalName: originalName.trim() || undefined,
        altText: altText.trim() === "" ? null : altText.trim(),
        caption: caption.trim() === "" ? null : caption.trim(),
        folderId: folderId === "" ? null : Number(folderId),
      });
      onChanged(updated);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await mediaApi.remove(asset.id);
      onDeleted();
    } catch (err) {
      // A 409 here means the asset is still referenced by page content —
      // the server's message says exactly that; show it verbatim.
      setError(err);
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Media asset" wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="overflow-hidden rounded-sm border border-border bg-secondary">
            <img src={asset.urls.medium ?? asset.urls.master} alt={asset.altText ?? ""} className="max-h-80 w-full object-contain" />
          </div>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Dimensions</dt>
              <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{asset.mimeType}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd>{formatDateTime(asset.createdAt)}</dd>
            </div>
          </dl>
          <div className="mt-4 space-y-2">
            <UrlRow label="Master" url={asset.urls.master} />
            {asset.urls.medium && <UrlRow label="Medium (800w)" url={asset.urls.medium} />}
            {asset.urls.thumb && <UrlRow label="Thumbnail (300w)" url={asset.urls.thumb} />}
          </div>
        </div>
        <div className="space-y-4">
          <ErrorBox error={error} />
          <Field label="File name">
            <input className={inputCls} value={originalName} onChange={(e) => setOriginalName(e.target.value)} disabled={!canUpdate} />
          </Field>
          <Field label="Alt text">
            <input className={inputCls} value={altText} onChange={(e) => setAltText(e.target.value)} disabled={!canUpdate} />
          </Field>
          <Field label="Caption">
            <input className={inputCls} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!canUpdate} />
          </Field>
          <Field label="Folder">
            <select className={inputCls} value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!canUpdate} aria-label="Asset folder">
              <option value="">— No folder —</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2 pt-1">
            {canUpdate && (
              <Btn variant="accent" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Btn>
            )}
            {canDelete &&
              (confirmingDelete ? (
                <>
                  <Btn variant="danger" onClick={() => void remove()} disabled={busy}>
                    {busy ? "Deleting…" : "Confirm delete"}
                  </Btn>
                  <Btn onClick={() => setConfirmingDelete(false)} disabled={busy}>
                    Keep asset
                  </Btn>
                </>
              ) : (
                <Btn variant="outline" onClick={() => setConfirmingDelete(true)}>
                  Delete asset
                </Btn>
              ))}
          </div>
          {confirmingDelete && (
            <p className="text-xs text-muted-foreground">
              Deletion is blocked by the server while any page section still references this asset.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the URL is visible and selectable.
    }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-sm bg-secondary px-2 py-1 text-xs">{url}</code>
      <button type="button" onClick={() => void copy()} className="rounded-sm p-1.5 text-muted-foreground hover:bg-secondary" aria-label={`Copy ${label} URL`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
