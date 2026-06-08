use chrono::Utc;
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
};

use crate::models::{WorkspaceFileEntry, WorkspaceFileKind, WorkspaceFileTree};

pub(crate) fn workspace_root() -> Result<PathBuf, String> {
    env::current_dir()
        .map_err(|error| format!("Could not resolve workspace root: {error}"))
        .and_then(|path| {
            path.canonicalize()
                .map_err(|error| format!("Could not canonicalize workspace root: {error}"))
        })
}

fn is_ignored_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".vite"
    )
}

pub(crate) fn modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<Utc>::from)
        .map(|time| time.to_rfc3339())
}

pub(crate) fn display_path(path: &Path) -> String {
    path.display().to_string()
}

pub(crate) fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.display().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

pub(crate) fn resolve_workspace_path(root: &Path, path: Option<String>) -> Result<PathBuf, String> {
    let candidate = match path {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => root.to_path_buf(),
    };
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let canonical = resolved
        .canonicalize()
        .map_err(|error| format!("Could not resolve path: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("Path is outside the workspace.".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_new_workspace_path(
    root: &Path,
    parent_path: Option<String>,
    name: &str,
) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Name is required.".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators.".to_string());
    }
    let parent = resolve_workspace_path(root, parent_path)?;
    if !parent.is_dir() {
        return Err("Target folder does not exist.".to_string());
    }
    let target = parent.join(name);
    if !target.starts_with(root) {
        return Err("Path is outside the workspace.".to_string());
    }
    Ok(target)
}

pub(crate) fn build_workspace_entry(
    root: &Path,
    path: &Path,
    depth: usize,
    remaining: &mut usize,
) -> Result<Option<WorkspaceFileEntry>, String> {
    if *remaining == 0 {
        return Ok(None);
    }
    *remaining -= 1;

    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Could not read metadata for {}: {error}",
            display_path(path)
        )
    })?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| relative_display(root, path));
    let is_directory = metadata.is_dir();
    let parent_path = path
        .parent()
        .filter(|parent| parent.starts_with(root))
        .map(display_path);

    let children = if is_directory && depth > 0 {
        let mut child_paths = fs::read_dir(path)
            .map_err(|error| format!("Could not read directory {}: {error}", display_path(path)))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|child| {
                child
                    .file_name()
                    .map(|name| !is_ignored_workspace_dir(&name.to_string_lossy()))
                    .unwrap_or(true)
            })
            .collect::<Vec<_>>();
        child_paths.sort_by(|left, right| {
            let left_is_dir = left.is_dir();
            let right_is_dir = right.is_dir();
            right_is_dir
                .cmp(&left_is_dir)
                .then_with(|| left.file_name().cmp(&right.file_name()))
        });

        let mut child_entries = Vec::new();
        for child in child_paths {
            if let Some(entry) = build_workspace_entry(root, &child, depth - 1, remaining)? {
                child_entries.push(entry);
            }
            if *remaining == 0 {
                break;
            }
        }
        Some(child_entries)
    } else if is_directory {
        Some(Vec::new())
    } else {
        None
    };

    Ok(Some(WorkspaceFileEntry {
        name,
        path: display_path(path),
        relative_path: relative_display(root, path),
        parent_path,
        kind: if is_directory {
            WorkspaceFileKind::Directory
        } else {
            WorkspaceFileKind::File
        },
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        modified_at: modified_at(&metadata),
        children,
    }))
}

pub(crate) fn list_workspace(root: &Path) -> Result<WorkspaceFileTree, String> {
    let mut paths = fs::read_dir(root)
        .map_err(|error| format!("Could not read workspace files: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|name| !is_ignored_workspace_dir(&name.to_string_lossy()))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| {
        let left_is_dir = left.is_dir();
        let right_is_dir = right.is_dir();
        right_is_dir
            .cmp(&left_is_dir)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });

    let mut remaining = 500usize;
    let mut entries = Vec::new();
    for path in paths {
        if let Some(entry) = build_workspace_entry(root, &path, 4, &mut remaining)? {
            entries.push(entry);
        }
        if remaining == 0 {
            break;
        }
    }

    Ok(WorkspaceFileTree {
        root: display_path(root),
        entries,
    })
}

pub(crate) fn read_text_preview(path: &Path) -> Result<(Option<String>, bool), String> {
    const PREVIEW_LIMIT: usize = 64 * 1024;
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not open file {}: {error}", display_path(path)))?;
    let mut buffer = Vec::new();
    let mut handle = std::io::Read::by_ref(&mut file).take((PREVIEW_LIMIT + 1) as u64);
    handle
        .read_to_end(&mut buffer)
        .map_err(|error| format!("Could not read file preview: {error}"))?;
    let truncated = buffer.len() > PREVIEW_LIMIT;
    if truncated {
        buffer.truncate(PREVIEW_LIMIT);
    }
    if buffer.contains(&0) {
        return Ok((None, truncated));
    }
    match String::from_utf8(buffer) {
        Ok(content) => Ok((Some(content), truncated)),
        Err(_) => Ok((None, truncated)),
    }
}
