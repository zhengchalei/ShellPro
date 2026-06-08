import {
  ChevronDown,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { type DragEvent, type MouseEvent, useMemo } from "react";
import type { FileContextMenuState } from "../appTypes";
import {
  flattenFileEntries,
  formatFileDate,
  formatFileSize,
  parentForFileAction,
} from "../fileUtils";
import type {
  WorkspaceFileEntry,
  WorkspaceFileKind,
  WorkspaceFilePreview,
} from "../types";

export function FileExplorer({
  entries,
  workspaceRoot,
  selectedPath,
  preview,
  expandedDirPaths,
  dropTargetPath,
  isBusy,
  onSelect,
  onToggleDirectory,
  onContextMenu,
  onCreate,
  onUpload,
  onDragOver,
  onDragLeave,
  onDrop,
  t,
}: {
  entries: WorkspaceFileEntry[];
  workspaceRoot: string;
  selectedPath: string | null;
  preview: WorkspaceFilePreview | null;
  expandedDirPaths: Record<string, boolean>;
  dropTargetPath: string | null;
  isBusy: boolean;
  onSelect: (entry: WorkspaceFileEntry) => void;
  onToggleDirectory: (path: string) => void;
  onContextMenu: (
    event: MouseEvent,
    entry: WorkspaceFileEntry | null,
    parentPath: string | null,
  ) => void;
  onCreate: (
    target: WorkspaceFileEntry | null,
    kind: WorkspaceFileKind,
  ) => Promise<void>;
  onUpload: (parentPath: string | null) => void;
  onDragOver: (event: DragEvent, parentPath: string | null) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent, parentPath: string | null) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const selectedEntry = useMemo(
    () =>
      flattenFileEntries(entries).find((entry) => entry.path === selectedPath) ??
      null,
    [entries, selectedPath],
  );
  const selectedChildCount = selectedEntry?.children?.length ?? 0;

  return (
    <section
      className="sidebar-section file-browser"
      onContextMenu={(event) => onContextMenu(event, null, workspaceRoot || null)}
      onDragOver={(event) => onDragOver(event, workspaceRoot || null)}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop(event, workspaceRoot || null)}
    >
      <div className="file-browser-head">
        <div className="section-title">
          <FolderTree size={14} />
          {t("files.title")}
        </div>
        <div className="file-actions">
          <button
            className="icon-button compact"
            title={t("files.newFile")}
            onClick={(event) => {
              event.stopPropagation();
              void onCreate(null, "file");
            }}
            disabled={isBusy}
          >
            <FilePlus2 size={13} />
          </button>
          <button
            className="icon-button compact"
            title={t("files.newFolder")}
            onClick={(event) => {
              event.stopPropagation();
              void onCreate(null, "directory");
            }}
            disabled={isBusy}
          >
            <FolderPlus size={13} />
          </button>
          <button
            className="icon-button compact"
            title={t("files.upload")}
            onClick={(event) => {
              event.stopPropagation();
              onUpload(workspaceRoot || null);
            }}
            disabled={isBusy}
          >
            <UploadCloud size={13} />
          </button>
        </div>
      </div>

      <div
        className={
          dropTargetPath === workspaceRoot
            ? "file-tree root is-drop-target"
            : "file-tree root"
        }
      >
        <div className="file-root-label" title={workspaceRoot}>
          {workspaceRoot || t("files.workspaceRoot")}
        </div>
        {entries.length === 0 ? (
          <p className="muted tight file-empty">{t("files.empty")}</p>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              level={0}
              selectedPath={selectedPath}
              expandedDirPaths={expandedDirPaths}
              dropTargetPath={dropTargetPath}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={onContextMenu}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))
        )}
      </div>

      <div className="file-preview">
        <div className="panel-title">
          <FileText size={15} />
          {t("files.preview")}
        </div>
        {!preview ? (
          <p className="muted tight">{t("files.previewEmpty")}</p>
        ) : (
          <div className="file-preview-body">
            <div className="file-preview-meta">
              <strong>{preview.name}</strong>
              <span>
                {preview.kind === "directory"
                  ? t("files.folderMeta", { count: selectedChildCount })
                  : formatFileSize(preview.size)}
              </span>
              {formatFileDate(preview.modifiedAt) && (
                <span>{formatFileDate(preview.modifiedAt)}</span>
              )}
            </div>
            {preview.kind === "directory" ? (
              <p className="muted tight">
                {t("files.folderPreview", { count: selectedChildCount })}
              </p>
            ) : preview.content ? (
              <pre>{preview.content}</pre>
            ) : (
              <p className="muted tight">{t("files.binaryPreview")}</p>
            )}
            {preview.truncated && (
              <p className="muted tight">{t("files.previewTruncated")}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FileTreeNode({
  entry,
  level,
  selectedPath,
  expandedDirPaths,
  dropTargetPath,
  onSelect,
  onToggleDirectory,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  entry: WorkspaceFileEntry;
  level: number;
  selectedPath: string | null;
  expandedDirPaths: Record<string, boolean>;
  dropTargetPath: string | null;
  onSelect: (entry: WorkspaceFileEntry) => void;
  onToggleDirectory: (path: string) => void;
  onContextMenu: (
    event: MouseEvent,
    entry: WorkspaceFileEntry | null,
    parentPath: string | null,
  ) => void;
  onDragOver: (event: DragEvent, parentPath: string | null) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent, parentPath: string | null) => void;
}) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = Boolean(expandedDirPaths[entry.path]);
  const childEntries = entry.children ?? [];
  const targetDropPath = isDirectory ? entry.path : entry.parentPath ?? null;
  const isDropTarget = Boolean(
    targetDropPath && dropTargetPath === targetDropPath,
  );

  return (
    <div className="file-node-wrap">
      <button
        className={[
          "file-node",
          selectedPath === entry.path ? "selected" : "",
          isDropTarget ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entry);
        }}
        onContextMenu={(event) =>
          onContextMenu(event, entry, entry.parentPath ?? null)
        }
        onDragOver={(event) => {
          onDragOver(event, targetDropPath);
        }}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          onDrop(event, targetDropPath);
        }}
      >
        <span
          className="file-disclosure"
          onClick={(event) => {
            if (!isDirectory) {
              return;
            }
            event.stopPropagation();
            onToggleDirectory(entry.path);
          }}
        >
          {isDirectory ? <ChevronDown size={12} /> : null}
        </span>
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen size={14} />
          ) : (
            <Folder size={14} />
          )
        ) : (
          <FileText size={14} />
        )}
        <span>{entry.name}</span>
      </button>
      {isDirectory && isExpanded && childEntries.length > 0 && (
        <div className="file-children">
          {childEntries.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedDirPaths={expandedDirPaths}
              dropTargetPath={dropTargetPath}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={onContextMenu}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileContextMenu({
  state,
  onCreate,
  onRename,
  onDelete,
  onUpload,
  onClose,
  t,
}: {
  state: NonNullable<FileContextMenuState>;
  onCreate: (
    target: WorkspaceFileEntry | null,
    kind: WorkspaceFileKind,
  ) => Promise<void>;
  onRename: (entry: WorkspaceFileEntry) => Promise<void>;
  onDelete: (entry: WorkspaceFileEntry) => Promise<void>;
  onUpload: (parentPath: string | null) => void;
  onClose: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const uploadParent = parentForFileAction(state.entry, state.parentPath);
  const entry = state.entry;

  return (
    <div
      className="context-menu file-context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          void onCreate(state.entry, "file");
        }}
      >
        <FilePlus2 size={14} />
        {t("files.newFile")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          void onCreate(state.entry, "directory");
        }}
      >
        <FolderPlus size={14} />
        {t("files.newFolder")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onUpload(uploadParent);
        }}
      >
        <UploadCloud size={14} />
        {t("files.upload")}
      </button>
      {entry && (
        <>
          <div className="context-menu-divider" />
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              void onRename(entry);
            }}
          >
            <Pencil size={14} />
            {t("files.rename")}
          </button>
          <button
            className="danger"
            role="menuitem"
            onClick={() => {
              onClose();
              void onDelete(entry);
            }}
          >
            <Trash2 size={14} />
            {t("files.delete")}
          </button>
        </>
      )}
    </div>
  );
}
