import { shellProApi } from "./api";
import type { WorkspaceFileEntry } from "./types";

export function flattenFileEntries(entries: WorkspaceFileEntry[]) {
  const output: WorkspaceFileEntry[] = [];

  const visit = (entry: WorkspaceFileEntry) => {
    output.push(entry);
    entry.children?.forEach(visit);
  };

  entries.forEach(visit);
  return output;
}

export function formatFileSize(size?: number | null) {
  if (size === null || size === undefined) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatFileDate(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

export function parentForFileAction(
  entry: WorkspaceFileEntry | null,
  fallback: string | null,
) {
  if (!entry) {
    return fallback;
  }
  return entry.kind === "directory" ? entry.path : entry.parentPath ?? fallback;
}

export async function filesToUploads(
  parentPath: string | null,
  files: File[],
  onStatus: (message: string) => void,
) {
  const paths = files
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));

  if (paths.length === files.length && paths.length > 0) {
    await shellProApi.uploadWorkspaceFiles(parentPath, paths);
    return;
  }

  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await shellProApi.writeWorkspaceFile(parentPath, file.name, bytes);
    onStatus(`${file.name} uploaded`);
  }
}
