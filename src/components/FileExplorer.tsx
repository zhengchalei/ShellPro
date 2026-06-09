import { Button } from "@heroui/react";
import {
  ChevronDown,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  RefreshCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { type DragEvent, type MouseEvent } from "react";
import type { FileContextMenuState } from "../appTypes";
import { parentForFileAction } from "../fileUtils";
import type {
  WorkspaceFileEntry,
  WorkspaceFileKind,
} from "../types";

export function FileExplorer({
  entries,
  workspaceRoot,
  scopeLabel,
  selectedPath,
  expandedDirPaths,
  dropTargetPath,
  isBusy,
  onSelect,
  onToggleDirectory,
  onContextMenu,
  onCreate,
  onUpload,
  onRefresh,
  onDragOver,
  onDragLeave,
  onDrop,
  t,
}: {
  entries: WorkspaceFileEntry[];
  workspaceRoot: string;
  scopeLabel: string;
  selectedPath: string | null;
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
  onRefresh: () => void;
  onDragOver: (event: DragEvent, parentPath: string | null) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent, parentPath: string | null) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
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
          <Button
            aria-label={t("files.refresh")}
            isDisabled={isBusy}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => {
              onRefresh();
            }}
          >
            <RefreshCcw size={13} />
          </Button>
          <Button
            aria-label={t("files.newFile")}
            isDisabled={isBusy}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => {
              void onCreate(null, "file");
            }}
          >
            <FilePlus2 size={13} />
          </Button>
          <Button
            aria-label={t("files.newFolder")}
            isDisabled={isBusy}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => {
              void onCreate(null, "directory");
            }}
          >
            <FolderPlus size={13} />
          </Button>
          <Button
            aria-label={t("files.upload")}
            isDisabled={isBusy}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => {
              onUpload(workspaceRoot || null);
            }}
          >
            <UploadCloud size={13} />
          </Button>
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
          <strong>{scopeLabel}</strong>
          <span>{workspaceRoot || t("files.workspaceRoot")}</span>
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
    <div
      className="file-node-wrap"
      onDragOver={(event) => {
        onDragOver(event, targetDropPath);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        onDrop(event, targetDropPath);
      }}
    >
      <Button
        className={[
          "file-node",
          selectedPath === entry.path ? "selected" : "",
          isDropTarget ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        fullWidth
        size="sm"
        style={{ paddingLeft: 8 + level * 14 }}
        variant="ghost"
        onPress={() => {
          onSelect(entry);
        }}
        onContextMenu={(event) =>
          onContextMenu(event, entry, entry.parentPath ?? null)
        }
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
      </Button>
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
      <Button
        fullWidth
        size="sm"
        variant="ghost"
        onPress={() => {
          onClose();
          void onCreate(state.entry, "file");
        }}
      >
        <FilePlus2 size={14} />
        {t("files.newFile")}
      </Button>
      <Button
        fullWidth
        size="sm"
        variant="ghost"
        onPress={() => {
          onClose();
          void onCreate(state.entry, "directory");
        }}
      >
        <FolderPlus size={14} />
        {t("files.newFolder")}
      </Button>
      <Button
        fullWidth
        size="sm"
        variant="ghost"
        onPress={() => {
          onClose();
          onUpload(uploadParent);
        }}
      >
        <UploadCloud size={14} />
        {t("files.upload")}
      </Button>
      {entry && (
        <>
          <div className="context-menu-divider" />
          <Button
            fullWidth
            size="sm"
            variant="ghost"
            onPress={() => {
              onClose();
              void onRename(entry);
            }}
          >
            <Pencil size={14} />
            {t("files.rename")}
          </Button>
          <Button
            fullWidth
            size="sm"
            variant="danger-soft"
            onPress={() => {
              onClose();
              void onDelete(entry);
            }}
          >
            <Trash2 size={14} />
            {t("files.delete")}
          </Button>
        </>
      )}
    </div>
  );
}
