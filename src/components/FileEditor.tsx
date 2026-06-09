import { Button, TextArea } from "@heroui/react";
import { FileText, RotateCcw, Save, TerminalSquare, X } from "lucide-react";
import { formatFileDate, formatFileSize } from "../fileUtils";
import type { WorkspaceFilePreview } from "../types";

export type FileEditorStatus = "loading" | "ready" | "saving" | "error";

export type FileEditorTab = {
  id: string;
  sessionId: string;
  path: string;
  name: string;
  relativePath: string;
  content: string;
  savedContent: string;
  preview: WorkspaceFilePreview | null;
  status: FileEditorStatus;
  error?: string;
};

export function FileEditor({
  tab,
  onChange,
  onSave,
  onClose,
  onShowTerminal,
  t,
}: {
  tab: FileEditorTab;
  onChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
  onShowTerminal: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const isDirty = tab.content !== tab.savedContent;
  const isTextEditable =
    tab.status !== "loading" &&
    tab.status !== "error" &&
    Boolean(tab.preview?.content != null) &&
    !tab.preview?.truncated;
  const statusText =
    tab.status === "loading"
      ? t("files.editorLoading")
      : tab.status === "saving"
        ? t("files.editorSaving")
        : tab.status === "error"
          ? tab.error || t("files.editorError")
          : isDirty
            ? t("files.editorUnsaved")
            : t("files.editorSaved");

  return (
    <section className="file-editor">
      <header className="file-editor-head">
        <div className="file-editor-title">
          <FileText size={18} />
          <div>
            <strong>{tab.name}</strong>
            <span title={tab.path}>{tab.relativePath || tab.path}</span>
          </div>
        </div>
        <div className="file-editor-actions">
          <Button size="sm" variant="ghost" onPress={onShowTerminal}>
            <TerminalSquare size={15} />
            {t("files.showTerminal")}
          </Button>
          <Button
            isDisabled={!isTextEditable || !isDirty || tab.status === "saving"}
            size="sm"
            variant="primary"
            onPress={onSave}
          >
            <Save size={15} />
            {t("files.save")}
          </Button>
          <Button
            isDisabled={!isDirty || tab.status === "saving"}
            size="sm"
            variant="outline"
            onPress={() => onChange(tab.savedContent)}
          >
            <RotateCcw size={15} />
            {t("files.revert")}
          </Button>
          <Button
            aria-label={t("files.closeEditor")}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={onClose}
          >
            <X size={15} />
          </Button>
        </div>
      </header>

      <div className="file-editor-meta">
        <span>{statusText}</span>
        {tab.preview?.size != null && <span>{formatFileSize(tab.preview.size)}</span>}
        {formatFileDate(tab.preview?.modifiedAt) && (
          <span>{formatFileDate(tab.preview?.modifiedAt)}</span>
        )}
      </div>

      {tab.preview?.truncated && (
        <p className="file-editor-warning">{t("files.editorTruncated")}</p>
      )}
      {tab.status === "error" && (
        <p className="file-editor-warning">{tab.error || t("files.editorError")}</p>
      )}
      {tab.preview && tab.preview.content == null && tab.status !== "loading" && (
        <p className="file-editor-warning">{t("files.binaryPreview")}</p>
      )}

      <TextArea
        className="file-editor-textarea"
        value={tab.content}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={!isTextEditable || tab.status === "saving"}
        aria-label={t("files.editor")}
      />
    </section>
  );
}
