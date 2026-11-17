/**
 * MediaPicker — modal media browser used by the editor's image fields.
 * Browse/search the library, upload a new file, click an asset to use it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { ApiError, mediaApi } from "./api";
import { AssetGrid, FolderSidebar } from "./media-shared";
import type { MediaAsset, MediaFolder } from "./types";
import { Btn, ErrorBox, Modal, Spinner, inputCls } from "./ui";

export default function MediaPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (asset: MediaAsset) => void;
}) {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mediaApi.list({ page: 1, pageSize: 48, search: search || undefined, folderId: folderId ?? undefined });
      setAssets(data.items);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [search, folderId]);

  useEffect(() => {
    if (!open) return;
    mediaApi
      .listFolders()
      .then((data) => setFolders(data.items))
      .catch((err) => setError(err));
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(loadAssets, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, loadAssets, search]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      let last: MediaAsset | null = null;
      for (const file of Array.from(files)) {
        last = await mediaApi.upload(file, folderId);
      }
      setError(null);
      await loadAssets();
      if (last && files.length === 1) onPick(last);
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error("Upload failed."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Media library" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={inputCls}
            style={{ maxWidth: 320 }}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search media"
          />
          <div className="flex-1" />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files)} aria-label="Upload image" />
          <Btn variant="accent" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? "Uploading…" : "Upload image"}
          </Btn>
        </div>
        <ErrorBox error={error} />
        <div className="flex gap-4">
          <FolderSidebar
            folders={folders}
            selectedId={folderId}
            onSelect={setFolderId}
            canEdit={false}
            onCreate={() => undefined}
            onRename={() => undefined}
            onDelete={() => undefined}
          />
          <div className="min-w-0 flex-1">
            {loading ? <Spinner label="Loading media…" /> : <AssetGrid assets={assets} onAssetClick={onPick} />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Click an image to use it. Uploads are validated and re-encoded by the server.</p>
      </div>
    </Modal>
  );
}
