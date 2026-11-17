/**
 * Media browser building blocks shared by the Media Library screen and
 * the editor's MediaPicker modal: folder sidebar (tree from the flat
 * parentId list) and the asset grid.
 */
import { FolderOpen, ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { MediaAsset, MediaFolder } from "./types";
import { Btn, cx, formatBytes, inputCls } from "./ui";

export function FolderSidebar({
  folders,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  canEdit,
}: {
  folders: MediaFolder[];
  /** null = all media */
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (name: string, parentId: number | null) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (folder: MediaFolder) => void;
  canEdit: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const childrenOf = (parentId: number | null) =>
    folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));

  const renderFolder = (folder: MediaFolder, depth: number) => (
    <div key={folder.id}>
      <div
        className={cx(
          "group flex items-center gap-1 rounded-sm pr-1",
          selectedId === folder.id ? "bg-secondary" : "hover:bg-secondary/60",
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {renamingId === folder.id ? (
          <input
            className={cx(inputCls, "my-1 h-8 py-1")}
            value={renameValue}
            autoFocus
            aria-label={`Rename folder ${folder.name}`}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (renameValue.trim() && renameValue.trim() !== folder.name) onRename(folder.id, renameValue.trim());
              setRenamingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenamingId(null);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm text-foreground"
              onClick={() => onSelect(folder.id)}
              aria-current={selectedId === folder.id}
            >
              <FolderOpen size={15} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  className="rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-background group-hover:opacity-100"
                  aria-label={`Rename folder ${folder.name}`}
                  onClick={() => {
                    setRenamingId(folder.id);
                    setRenameValue(folder.name);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
                  aria-label={`Delete folder ${folder.name}`}
                  onClick={() => onDelete(folder)}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </>
        )}
      </div>
      {childrenOf(folder.id).map((child) => renderFolder(child, depth + 1))}
    </div>
  );

  return (
    <div className="w-52 shrink-0 space-y-1">
      <button
        type="button"
        className={cx(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
          selectedId === null ? "bg-secondary font-medium" : "hover:bg-secondary/60",
        )}
        onClick={() => onSelect(null)}
      >
        <FolderOpen size={15} className="text-muted-foreground" /> All media
      </button>
      {childrenOf(null).map((folder) => renderFolder(folder, 0))}
      {canEdit && (
        <form
          className="flex gap-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            onCreate(newName.trim(), selectedId);
            setNewName("");
          }}
        >
          <input
            className={cx(inputCls, "h-8 py-1")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New folder"
            aria-label="New folder name"
          />
          <Btn type="submit" size="icon" aria-label="Create folder">
            <Plus size={15} />
          </Btn>
        </form>
      )}
    </div>
  );
}

export function AssetGrid({
  assets,
  onAssetClick,
  selectedId,
}: {
  assets: MediaAsset[];
  onAssetClick: (asset: MediaAsset) => void;
  selectedId?: number | null;
}) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">
        <ImageOff size={28} />
        No media found.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onAssetClick(asset)}
          aria-label={`Media asset ${asset.originalName ?? asset.storageName}`}
          className={cx(
            "group overflow-hidden rounded-sm border bg-card text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selectedId === asset.id ? "border-accent ring-2 ring-ring" : "border-border hover:border-accent/60",
          )}
        >
          <div className="aspect-[4/3] w-full overflow-hidden bg-secondary">
            {asset.urls.thumb ? (
              <img src={asset.urls.thumb} alt={asset.altText ?? ""} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <ImageOff size={22} />
              </div>
            )}
          </div>
          <div className="space-y-0.5 px-2 py-1.5">
            <p className="truncate text-xs font-medium text-foreground">{asset.originalName ?? asset.storageName}</p>
            <p className="font-mono text-[0.62rem] text-muted-foreground">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
              {formatBytes(asset.fileSize)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
