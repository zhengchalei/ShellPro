use chrono::Utc;
use keyring_core::{Entry as KeyringEntry, Error as KeyringError};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    env,
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
    workspace_root: PathBuf,
    terminals: Arc<Mutex<HashMap<String, TerminalProcess>>>,
    tunnels: Arc<Mutex<HashMap<String, TunnelProcess>>>,
}

type TerminalWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct TerminalProcess {
    writer: TerminalWriter,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
}

struct TunnelProcess {
    session: SshTunnelSession,
    child: Child,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfile {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    private_key_path: Option<String>,
    group_id: Option<String>,
    tags: Vec<String>,
    jump_host_id: Option<String>,
    favorite: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
enum AuthType {
    Password,
    PrivateKey,
    Agent,
}

impl AuthType {
    fn as_str(&self) -> &'static str {
        match self {
            AuthType::Password => "password",
            AuthType::PrivateKey => "privateKey",
            AuthType::Agent => "agent",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "privateKey" => AuthType::PrivateKey,
            "agent" => AuthType::Agent,
            _ => AuthType::Password,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfileInput {
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    private_key_path: Option<String>,
    group_id: Option<String>,
    tags: Vec<String>,
    jump_host_id: Option<String>,
    favorite: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSession {
    id: String,
    profile_id: Option<String>,
    kind: SessionKind,
    title: String,
    status: SessionStatus,
    cwd: Option<String>,
    shell: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionTestResult {
    reachable: bool,
    latency_ms: Option<u64>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProfilesResult {
    imported: usize,
    skipped: usize,
    profiles: Vec<ConnectionProfile>,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshTunnelInput {
    profile_id: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTunnelSession {
    id: String,
    profile_id: String,
    profile_name: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    status: TunnelStatus,
    created_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
enum TunnelStatus {
    Running,
    Stopped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum SessionKind {
    Local,
    Ssh,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    id: String,
    name: String,
    base_url: String,
    model: String,
    api_key_secret_ref: String,
    context_mode: ContextMode,
    recent_line_limit: u16,
    redact_secrets: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
enum ContextMode {
    Selected,
    RecentLines,
    FullBuffer,
}

impl ContextMode {
    fn as_str(&self) -> &'static str {
        match self {
            ContextMode::Selected => "selected",
            ContextMode::RecentLines => "recentLines",
            ContextMode::FullBuffer => "fullBuffer",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "selected" => ContextMode::Selected,
            "fullBuffer" => ContextMode::FullBuffer,
            _ => ContextMode::RecentLines,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderInput {
    name: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    context_mode: ContextMode,
    recent_line_limit: u16,
    redact_secrets: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRequest {
    question: String,
    context: String,
    selected_text: Option<String>,
    os: Option<String>,
    shell: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiCommandSuggestion {
    id: String,
    command: String,
    explanation: String,
    risk_level: RiskLevel,
    expected_outcome: String,
    destructive: bool,
    requires_sudo: bool,
    modifies_files: bool,
    needs_confirmation: bool,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u16,
    response_format: ChatResponseFormat,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatResponseFormat {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatErrorEnvelope {
    error: Option<ChatError>,
}

#[derive(Debug, Deserialize)]
struct ChatError {
    message: Option<String>,
    #[serde(rename = "type")]
    error_type: Option<String>,
    code: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AiSuggestionPayload {
    Envelope { suggestions: Vec<AiSuggestionDraft> },
    Array(Vec<AiSuggestionDraft>),
}

#[derive(Debug, Deserialize)]
struct AiSuggestionDraft {
    command: String,
    #[serde(default)]
    explanation: String,
    #[serde(default, alias = "expectedOutcome")]
    expected_outcome: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandQueueItem {
    id: String,
    session_id: String,
    command: String,
    explanation: String,
    risk_level: RiskLevel,
    source: CommandSource,
    status: CommandStatus,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CommandSource {
    Ai,
    Snippet,
    Manual,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CommandStatus {
    Pending,
    Sent,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedactionPreview {
    original_chars: usize,
    redacted_chars: usize,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
enum WorkspaceFileKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntry {
    name: String,
    path: String,
    relative_path: String,
    parent_path: Option<String>,
    kind: WorkspaceFileKind,
    size: Option<u64>,
    modified_at: Option<String>,
    children: Option<Vec<WorkspaceFileEntry>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileTree {
    root: String,
    entries: Vec<WorkspaceFileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFilePreview {
    name: String,
    path: String,
    relative_path: String,
    kind: WorkspaceFileKind,
    size: Option<u64>,
    modified_at: Option<String>,
    content: Option<String>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBootstrap {
    profiles: Vec<ConnectionProfile>,
    ai_config: AiProviderConfig,
    shell: String,
    cwd: String,
    os: String,
    workspace_root: String,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn default_shell() -> String {
    if cfg!(windows) {
        env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(dir)
}

fn open_db(path: &PathBuf) -> Result<Connection, String> {
    let conn =
        Connection::open(path).map_err(|error| format!("Could not open database: {error}"))?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS connection_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            private_key_path TEXT,
            group_id TEXT,
            tags_json TEXT NOT NULL,
            jump_host_id TEXT,
            favorite INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_config (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            api_key_secret_ref TEXT NOT NULL,
            context_mode TEXT NOT NULL,
            recent_line_limit INTEGER NOT NULL,
            redact_secrets INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("Could not initialize database: {error}"))?;
    Ok(conn)
}

fn workspace_root() -> Result<PathBuf, String> {
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

fn modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<Utc>::from)
        .map(|time| time.to_rfc3339())
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.display().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn resolve_workspace_path(root: &Path, path: Option<String>) -> Result<PathBuf, String> {
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

fn resolve_new_workspace_path(
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

fn build_workspace_entry(
    root: &Path,
    path: &Path,
    depth: usize,
    remaining: &mut usize,
) -> Result<Option<WorkspaceFileEntry>, String> {
    if *remaining == 0 {
        return Ok(None);
    }
    *remaining -= 1;

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not read metadata for {}: {error}", display_path(path)))?;
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

fn list_workspace(root: &Path) -> Result<WorkspaceFileTree, String> {
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

fn read_text_preview(path: &Path) -> Result<(Option<String>, bool), String> {
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

fn default_ai_config() -> AiProviderConfig {
    AiProviderConfig {
        id: "default".to_string(),
        name: "DeepSeek".to_string(),
        base_url: "https://api.deepseek.com".to_string(),
        model: "deepseek-v4-flash".to_string(),
        api_key_secret_ref: "shellpro-ai-default".to_string(),
        context_mode: ContextMode::RecentLines,
        recent_line_limit: 200,
        redact_secrets: true,
    }
}

fn is_legacy_default_ai_config(config: &AiProviderConfig) -> bool {
    config.name == "OpenAI Compatible"
        && config.base_url == "https://api.openai.com/v1"
        && config.model == "gpt-4.1-mini"
        && config.api_key_secret_ref == "shellpro-ai-default"
}

fn load_ai_config(conn: &Connection) -> Result<AiProviderConfig, String> {
    let config = conn
        .query_row(
        "SELECT id, name, base_url, model, api_key_secret_ref, context_mode, recent_line_limit, redact_secrets FROM ai_config WHERE id = 'default'",
        [],
        |row| {
            Ok(AiProviderConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                model: row.get(3)?,
                api_key_secret_ref: row.get(4)?,
                context_mode: ContextMode::from_str(row.get::<_, String>(5)?.as_str()),
                recent_line_limit: row.get(6)?,
                redact_secrets: row.get::<_, i64>(7)? == 1,
            })
        },
    )
        .optional()
        .map_err(|error| format!("Could not load AI configuration: {error}"))?;

    match config {
        Some(config) if is_legacy_default_ai_config(&config) => {
            let next = default_ai_config();
            save_ai_config_record(conn, &next)?;
            Ok(next)
        }
        Some(config) => Ok(config),
        None => {
            let config = default_ai_config();
            save_ai_config_record(conn, &config)?;
            Ok(config)
        }
    }
}

fn save_ai_config_record(conn: &Connection, config: &AiProviderConfig) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO ai_config (id, name, base_url, model, api_key_secret_ref, context_mode, recent_line_limit, redact_secrets)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            base_url = excluded.base_url,
            model = excluded.model,
            api_key_secret_ref = excluded.api_key_secret_ref,
            context_mode = excluded.context_mode,
            recent_line_limit = excluded.recent_line_limit,
            redact_secrets = excluded.redact_secrets
        "#,
        params![
            config.id,
            config.name,
            config.base_url,
            config.model,
            config.api_key_secret_ref,
            config.context_mode.as_str(),
            config.recent_line_limit,
            i64::from(config.redact_secrets)
        ],
    )
    .map_err(|error| format!("Could not save AI configuration: {error}"))?;
    Ok(())
}

fn load_profiles(conn: &Connection) -> Result<Vec<ConnectionProfile>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT id, name, host, port, username, auth_type, private_key_path, group_id, tags_json,
                   jump_host_id, favorite, created_at, updated_at
            FROM connection_profiles
            ORDER BY favorite DESC, updated_at DESC, name ASC
            "#,
        )
        .map_err(|error| format!("Could not prepare profile query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let tags_json: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(ConnectionProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                auth_type: AuthType::from_str(row.get::<_, String>(5)?.as_str()),
                private_key_path: row.get(6)?,
                group_id: row.get(7)?,
                tags,
                jump_host_id: row.get(9)?,
                favorite: row.get::<_, i64>(10)? == 1,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|error| format!("Could not load profiles: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not parse profiles: {error}"))
}

fn find_profile(conn: &Connection, id: &str) -> Result<ConnectionProfile, String> {
    conn.query_row(
        r#"
        SELECT id, name, host, port, username, auth_type, private_key_path, group_id, tags_json,
               jump_host_id, favorite, created_at, updated_at
        FROM connection_profiles
        WHERE id = ?1
        "#,
        params![id],
        |row| {
            let tags_json: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(ConnectionProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                auth_type: AuthType::from_str(row.get::<_, String>(5)?.as_str()),
                private_key_path: row.get(6)?,
                group_id: row.get(7)?,
                tags,
                jump_host_id: row.get(9)?,
                favorite: row.get::<_, i64>(10)? == 1,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
    .map_err(|error| format!("Could not find profile {id}: {error}"))
}

fn save_profile_record(
    conn: &Connection,
    input: ConnectionProfileInput,
) -> Result<ConnectionProfile, String> {
    if input.name.trim().is_empty() {
        return Err("Profile name is required.".to_string());
    }
    if input.host.trim().is_empty() {
        return Err("Host is required.".to_string());
    }
    if input.username.trim().is_empty() {
        return Err("Username is required.".to_string());
    }

    let existing_created_at = input.id.as_ref().and_then(|id| {
        conn.query_row(
            "SELECT created_at FROM connection_profiles WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    });
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let profile = ConnectionProfile {
        id,
        name: input.name.trim().to_string(),
        host: input.host.trim().to_string(),
        port: input.port,
        username: input.username.trim().to_string(),
        auth_type: input.auth_type,
        private_key_path: input
            .private_key_path
            .filter(|value| !value.trim().is_empty()),
        group_id: input.group_id.filter(|value| !value.trim().is_empty()),
        tags: input
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect(),
        jump_host_id: input.jump_host_id.filter(|value| !value.trim().is_empty()),
        favorite: input.favorite,
        created_at: existing_created_at.unwrap_or_else(|| timestamp.clone()),
        updated_at: timestamp,
    };

    conn.execute(
        r#"
        INSERT INTO connection_profiles
            (id, name, host, port, username, auth_type, private_key_path, group_id, tags_json, jump_host_id, favorite, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            host = excluded.host,
            port = excluded.port,
            username = excluded.username,
            auth_type = excluded.auth_type,
            private_key_path = excluded.private_key_path,
            group_id = excluded.group_id,
            tags_json = excluded.tags_json,
            jump_host_id = excluded.jump_host_id,
            favorite = excluded.favorite,
            updated_at = excluded.updated_at
        "#,
        params![
            profile.id,
            profile.name,
            profile.host,
            profile.port,
            profile.username,
            profile.auth_type.as_str(),
            profile.private_key_path,
            profile.group_id,
            serde_json::to_string(&profile.tags).unwrap_or_else(|_| "[]".to_string()),
            profile.jump_host_id,
            i64::from(profile.favorite),
            profile.created_at,
            profile.updated_at
        ],
    )
    .map_err(|error| format!("Could not save profile: {error}"))?;

    Ok(profile)
}

fn test_tcp_connection(host: &str, port: u16) -> ConnectionTestResult {
    let host = host.trim();
    if host.is_empty() {
        return ConnectionTestResult {
            reachable: false,
            latency_ms: None,
            message: "Host is required.".to_string(),
        };
    }
    if port == 0 {
        return ConnectionTestResult {
            reachable: false,
            latency_ms: None,
            message: "Port must be between 1 and 65535.".to_string(),
        };
    }

    let address = format!("{host}:{port}");
    let timeout = Duration::from_secs(3);
    let socket_addresses = match address.to_socket_addrs() {
        Ok(addresses) => addresses.collect::<Vec<_>>(),
        Err(error) => {
            return ConnectionTestResult {
                reachable: false,
                latency_ms: None,
                message: format!("Could not resolve {address}: {error}"),
            };
        }
    };

    if socket_addresses.is_empty() {
        return ConnectionTestResult {
            reachable: false,
            latency_ms: None,
            message: format!("Could not resolve {address}."),
        };
    }

    let started = Instant::now();
    let mut last_error = None;
    for socket_address in socket_addresses {
        match TcpStream::connect_timeout(&socket_address, timeout) {
            Ok(_) => {
                return ConnectionTestResult {
                    reachable: true,
                    latency_ms: Some(
                        started
                            .elapsed()
                            .as_millis()
                            .try_into()
                            .unwrap_or(u64::MAX),
                    ),
                    message: format!("{address} is reachable."),
                };
            }
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
    }

    ConnectionTestResult {
        reachable: false,
        latency_ms: None,
        message: format!(
            "{address} is not reachable: {}",
            last_error.unwrap_or_else(|| "connection timed out".to_string())
        ),
    }
}

#[derive(Default)]
struct OpenSshHostBlock {
    aliases: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    proxy_jump: Option<String>,
}

struct ParsedOpenSshProfile {
    input: ConnectionProfileInput,
    proxy_jump: Option<String>,
}

fn has_openssh_wildcard(value: &str) -> bool {
    value.contains('*') || value.contains('?') || value.contains('!')
}

fn proxy_jump_host(value: &str) -> Option<String> {
    let first = value.split(',').next()?.trim();
    if first.is_empty() || first.eq_ignore_ascii_case("none") {
        return None;
    }
    let without_user = first.rsplit('@').next().unwrap_or(first);
    let host = without_user.split(':').next().unwrap_or(without_user).trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn openssh_words(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(|word| word.trim_matches('"').trim_matches('\'').to_string())
        .filter(|word| !word.is_empty())
        .collect()
}

fn profile_input_from_openssh_block(
    block: OpenSshHostBlock,
    existing_profiles: &[ConnectionProfile],
    warnings: &mut Vec<String>,
) -> Option<ParsedOpenSshProfile> {
    let alias = block
        .aliases
        .iter()
        .find(|alias| !has_openssh_wildcard(alias))
        .cloned();
    let Some(alias) = alias else {
        return None;
    };

    let host = block.hostname.unwrap_or_else(|| alias.clone());
    if host.trim().is_empty() {
        warnings.push(format!("Skipped {alias}: host is empty."));
        return None;
    }

    let proxy_jump = block.proxy_jump;
    let jump_host_id = proxy_jump.as_ref().and_then(|value| {
        proxy_jump_host(value).and_then(|jump_host| {
            existing_profiles
                .iter()
                .find(|profile| profile.host == jump_host || profile.name == jump_host)
                .map(|profile| profile.id.clone())
        })
    });

    Some(ParsedOpenSshProfile {
        input: ConnectionProfileInput {
            id: None,
            name: alias,
            host,
            port: block.port.unwrap_or(22),
            username: block.user.unwrap_or_else(|| "root".to_string()),
            auth_type: if block.identity_file.is_some() {
                AuthType::PrivateKey
            } else {
                AuthType::Agent
            },
            private_key_path: block.identity_file,
            group_id: Some("Imported".to_string()),
            tags: vec!["openssh".to_string()],
            jump_host_id,
            favorite: false,
        },
        proxy_jump,
    })
}

fn parse_openssh_config(
    content: &str,
    existing_profiles: &[ConnectionProfile],
) -> (Vec<ConnectionProfileInput>, usize, Vec<String>) {
    let mut parsed_profiles = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped = 0;
    let mut current: Option<OpenSshHostBlock> = None;
    let mut in_match_block = false;

    let flush_current = |current: &mut Option<OpenSshHostBlock>,
                         parsed_profiles: &mut Vec<ParsedOpenSshProfile>,
                         warnings: &mut Vec<String>,
                         skipped: &mut usize| {
        if let Some(block) = current.take() {
            let alias_count = block.aliases.len().max(1);
            if let Some(profile) =
                profile_input_from_openssh_block(block, existing_profiles, warnings)
            {
                parsed_profiles.push(profile);
            } else {
                *skipped += alias_count;
            }
        }
    };

    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let line_without_comment = trimmed.split('#').next().unwrap_or("").trim();
        if line_without_comment.is_empty() {
            continue;
        }
        let mut parts = line_without_comment.splitn(2, char::is_whitespace);
        let keyword = parts.next().unwrap_or("").to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();

        match keyword.as_str() {
            "host" => {
                in_match_block = false;
                flush_current(&mut current, &mut parsed_profiles, &mut warnings, &mut skipped);
                let aliases = openssh_words(value);
                if aliases.is_empty()
                    || aliases
                        .iter()
                        .any(|alias| alias == "*" || has_openssh_wildcard(alias))
                {
                    skipped += aliases.len().max(1);
                    current = None;
                    continue;
                }
                current = Some(OpenSshHostBlock {
                    aliases,
                    ..OpenSshHostBlock::default()
                });
            }
            "match" => {
                flush_current(&mut current, &mut parsed_profiles, &mut warnings, &mut skipped);
                in_match_block = true;
                warnings.push("Skipped Match block; complex OpenSSH conditions are not imported.".to_string());
            }
            "include" => {
                warnings.push("Skipped Include directive; import one resolved config file at a time.".to_string());
            }
            _ if in_match_block => {}
            _ => {
                if let Some(block) = &mut current {
                    match keyword.as_str() {
                        "hostname" => block.hostname = Some(value.to_string()),
                        "user" => block.user = Some(value.to_string()),
                        "port" => match value.parse::<u16>() {
                            Ok(port) if port > 0 => block.port = Some(port),
                            _ => warnings.push(format!(
                                "Skipped invalid port '{value}' for {}.",
                                block.aliases.join(", ")
                            )),
                        },
                        "identityfile" => block.identity_file = Some(value.to_string()),
                        "proxyjump" => block.proxy_jump = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

    flush_current(&mut current, &mut parsed_profiles, &mut warnings, &mut skipped);

    let mut profile_index: HashMap<String, String> = existing_profiles
        .iter()
        .flat_map(|profile| {
            [
                (profile.name.clone(), profile.id.clone()),
                (profile.host.clone(), profile.id.clone()),
            ]
        })
        .collect();

    for profile in &mut parsed_profiles {
        if profile.input.id.is_none() {
            profile.input.id = existing_profiles
                .iter()
                .find(|existing| existing.name == profile.input.name)
                .map(|existing| existing.id.clone());
        }
        let id = profile.input.id.get_or_insert_with(|| Uuid::new_v4().to_string());
        profile_index.insert(profile.input.name.clone(), id.clone());
        profile_index.insert(profile.input.host.clone(), id.clone());
    }

    let imported = parsed_profiles
        .into_iter()
        .map(|mut profile| {
            if profile.input.jump_host_id.is_none() {
                if let Some(proxy_jump) = &profile.proxy_jump {
                    if let Some(jump_host) = proxy_jump_host(proxy_jump) {
                        profile.input.jump_host_id = profile_index.get(&jump_host).cloned();
                        if profile.input.jump_host_id.is_none() {
                            warnings.push(format!(
                                "Imported {} without ProxyJump because the jump host profile was not found.",
                                profile.input.name
                            ));
                        }
                    }
                }
            }
            profile.input
        })
        .collect();

    (imported, skipped, warnings)
}

fn keyring_entry(secret_ref: &str) -> Result<KeyringEntry, String> {
    KeyringEntry::new("ShellPro", secret_ref)
        .map_err(|error| format!("Could not open secure storage entry: {error}"))
}

fn set_secret(secret_ref: &str, secret: &str) -> Result<(), String> {
    keyring_entry(secret_ref)?
        .set_password(secret)
        .map_err(|error| format!("Could not store secret: {error}"))
}

fn get_secret(secret_ref: &str) -> Result<Option<String>, String> {
    match keyring_entry(secret_ref)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read secret: {error}")),
    }
}

fn profile_secret_ref(profile_id: &str, auth_type: &AuthType) -> String {
    format!("profile-{profile_id}-{}", auth_type.as_str())
}

fn load_profile_secret(profile: &ConnectionProfile) -> Result<Option<String>, String> {
    match &profile.auth_type {
        AuthType::Password | AuthType::PrivateKey => {
            get_secret(&profile_secret_ref(&profile.id, &profile.auth_type))
        }
        AuthType::Agent => Ok(None),
    }
}

fn emit_terminal_event(app: &AppHandle, session_id: &str, event: &str, payload: serde_json::Value) {
    let _ = app.emit(
        "terminal://event",
        json!({
            "sessionId": session_id,
            "event": event,
            "payload": payload
        }),
    );
}

fn filter_device_status_reports(output: &str) -> (String, usize) {
    const DEVICE_STATUS_REPORT_QUERY: &str = "\x1b[6n";
    let query_count = output.matches(DEVICE_STATUS_REPORT_QUERY).count();
    if query_count == 0 {
        return (output.to_string(), 0);
    }
    (output.replace(DEVICE_STATUS_REPORT_QUERY, ""), query_count)
}

fn answer_device_status_reports(
    app: &AppHandle,
    session_id: &str,
    writer: &TerminalWriter,
    query_count: usize,
) {
    if query_count == 0 {
        return;
    }

    match writer.lock() {
        Ok(mut writer) => {
            for _ in 0..query_count {
                if let Err(error) = writer.write_all(b"\x1b[1;1R") {
                    emit_terminal_event(
                        app,
                        session_id,
                        "error",
                        json!({ "message": format!("Could not answer terminal cursor query: {error}") }),
                    );
                    return;
                }
            }
            if let Err(error) = writer.flush() {
                emit_terminal_event(
                    app,
                    session_id,
                    "error",
                    json!({ "message": format!("Could not flush terminal cursor query response: {error}") }),
                );
            }
        }
        Err(_) => emit_terminal_event(
            app,
            session_id,
            "error",
            json!({ "message": "Could not lock terminal writer.".to_string() }),
        ),
    }
}

fn command_line_ending() -> &'static str {
    if cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}

fn spawn_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    writer: TerminalWriter,
    auto_secret: Option<String>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut prompt_buffer = String::new();
        let mut sent_auto_secret = false;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    emit_terminal_event(&app, &session_id, "exit", json!({}));
                    break;
                }
                Ok(size) => {
                    let output = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let (output, query_count) = filter_device_status_reports(&output);
                    answer_device_status_reports(&app, &session_id, &writer, query_count);
                    if !output.is_empty() {
                        prompt_buffer.push_str(&output);
                        if prompt_buffer.chars().count() > 600 {
                            prompt_buffer = prompt_buffer
                                .chars()
                                .rev()
                                .take(600)
                                .collect::<String>()
                                .chars()
                                .rev()
                                .collect();
                        }
                        emit_terminal_event(&app, &session_id, "data", json!({ "data": output }));
                        if !sent_auto_secret && looks_like_credential_prompt(&prompt_buffer) {
                            if let Some(secret) =
                                auto_secret.as_ref().filter(|value| !value.is_empty())
                            {
                                sent_auto_secret = true;
                                if let Err(error) = write_secret_to_terminal(&writer, secret) {
                                    emit_terminal_event(
                                        &app,
                                        &session_id,
                                        "error",
                                        json!({ "message": error }),
                                    );
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    emit_terminal_event(
                        &app,
                        &session_id,
                        "error",
                        json!({ "message": error.to_string() }),
                    );
                    break;
                }
            }
        }
    });
}

fn looks_like_credential_prompt(output: &str) -> bool {
    let normalized = output.to_lowercase();
    let trimmed = normalized.trim_end();
    let has_prompt_suffix = trimmed.ends_with(':') || trimmed.ends_with(": ");
    if !has_prompt_suffix {
        return false;
    }

    trimmed.contains("password")
        || trimmed.contains("passphrase")
        || trimmed.contains("密码")
        || trimmed.contains("口令")
}

fn write_secret_to_terminal(writer: &TerminalWriter, secret: &str) -> Result<(), String> {
    let mut writer = writer
        .lock()
        .map_err(|_| "Could not lock terminal writer for saved SSH secret.".to_string())?;
    writer
        .write_all(secret.as_bytes())
        .map_err(|error| format!("Could not write saved SSH secret: {error}"))?;
    writer
        .write_all(command_line_ending().as_bytes())
        .map_err(|error| format!("Could not submit saved SSH secret: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Could not flush saved SSH secret: {error}"))
}

fn spawn_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    profile_id: Option<String>,
    title: String,
    command: CommandBuilder,
    cwd: Option<String>,
    shell: Option<String>,
    kind: SessionKind,
    auto_secret: Option<String>,
) -> Result<TerminalSession, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not open pseudo terminal: {error}"))?;

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not spawn terminal process: {error}"))?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not clone terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not open terminal writer: {error}"))?;
    let writer = Arc::new(Mutex::new(writer));

    let session = TerminalSession {
        id: session_id.clone(),
        profile_id,
        kind,
        title,
        status: SessionStatus::Connected,
        cwd,
        shell,
        created_at: now(),
    };

    state
        .terminals
        .lock()
        .map_err(|_| "Could not lock terminal registry.".to_string())?
        .insert(
            session_id.clone(),
            TerminalProcess {
                writer: Arc::clone(&writer),
                child,
                master: pair.master,
            },
        );
    spawn_reader(app, session_id, reader, writer, auto_secret);
    Ok(session)
}

fn ssh_destination(profile: &ConnectionProfile) -> String {
    format!("{}@{}", profile.username, profile.host)
}

fn append_ssh_base_args(args: &mut Vec<String>, profile: &ConnectionProfile, batch_mode: bool) {
    args.push("-p".to_string());
    args.push(profile.port.to_string());
    args.push("-o".to_string());
    args.push("ServerAliveInterval=30".to_string());
    args.push("-o".to_string());
    args.push("ServerAliveCountMax=3".to_string());
    args.push("-o".to_string());
    args.push(format!(
        "BatchMode={}",
        if batch_mode { "yes" } else { "no" }
    ));
}

fn append_ssh_auth_args(args: &mut Vec<String>, profile: &ConnectionProfile) {
    match &profile.auth_type {
        AuthType::Password => {
            args.push("-o".to_string());
            args.push("PreferredAuthentications=password,keyboard-interactive".to_string());
            args.push("-o".to_string());
            args.push("PubkeyAuthentication=no".to_string());
        }
        AuthType::PrivateKey => {
            args.push("-o".to_string());
            args.push("IdentitiesOnly=yes".to_string());
            if let Some(key_path) = &profile.private_key_path {
                args.push("-i".to_string());
                args.push(key_path.to_string());
            }
        }
        AuthType::Agent => {}
    }
}

fn append_ssh_jump_arg(
    args: &mut Vec<String>,
    conn: &Connection,
    profile: &ConnectionProfile,
    require_existing_jump_host: bool,
) -> Result<(), String> {
    if let Some(jump_host_id) = &profile.jump_host_id {
        match find_profile(conn, jump_host_id) {
            Ok(jump_profile) => {
                args.push("-J".to_string());
                args.push(format!(
                    "{}@{}:{}",
                    jump_profile.username, jump_profile.host, jump_profile.port
                ));
            }
            Err(error) if require_existing_jump_host => return Err(error),
            Err(_) => {}
        }
    }
    Ok(())
}

fn ssh_session_args(conn: &Connection, profile: &ConnectionProfile) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    append_ssh_base_args(&mut args, profile, false);
    append_ssh_auth_args(&mut args, profile);
    append_ssh_jump_arg(&mut args, conn, profile, false)?;
    args.push(ssh_destination(profile));
    Ok(args)
}

fn validate_tunnel_input(input: &SshTunnelInput) -> Result<(), String> {
    let local_host = input.local_host.trim();
    let remote_host = input.remote_host.trim();
    if local_host.is_empty() {
        return Err("Local bind address is required.".to_string());
    }
    if !matches!(local_host, "127.0.0.1" | "localhost" | "::1") {
        return Err("Only loopback bind addresses are supported for tunnels.".to_string());
    }
    if input.local_port == 0 || input.remote_port == 0 {
        return Err("Tunnel ports must be between 1 and 65535.".to_string());
    }
    if remote_host.is_empty() {
        return Err("Remote host is required.".to_string());
    }
    Ok(())
}

fn ssh_tunnel_args(
    conn: &Connection,
    profile: &ConnectionProfile,
    input: &SshTunnelInput,
) -> Result<Vec<String>, String> {
    validate_tunnel_input(input)?;
    if matches!(profile.auth_type, AuthType::Password) {
        return Err(
            "SSH tunnels currently support SSH agent or private key profiles only.".to_string(),
        );
    }

    let mut args = Vec::new();
    append_ssh_base_args(&mut args, profile, true);
    append_ssh_auth_args(&mut args, profile);
    append_ssh_jump_arg(&mut args, conn, profile, true)?;
    args.push("-o".to_string());
    args.push("ExitOnForwardFailure=yes".to_string());
    args.push("-N".to_string());
    args.push("-T".to_string());
    args.push("-L".to_string());
    args.push(format!(
        "{}:{}:{}:{}",
        input.local_host.trim(),
        input.local_port,
        input.remote_host.trim(),
        input.remote_port
    ));
    args.push(ssh_destination(profile));
    Ok(args)
}

fn ssh_command_builder(args: &[String]) -> CommandBuilder {
    let mut command = CommandBuilder::new("ssh");
    for arg in args {
        command.arg(arg);
    }
    command
}

fn classify_command(command: &str) -> (RiskLevel, bool, bool, bool, bool) {
    let normalized = command.trim().to_lowercase();
    let destructive_patterns = [
        "rm -rf",
        "mkfs",
        "dd if=",
        "diskutil erase",
        "drop database",
        "truncate table",
        "delete from",
        "shutdown",
        "reboot",
        ":(){",
        "chmod -r 777",
        "chown -r",
    ];
    let medium_patterns = [
        "sudo ",
        "systemctl restart",
        "service ",
        "brew install",
        "apt install",
        "yum install",
        "dnf install",
        "npm install -g",
        "pip install",
        "docker rm",
        "kubectl delete",
    ];
    let modifies_patterns = [
        ">",
        " mv ",
        " cp ",
        "sed -i",
        "touch ",
        "mkdir ",
        "install ",
        "delete",
        "remove",
        "rm ",
        "git reset",
        "git clean",
    ];
    let read_only = [
        "ls", "pwd", "cat", "grep", "rg", "find", "ps", "top", "df", "du", "whoami", "uname",
        "echo", "tail", "head", "which", "where", "date",
    ];

    let destructive = destructive_patterns
        .iter()
        .any(|pattern| normalized.contains(pattern));
    let requires_sudo = normalized.starts_with("sudo ") || normalized.contains(" sudo ");
    let modifies_files = destructive
        || modifies_patterns
            .iter()
            .any(|pattern| normalized.contains(pattern));
    let is_read_only = read_only.iter().any(|cmd| {
        normalized == *cmd
            || normalized.starts_with(format!("{cmd} ").as_str())
            || normalized.starts_with(format!("{cmd}\t").as_str())
    });

    let risk = if destructive {
        RiskLevel::High
    } else if requires_sudo
        || modifies_files
        || medium_patterns
            .iter()
            .any(|pattern| normalized.contains(pattern))
    {
        RiskLevel::Medium
    } else if is_read_only {
        RiskLevel::Low
    } else {
        RiskLevel::Medium
    };
    let needs_confirmation = risk == RiskLevel::High || destructive;
    (
        risk,
        destructive,
        requires_sudo,
        modifies_files,
        needs_confirmation,
    )
}

fn suggestion(command: &str, explanation: &str, expected_outcome: &str) -> AiCommandSuggestion {
    let (risk_level, destructive, requires_sudo, modifies_files, needs_confirmation) =
        classify_command(command);
    AiCommandSuggestion {
        id: Uuid::new_v4().to_string(),
        command: command.to_string(),
        explanation: explanation.to_string(),
        risk_level,
        expected_outcome: expected_outcome.to_string(),
        destructive,
        requires_sudo,
        modifies_files,
        needs_confirmation,
    }
}

fn redact_secrets(input: &str) -> String {
    let patterns = [
        (
            r"(?i)(password|passwd|pwd)\s*[:=]\s*[^\s]+",
            "$1=[REDACTED]",
        ),
        (
            r"(?i)(api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}",
            "$1=[REDACTED]",
        ),
        (
            r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9_\-./+=]+",
            "$1[REDACTED]",
        ),
        (
            r"(?i)(aws_access_key_id|aws_secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]+",
            "$1=[REDACTED]",
        ),
        (
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
            "[REDACTED PRIVATE KEY]",
        ),
        (r"(?i)(cookie:\s*)[^\r\n]+", "$1[REDACTED]"),
    ];

    patterns
        .iter()
        .fold(input.to_string(), |current, (pattern, replacement)| {
            Regex::new(pattern)
                .map(|regex| regex.replace_all(&current, *replacement).to_string())
                .unwrap_or(current)
        })
}

fn strip_ansi_sequences(input: &str) -> String {
    let with_cursor_breaks = Regex::new(r"\x1b\[[0-?]*[ -/]*[Hf]")
        .map(|regex| regex.replace_all(input, "\n").to_string())
        .unwrap_or_else(|_| input.to_string());
    let patterns = [
        r"\x1b\[[0-?]*[ -/]*[@-~]",
        r"\x1b\][^\x07]*(\x07|\x1b\\)",
        r"\x1b[@-Z\\-_]",
    ];

    patterns
        .iter()
        .fold(with_cursor_breaks, |current, pattern| {
            Regex::new(pattern)
                .map(|regex| regex.replace_all(&current, "").to_string())
                .unwrap_or(current)
        })
}

fn collapse_blank_lines(input: &str) -> String {
    let mut output = String::new();
    let mut blank_count = 0;

    for line in input.lines() {
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count <= 2 {
                output.push('\n');
            }
            continue;
        }

        blank_count = 0;
        output.push_str(line);
        output.push('\n');
    }

    output.trim_end().to_string()
}

fn sanitize_terminal_context(input: &str) -> String {
    let without_ansi = strip_ansi_sequences(input);
    let normalized = without_ansi
        .chars()
        .filter_map(|character| match character {
            '\r' => Some('\n'),
            '\n' | '\t' => Some(character),
            value if value.is_control() => None,
            value => Some(value),
        })
        .collect::<String>();
    collapse_blank_lines(&normalized)
}

#[allow(dead_code)]
fn generate_local_ai_suggestions(request: &AiRequest) -> Vec<AiCommandSuggestion> {
    let environment_hint = format!(
        "{} {} {}",
        request.os.clone().unwrap_or_default(),
        request.shell.clone().unwrap_or_default(),
        request.cwd.clone().unwrap_or_default()
    );
    let text = format!(
        "{}\n{}\n{}\n{}",
        request.question,
        request.context,
        request.selected_text.clone().unwrap_or_default(),
        environment_hint
    )
    .to_lowercase();
    let mut suggestions = Vec::new();

    if text.contains("permission denied") || text.contains("权限") {
        suggestions.push(suggestion(
            "ls -la",
            "查看当前目录中文件和权限位，先确认是不是所有者、执行位或目录权限导致的问题。",
            "列出详细权限信息，帮助定位 Permission denied 的来源。",
        ));
        suggestions.push(suggestion(
            "whoami && id",
            "确认当前用户和所属用户组，避免误判权限问题。",
            "输出当前用户名、uid、gid 和用户组。",
        ));
    } else if text.contains("port")
        || text.contains("端口")
        || text.contains("address already in use")
    {
        suggestions.push(suggestion(
            "lsof -iTCP -sTCP:LISTEN -n -P",
            "查看本机正在监听的 TCP 端口，适合排查端口占用。",
            "列出监听端口和对应进程。",
        ));
        suggestions.push(suggestion(
            "ps aux | grep -i <process-name>",
            "按进程名搜索可疑服务，执行前请把占位符替换成实际进程名。",
            "帮助找到占用端口或相关服务的进程。",
        ));
    } else if text.contains("disk") || text.contains("磁盘") || text.contains("no space") {
        suggestions.push(suggestion(
            "df -h",
            "查看各挂载点磁盘使用率，先确认是否磁盘空间不足。",
            "输出人类可读的磁盘容量和使用率。",
        ));
        suggestions.push(suggestion(
            "du -sh ./* | sort -h",
            "统计当前目录各项占用空间，便于找出大文件或大目录。",
            "按大小排序显示当前目录下的空间占用。",
        ));
    } else if text.contains("ssh") || text.contains("connection refused") || text.contains("连接")
    {
        suggestions.push(suggestion(
            "ssh -vvv user@host",
            "使用详细日志连接 SSH，执行前请替换 user 和 host。",
            "输出 SSH 握手、认证和失败原因细节。",
        ));
        suggestions.push(suggestion(
            "nc -vz host 22",
            "测试目标主机 22 端口连通性，执行前请替换 host。",
            "确认网络和 SSH 端口是否可达。",
        ));
    } else if text.contains("git") {
        suggestions.push(suggestion(
            "git status --short",
            "查看工作区变更摘要，先确认当前仓库状态。",
            "输出未提交、已暂存和未跟踪文件。",
        ));
        suggestions.push(suggestion(
            "git log --oneline -5",
            "查看最近提交，帮助理解当前分支上下文。",
            "显示最近 5 条提交记录。",
        ));
    } else {
        suggestions.push(suggestion(
            "pwd && ls -la",
            "先确认当前位置和目录内容，这是排查终端问题的低风险起点。",
            "输出当前目录路径和详细文件列表。",
        ));
        suggestions.push(suggestion(
            "uname -a",
            "查看系统内核和平台信息，便于选择正确的排查命令。",
            "输出操作系统和内核版本信息。",
        ));
    }

    suggestions
}

fn sanitize_ai_text(input: String, redact: bool) -> String {
    let sanitized = sanitize_terminal_context(&input);
    if redact {
        redact_secrets(&sanitized)
    } else {
        sanitized
    }
}

fn truncate_context(input: &str, max_chars: usize) -> String {
    let char_count = input.chars().count();
    if char_count <= max_chars {
        return input.to_string();
    }

    let tail = input
        .chars()
        .skip(char_count.saturating_sub(max_chars))
        .collect::<String>();
    format!("[Earlier terminal context omitted]\n{tail}")
}

fn prepare_ai_request(request: AiRequest, redact: bool) -> AiRequest {
    let context = truncate_context(&sanitize_ai_text(request.context, redact), 12_000);
    let selected_text = request
        .selected_text
        .map(|text| truncate_context(&sanitize_ai_text(text, redact), 4_000));

    AiRequest {
        question: request.question.trim().to_string(),
        context,
        selected_text,
        os: request.os,
        shell: request.shell,
        cwd: request.cwd,
    }
}

fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI base URL is required.".to_string());
    }

    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

fn ai_system_prompt() -> String {
    [
        "You are ShellPro's terminal command advisor.",
        "Return json only, with this shape: {\"suggestions\":[{\"command\":\"...\",\"explanation\":\"...\",\"expectedOutcome\":\"...\"}]}",
        "Suggest 1 to 4 single-line shell commands that help the user diagnose or solve the request.",
        "Prefer low-risk read-only commands first. Use placeholders when hostnames, process names, or paths are unknown.",
        "Never include secrets, API keys, passwords, or commands that exfiltrate data.",
        "Do not claim a command has executed. The user must manually approve every command.",
        "Write explanation and expectedOutcome in the same language as the user's question when possible.",
    ]
    .join("\n")
}

fn ai_user_prompt(request: &AiRequest) -> String {
    format!(
        "Question:\n{question}\n\nEnvironment:\nOS: {os}\nShell: {shell}\nCWD: {cwd}\n\nSelected terminal text:\n{selected_text}\n\nRecent terminal context:\n{context}",
        question = request.question,
        os = request.os.clone().unwrap_or_else(|| "unknown".to_string()),
        shell = request.shell.clone().unwrap_or_else(|| "unknown".to_string()),
        cwd = request.cwd.clone().unwrap_or_else(|| "unknown".to_string()),
        selected_text = request
            .selected_text
            .clone()
            .unwrap_or_else(|| "(none)".to_string()),
        context = if request.context.trim().is_empty() {
            "(none)".to_string()
        } else {
            request.context.clone()
        },
    )
}

fn strip_json_code_fence(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if !trimmed.starts_with("```") {
        return None;
    }

    let without_opening = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
    Some(
        without_opening
            .trim()
            .trim_end_matches("```")
            .trim()
            .to_string(),
    )
}

fn json_candidates(input: &str) -> Vec<String> {
    let trimmed = input.trim();
    let mut candidates = vec![trimmed.to_string()];

    if let Some(stripped) = strip_json_code_fence(trimmed) {
        candidates.push(stripped);
    }

    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start <= end {
            candidates.push(trimmed[start..=end].to_string());
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if start <= end {
            candidates.push(trimmed[start..=end].to_string());
        }
    }

    candidates
}

fn normalize_ai_command(input: &str) -> String {
    let command = input
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .trim_matches('`')
        .trim();

    command
        .strip_prefix("$ ")
        .or_else(|| command.strip_prefix("> "))
        .unwrap_or(command)
        .trim()
        .to_string()
}

fn suggestions_from_drafts(
    drafts: Vec<AiSuggestionDraft>,
) -> Result<Vec<AiCommandSuggestion>, String> {
    let mut suggestions = Vec::new();

    for draft in drafts {
        let command = normalize_ai_command(&draft.command);
        if command.is_empty()
            || suggestions
                .iter()
                .any(|suggestion: &AiCommandSuggestion| suggestion.command == command)
        {
            continue;
        }

        let explanation = if draft.explanation.trim().is_empty() {
            "DeepSeek suggested this command.".to_string()
        } else {
            draft.explanation.trim().to_string()
        };
        let expected_outcome = if draft.expected_outcome.trim().is_empty() {
            "Review the command output before choosing the next step.".to_string()
        } else {
            draft.expected_outcome.trim().to_string()
        };

        suggestions.push(suggestion(&command, &explanation, &expected_outcome));
        if suggestions.len() >= 4 {
            break;
        }
    }

    if suggestions.is_empty() {
        Err("DeepSeek did not return any usable command suggestions.".to_string())
    } else {
        Ok(suggestions)
    }
}

fn parse_ai_suggestions(content: &str) -> Result<Vec<AiCommandSuggestion>, String> {
    for candidate in json_candidates(content) {
        if let Ok(payload) = serde_json::from_str::<AiSuggestionPayload>(&candidate) {
            let drafts = match payload {
                AiSuggestionPayload::Envelope { suggestions } => suggestions,
                AiSuggestionPayload::Array(suggestions) => suggestions,
            };
            return suggestions_from_drafts(drafts);
        }
    }

    Err("DeepSeek response did not contain valid JSON command suggestions.".to_string())
}

fn format_chat_error(status: reqwest::StatusCode, body: &str) -> String {
    if let Ok(envelope) = serde_json::from_str::<ChatErrorEnvelope>(body) {
        if let Some(error) = envelope.error {
            let mut parts = Vec::new();
            if let Some(error_type) = error.error_type {
                parts.push(error_type);
            }
            if let Some(code) = error.code {
                parts.push(code.to_string());
            }
            if let Some(message) = error.message {
                parts.push(message);
            }
            if !parts.is_empty() {
                return format!("DeepSeek request failed ({status}): {}", parts.join(" - "));
            }
        }
    }

    let excerpt = body.chars().take(500).collect::<String>();
    format!("DeepSeek request failed ({status}): {excerpt}")
}

fn request_ai_suggestions(
    config: &AiProviderConfig,
    api_key: &str,
    request: &AiRequest,
) -> Result<Vec<AiCommandSuggestion>, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("AI API key is empty.".to_string());
    }

    let model = config.model.trim();
    if model.is_empty() {
        return Err("AI model is required.".to_string());
    }

    let url = chat_completions_url(&config.base_url)?;
    let body = ChatCompletionRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: ai_system_prompt(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: ai_user_prompt(request),
            },
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: ChatResponseFormat {
            kind: "json_object".to_string(),
        },
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not create DeepSeek HTTP client: {error}"))?;

    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Could not reach DeepSeek API: {error}"))?;
    let status = response.status();
    let response_body = response
        .text()
        .map_err(|error| format!("Could not read DeepSeek response: {error}"))?;

    if !status.is_success() {
        return Err(format_chat_error(status, &response_body));
    }

    let completion = serde_json::from_str::<ChatCompletionResponse>(&response_body)
        .map_err(|error| format!("Could not parse DeepSeek response: {error}"))?;
    let content = completion
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .ok_or_else(|| "DeepSeek response did not include a message.".to_string())?;

    parse_ai_suggestions(&content)
}

#[tauri::command]
fn app_bootstrap(state: State<AppState>) -> Result<AppBootstrap, String> {
    let conn = open_db(&state.db_path)?;
    let profiles = load_profiles(&conn)?;
    let ai_config = load_ai_config(&conn)?;
    Ok(AppBootstrap {
        profiles,
        ai_config,
        shell: default_shell(),
        cwd: env::current_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| String::new()),
        os: env::consts::OS.to_string(),
        workspace_root: display_path(&state.workspace_root),
    })
}

#[tauri::command]
fn list_workspace_files(state: State<AppState>) -> Result<WorkspaceFileTree, String> {
    list_workspace(&state.workspace_root)
}

#[tauri::command]
fn preview_workspace_file(
    state: State<AppState>,
    path: String,
) -> Result<WorkspaceFilePreview, String> {
    let path = resolve_workspace_path(&state.workspace_root, Some(path))?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read file metadata: {error}"))?;
    let is_directory = metadata.is_dir();
    let (content, truncated) = if metadata.is_file() {
        read_text_preview(&path)?
    } else {
        (None, false)
    };

    Ok(WorkspaceFilePreview {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_display(&state.workspace_root, &path)),
        path: display_path(&path),
        relative_path: relative_display(&state.workspace_root, &path),
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
        content,
        truncated,
    })
}

#[tauri::command]
fn create_workspace_file(
    state: State<AppState>,
    parent_path: Option<String>,
    name: String,
    kind: WorkspaceFileKind,
) -> Result<(), String> {
    let target = resolve_new_workspace_path(&state.workspace_root, parent_path, &name)?;
    if target.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }

    match kind {
        WorkspaceFileKind::Directory => {
            fs::create_dir(&target)
                .map_err(|error| format!("Could not create folder: {error}"))?;
        }
        WorkspaceFileKind::File => {
            fs::File::create(&target)
                .map_err(|error| format!("Could not create file: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_workspace_file(state: State<AppState>, path: String) -> Result<(), String> {
    let target = resolve_workspace_path(&state.workspace_root, Some(path))?;
    if target == state.workspace_root {
        return Err("Cannot delete the workspace root.".to_string());
    }
    let metadata = fs::metadata(&target)
        .map_err(|error| format!("Could not read file metadata: {error}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Could not delete folder: {error}"))?;
    } else {
        fs::remove_file(&target).map_err(|error| format!("Could not delete file: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn rename_workspace_file(
    state: State<AppState>,
    path: String,
    new_name: String,
) -> Result<WorkspaceFileEntry, String> {
    let target = resolve_workspace_path(&state.workspace_root, Some(path))?;
    if target == state.workspace_root {
        return Err("Cannot rename the workspace root.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Could not resolve parent folder.".to_string())?
        .to_path_buf();
    let next = resolve_new_workspace_path(
        &state.workspace_root,
        Some(display_path(&parent)),
        new_name.trim(),
    )?;
    if next.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }
    fs::rename(&target, &next).map_err(|error| format!("Could not rename file: {error}"))?;

    let mut remaining = 1usize;
    build_workspace_entry(&state.workspace_root, &next, 0, &mut remaining)?
        .ok_or_else(|| "Could not read renamed file.".to_string())
}

#[tauri::command]
fn upload_workspace_files(
    state: State<AppState>,
    parent_path: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let parent = resolve_workspace_path(&state.workspace_root, parent_path)?;
    if !parent.is_dir() {
        return Err("Upload target must be a folder.".to_string());
    }

    for source in paths {
        let source_path = PathBuf::from(&source)
            .canonicalize()
            .map_err(|error| format!("Could not resolve upload source {source}: {error}"))?;
        if source_path.is_dir() {
            return Err("Folder upload is not supported yet.".to_string());
        }
        let name = source_path
            .file_name()
            .ok_or_else(|| "Could not resolve upload file name.".to_string())?;
        let target = parent.join(name);
        fs::copy(&source_path, &target)
            .map_err(|error| format!("Could not upload {}: {error}", display_path(&source_path)))?;
    }
    Ok(())
}

#[tauri::command]
fn write_workspace_file(
    state: State<AppState>,
    parent_path: Option<String>,
    name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let target = resolve_new_workspace_path(&state.workspace_root, parent_path, &name)?;
    fs::write(&target, bytes).map_err(|error| format!("Could not write file: {error}"))
}

#[tauri::command]
fn list_profiles(state: State<AppState>) -> Result<Vec<ConnectionProfile>, String> {
    let conn = open_db(&state.db_path)?;
    load_profiles(&conn)
}

#[tauri::command]
fn save_profile(
    state: State<AppState>,
    input: ConnectionProfileInput,
) -> Result<ConnectionProfile, String> {
    let conn = open_db(&state.db_path)?;
    save_profile_record(&conn, input)
}

#[tauri::command]
fn delete_profile(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = open_db(&state.db_path)?;
    conn.execute("DELETE FROM connection_profiles WHERE id = ?1", params![id])
        .map_err(|error| format!("Could not delete profile: {error}"))?;
    Ok(())
}

#[tauri::command]
fn test_connection(input: ConnectionProfileInput) -> Result<ConnectionTestResult, String> {
    Ok(test_tcp_connection(&input.host, input.port))
}

#[tauri::command]
fn import_openssh_config(
    state: State<AppState>,
    content: String,
) -> Result<ImportProfilesResult, String> {
    let conn = open_db(&state.db_path)?;
    let existing_profiles = load_profiles(&conn)?;
    let (inputs, skipped, warnings) = parse_openssh_config(&content, &existing_profiles);
    let mut profiles = Vec::new();
    for input in inputs {
        profiles.push(save_profile_record(&conn, input)?);
    }

    Ok(ImportProfilesResult {
        imported: profiles.len(),
        skipped,
        profiles,
        warnings,
    })
}

#[tauri::command]
fn save_profile_secret(
    profile_id: String,
    secret_kind: String,
    secret: String,
) -> Result<String, String> {
    let secret_ref = profile_secret_ref(&profile_id, &AuthType::from_str(&secret_kind));
    set_secret(&secret_ref, &secret)?;
    Ok(secret_ref)
}

#[tauri::command]
fn save_ai_config(
    state: State<AppState>,
    input: AiProviderInput,
) -> Result<AiProviderConfig, String> {
    let conn = open_db(&state.db_path)?;
    let name = input.name.trim();
    let base_url = input.base_url.trim();
    let model = input.model.trim();

    if name.is_empty() {
        return Err("AI provider name is required.".to_string());
    }
    if base_url.is_empty() {
        return Err("AI base URL is required.".to_string());
    }
    if model.is_empty() {
        return Err("AI model is required.".to_string());
    }

    let config = AiProviderConfig {
        id: "default".to_string(),
        name: name.to_string(),
        base_url: base_url.trim_end_matches('/').to_string(),
        model: model.to_string(),
        api_key_secret_ref: "shellpro-ai-default".to_string(),
        context_mode: input.context_mode,
        recent_line_limit: input.recent_line_limit.clamp(20, 5000),
        redact_secrets: input.redact_secrets,
    };

    if let Some(api_key) = input.api_key.filter(|value| !value.trim().is_empty()) {
        set_secret(&config.api_key_secret_ref, api_key.trim())?;
    }

    save_ai_config_record(&conn, &config)?;
    Ok(config)
}

#[tauri::command]
fn preview_ai_context(context: String) -> RedactionPreview {
    let sanitized = sanitize_terminal_context(&context);
    let redacted = redact_secrets(&sanitized);
    RedactionPreview {
        original_chars: context.chars().count(),
        redacted_chars: redacted.chars().count(),
        content: redacted,
    }
}

#[tauri::command]
fn ask_ai_for_commands(
    state: State<AppState>,
    request: AiRequest,
) -> Result<Vec<AiCommandSuggestion>, String> {
    let conn = open_db(&state.db_path)?;
    let config = load_ai_config(&conn)?;
    let api_key = get_secret(&config.api_key_secret_ref)?.ok_or_else(|| {
        "AI API key is not configured. Save a DeepSeek API key in settings first.".to_string()
    })?;
    let safe_request = prepare_ai_request(request, config.redact_secrets);
    request_ai_suggestions(&config, &api_key, &safe_request)
}

#[tauri::command]
fn classify_command_risk(command: String) -> AiCommandSuggestion {
    suggestion(
        &command,
        "ShellPro 根据本地安全规则给出的风险评估。",
        "用户确认后才会发送到当前终端。",
    )
}

#[tauri::command]
fn create_command_queue_item(
    session_id: String,
    command: String,
    explanation: String,
) -> CommandQueueItem {
    let (risk_level, _, _, _, _) = classify_command(&command);
    CommandQueueItem {
        id: Uuid::new_v4().to_string(),
        session_id,
        command,
        explanation,
        risk_level,
        source: CommandSource::Ai,
        status: CommandStatus::Pending,
        created_at: now(),
    }
}

#[tauri::command]
fn start_local_session(
    app: AppHandle,
    state: State<AppState>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSession, String> {
    let shell = default_shell();
    let mut command = CommandBuilder::new(shell.clone());
    if cfg!(windows) && shell.to_lowercase().contains("powershell") {
        command.arg("-NoLogo");
    }
    let session_id = Uuid::new_v4().to_string();
    let cwd = env::current_dir()
        .ok()
        .map(|path| path.display().to_string());

    let session = spawn_terminal(
        app,
        state,
        session_id,
        None,
        "Local".to_string(),
        command,
        cwd,
        Some(shell),
        SessionKind::Local,
        None,
    )?;

    let _ = (cols, rows);

    Ok(session)
}

#[tauri::command]
fn start_ssh_session(
    app: AppHandle,
    state: State<AppState>,
    profile_id: String,
) -> Result<TerminalSession, String> {
    let conn = open_db(&state.db_path)?;
    let profile = find_profile(&conn, &profile_id)?;
    let auto_secret = load_profile_secret(&profile)?;
    let session_id = Uuid::new_v4().to_string();
    let args = ssh_session_args(&conn, &profile)?;
    let command = ssh_command_builder(&args);
    spawn_terminal(
        app,
        state,
        session_id,
        Some(profile.id),
        profile.name,
        command,
        None,
        Some("ssh".to_string()),
        SessionKind::Ssh,
        auto_secret,
    )
}

#[tauri::command]
fn list_ssh_tunnels(state: State<AppState>) -> Result<Vec<SshTunnelSession>, String> {
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "Could not lock SSH tunnel registry.".to_string())?;
    let mut sessions = Vec::new();
    for tunnel in tunnels.values_mut() {
        if tunnel.session.status == TunnelStatus::Running && tunnel.child.try_wait().ok().flatten().is_some() {
            tunnel.session.status = TunnelStatus::Stopped;
        }
        sessions.push(tunnel.session.clone());
    }
    Ok(sessions)
}

#[tauri::command]
fn start_ssh_tunnel(
    state: State<AppState>,
    input: SshTunnelInput,
) -> Result<SshTunnelSession, String> {
    let conn = open_db(&state.db_path)?;
    let profile = find_profile(&conn, &input.profile_id)?;
    let args = ssh_tunnel_args(&conn, &profile, &input)?;
    let mut command = Command::new("ssh");
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start SSH tunnel: {error}"))?;

    thread::sleep(Duration::from_millis(500));
    if let Some(status) = child
        .try_wait()
        .map_err(|error| format!("Could not inspect SSH tunnel status: {error}"))?
    {
        let mut stderr = String::new();
        if let Some(mut stream) = child.stderr.take() {
            let _ = stream.read_to_string(&mut stderr);
        }
        let detail = stderr.trim();
        let message = if detail.is_empty() {
            format!("SSH tunnel exited immediately with status {status}.")
        } else {
            format!("SSH tunnel exited immediately with status {status}: {detail}")
        };
        return Err(message);
    }

    if let Some(mut stream) = child.stderr.take() {
        thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = stream.read_to_end(&mut sink);
        });
    }

    let session = SshTunnelSession {
        id: Uuid::new_v4().to_string(),
        profile_id: profile.id,
        profile_name: profile.name,
        local_host: input.local_host.trim().to_string(),
        local_port: input.local_port,
        remote_host: input.remote_host.trim().to_string(),
        remote_port: input.remote_port,
        status: TunnelStatus::Running,
        created_at: now(),
    };
    state
        .tunnels
        .lock()
        .map_err(|_| "Could not lock SSH tunnel registry.".to_string())?
        .insert(
            session.id.clone(),
            TunnelProcess {
                session: session.clone(),
                child,
            },
        );
    Ok(session)
}

#[tauri::command]
fn stop_ssh_tunnel(state: State<AppState>, tunnel_id: String) -> Result<(), String> {
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "Could not lock SSH tunnel registry.".to_string())?;
    if let Some(mut tunnel) = tunnels.remove(&tunnel_id) {
        let _ = tunnel.child.kill();
        let _ = tunnel.child.wait();
    }
    Ok(())
}

fn resize_session_inner(
    session_id: &str,
    cols: u16,
    rows: u16,
    state: &AppState,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "Could not lock terminal registry.".to_string())?;
    let terminal = terminals
        .get_mut(session_id)
        .ok_or_else(|| format!("Terminal session {session_id} was not found."))?;
    terminal
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not resize terminal: {error}"))
}

#[tauri::command]
fn resize_session(
    state: State<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    resize_session_inner(&session_id, cols, rows, &state)
}

#[tauri::command]
fn write_to_session(
    state: State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "Could not lock terminal registry.".to_string())?;
    let terminal = terminals
        .get_mut(&session_id)
        .ok_or_else(|| format!("Terminal session {session_id} was not found."))?;
    let writer = Arc::clone(&terminal.writer);
    drop(terminals);

    let mut writer = writer
        .lock()
        .map_err(|_| "Could not lock terminal writer.".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Could not write to terminal: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Could not flush terminal input: {error}"))
}

#[tauri::command]
fn execute_queued_command(
    state: State<AppState>,
    session_id: String,
    command: String,
    confirmed_high_risk: bool,
) -> Result<(), String> {
    let (risk_level, _, _, _, needs_confirmation) = classify_command(&command);
    if needs_confirmation && !confirmed_high_risk {
        return Err(format!(
            "Command is {:?} risk and needs explicit confirmation before execution.",
            risk_level
        ));
    }
    write_to_session(
        state,
        session_id,
        format!("{command}{}", command_line_ending()),
    )
}

#[tauri::command]
fn close_session(state: State<AppState>, session_id: String) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "Could not lock terminal registry.".to_string())?;
    if let Some(mut terminal) = terminals.remove(&session_id) {
        let _ = terminal.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secret_patterns() {
        let input = "password=supersecret\nAuthorization: Bearer abcdefghijklmnop\n";
        let output = redact_secrets(input);
        assert!(output.contains("password=[REDACTED]"));
        assert!(output.contains("Bearer [REDACTED]"));
        assert!(!output.contains("supersecret"));
    }

    #[test]
    fn filters_device_status_report_queries() {
        let (output, count) = filter_device_status_reports("hello\x1b[6nworld\x1b[6n");
        assert_eq!(output, "helloworld");
        assert_eq!(count, 2);
    }

    #[test]
    fn sanitizes_terminal_context_for_ai_preview() {
        let input = "\x1b[?25l\x1b[H中文ShellPro测试\x1b[K\n\n\npassword=supersecret\x1b[?25h";
        let output = sanitize_terminal_context(input);
        assert!(output.contains("中文ShellPro测试"));
        assert!(output.contains("password=supersecret"));
        assert!(!output.contains('\x1b'));
        assert!(!output.contains("[?25"));
    }

    #[test]
    fn preview_ai_context_sanitizes_before_redaction() {
        let preview =
            preview_ai_context("\x1b[?25l中文ShellPro测试\x1b[K\npassword=supersecret".to_string());
        assert!(preview.content.contains("中文ShellPro测试"));
        assert!(preview.content.contains("password=[REDACTED]"));
        assert!(!preview.content.contains('\x1b'));
        assert!(!preview.content.contains("supersecret"));
    }

    #[test]
    fn builds_chat_completions_url_from_deepseek_base() {
        assert_eq!(
            chat_completions_url("https://api.deepseek.com").unwrap(),
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.deepseek.com/v1/").unwrap(),
            "https://api.deepseek.com/v1/chat/completions"
        );
    }

    #[test]
    fn parses_ai_json_suggestions_and_reclassifies_risk() {
        let content = r#"{
            "suggestions": [
                {
                    "command": "$ ls -la",
                    "explanation": "查看当前目录文件。",
                    "expectedOutcome": "列出文件和权限。"
                },
                {
                    "command": "rm -rf /tmp/example",
                    "explanation": "删除临时目录。",
                    "expectedOutcome": "目录会被删除。"
                }
            ]
        }"#;

        let suggestions = parse_ai_suggestions(content).unwrap();
        assert_eq!(suggestions.len(), 2);
        assert_eq!(suggestions[0].command, "ls -la");
        assert_eq!(suggestions[0].risk_level, RiskLevel::Low);
        assert_eq!(suggestions[1].risk_level, RiskLevel::High);
        assert!(suggestions[1].needs_confirmation);
    }

    #[test]
    fn prepares_ai_request_with_redaction_and_truncation() {
        let request = AiRequest {
            question: " 下一步怎么排查？ ".to_string(),
            context: format!("{}\napi_key=abcdefgh12345678", "x".repeat(12_100)),
            selected_text: Some("password=supersecret".to_string()),
            os: Some("windows".to_string()),
            shell: Some("powershell".to_string()),
            cwd: Some("C:\\work".to_string()),
        };

        let prepared = prepare_ai_request(request, true);
        assert_eq!(prepared.question, "下一步怎么排查？");
        assert!(prepared
            .context
            .contains("[Earlier terminal context omitted]"));
        assert!(prepared.context.contains("api_key=[REDACTED]"));
        assert!(prepared.context.chars().count() <= 12_050);
        assert_eq!(prepared.selected_text.unwrap(), "password=[REDACTED]");
    }

    #[test]
    fn uses_platform_line_ending_for_commands() {
        if cfg!(windows) {
            assert_eq!(command_line_ending(), "\r\n");
        } else {
            assert_eq!(command_line_ending(), "\n");
        }
    }

    #[test]
    fn builds_profile_secret_refs_from_auth_type() {
        assert_eq!(
            profile_secret_ref("abc", &AuthType::Password),
            "profile-abc-password"
        );
        assert_eq!(
            profile_secret_ref("abc", &AuthType::PrivateKey),
            "profile-abc-privateKey"
        );
    }

    #[test]
    fn test_tcp_connection_rejects_blank_host() {
        let result = test_tcp_connection("   ", 22);
        assert!(!result.reachable);
        assert_eq!(result.message, "Host is required.");
    }

    #[test]
    fn test_tcp_connection_rejects_zero_port() {
        let result = test_tcp_connection("localhost", 0);
        assert!(!result.reachable);
        assert_eq!(result.message, "Port must be between 1 and 65535.");
    }

    fn test_profile(id: &str, name: &str, host: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.to_string(),
            name: name.to_string(),
            host: host.to_string(),
            port: 22,
            username: "ops".to_string(),
            auth_type: AuthType::Agent,
            private_key_path: None,
            group_id: None,
            tags: vec![],
            jump_host_id: None,
            favorite: false,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn tunnel_input(profile_id: &str) -> SshTunnelInput {
        SshTunnelInput {
            profile_id: profile_id.to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: 15432,
            remote_host: "127.0.0.1".to_string(),
            remote_port: 5432,
        }
    }

    fn test_db() -> (Connection, PathBuf) {
        let path = std::env::temp_dir().join(format!("shellpro-test-{}.sqlite3", Uuid::new_v4()));
        let conn = open_db(&path).unwrap();
        (conn, path)
    }

    #[test]
    fn validates_tunnel_loopback_and_ports() {
        let mut input = tunnel_input("profile-id");
        input.local_port = 0;
        assert_eq!(
            validate_tunnel_input(&input).unwrap_err(),
            "Tunnel ports must be between 1 and 65535."
        );

        input.local_port = 15432;
        input.local_host = "0.0.0.0".to_string();
        assert_eq!(
            validate_tunnel_input(&input).unwrap_err(),
            "Only loopback bind addresses are supported for tunnels."
        );

        input.local_host = "localhost".to_string();
        assert!(validate_tunnel_input(&input).is_ok());
    }

    #[test]
    fn builds_agent_tunnel_args_with_jump_host() {
        let (conn, path) = test_db();
        let mut jump = test_profile("jump-id", "jump", "jump.example.com");
        jump.username = "bastion".to_string();
        save_profile_record(
            &conn,
            ConnectionProfileInput {
                id: Some(jump.id.clone()),
                name: jump.name.clone(),
                host: jump.host.clone(),
                port: jump.port,
                username: jump.username.clone(),
                auth_type: jump.auth_type.clone(),
                private_key_path: jump.private_key_path.clone(),
                group_id: jump.group_id.clone(),
                tags: jump.tags.clone(),
                jump_host_id: None,
                favorite: jump.favorite,
            },
        )
        .unwrap();

        let mut profile = test_profile("app-id", "app", "app.example.com");
        profile.jump_host_id = Some("jump-id".to_string());
        let args = ssh_tunnel_args(&conn, &profile, &tunnel_input("app-id")).unwrap();

        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"ExitOnForwardFailure=yes".to_string()));
        assert!(args.contains(&"-N".to_string()));
        assert!(args.contains(&"-T".to_string()));
        assert!(args.contains(&"127.0.0.1:15432:127.0.0.1:5432".to_string()));
        assert!(args.contains(&"bastion@jump.example.com:22".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("ops@app.example.com"));
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_password_profile_for_tunnels() {
        let (conn, path) = test_db();
        let mut profile = test_profile("password-id", "password", "app.example.com");
        profile.auth_type = AuthType::Password;
        let error = ssh_tunnel_args(&conn, &profile, &tunnel_input("password-id")).unwrap_err();
        assert_eq!(
            error,
            "SSH tunnels currently support SSH agent or private key profiles only."
        );
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn parses_common_openssh_config_profiles() {
        let existing = vec![test_profile("jump-id", "bastion", "bastion.example.com")];
        let (profiles, skipped, warnings) = parse_openssh_config(
            r#"
            Host app-server
              HostName 10.0.0.15
              User ubuntu
              Port 2222
              IdentityFile ~/.ssh/id_ed25519
              ProxyJump ops@bastion.example.com:22

            Host *
              User ignored
            "#,
            &existing,
        );

        assert_eq!(profiles.len(), 1);
        assert_eq!(skipped, 1);
        assert!(warnings.is_empty());
        let profile = &profiles[0];
        assert_eq!(profile.name, "app-server");
        assert_eq!(profile.host, "10.0.0.15");
        assert_eq!(profile.username, "ubuntu");
        assert_eq!(profile.port, 2222);
        assert!(matches!(profile.auth_type, AuthType::PrivateKey));
        assert_eq!(profile.private_key_path.as_deref(), Some("~/.ssh/id_ed25519"));
        assert_eq!(profile.jump_host_id.as_deref(), Some("jump-id"));
    }

    #[test]
    fn imports_proxyjump_from_same_config_and_reuses_existing_id() {
        let existing = vec![test_profile("existing-app-id", "app-server", "old.example.com")];
        let (profiles, skipped, warnings) = parse_openssh_config(
            r#"
            Host bastion
              HostName bastion.example.com
              User ops

            Host app-server
              HostName 10.0.0.15
              User ubuntu
              ProxyJump bastion
            "#,
            &existing,
        );

        assert_eq!(profiles.len(), 2);
        assert_eq!(skipped, 0);
        assert!(warnings.is_empty());
        let bastion = profiles
            .iter()
            .find(|profile| profile.name == "bastion")
            .expect("bastion profile");
        let app = profiles
            .iter()
            .find(|profile| profile.name == "app-server")
            .expect("app profile");
        assert_eq!(app.id.as_deref(), Some("existing-app-id"));
        assert_eq!(app.host, "10.0.0.15");
        assert_eq!(app.jump_host_id.as_deref(), bastion.id.as_deref());
    }

    #[test]
    fn skips_complex_openssh_blocks_with_warnings() {
        let (profiles, skipped, warnings) = parse_openssh_config(
            r#"
            Include ~/.ssh/config.d/*
            Host web-*
              HostName 10.0.0.20
            Match user root
              HostName ignored
            Host db
              HostName db.internal
              ProxyJump missing-bastion
            "#,
            &[],
        );

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "db");
        assert_eq!(profiles[0].host, "db.internal");
        assert!(profiles[0].jump_host_id.is_none());
        assert_eq!(skipped, 1);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("Include directive")));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("Match block")));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("without ProxyJump")));
    }

    #[test]
    fn detects_ssh_credential_prompts() {
        assert!(looks_like_credential_prompt("root@example.com's password:"));
        assert!(looks_like_credential_prompt(
            "Enter passphrase for key '/Users/me/.ssh/id_ed25519':"
        ));
        assert!(looks_like_credential_prompt("请输入密码:"));
        assert!(!looks_like_credential_prompt("password=[REDACTED]\n"));
        assert!(!looks_like_credential_prompt(
            "Permission denied, please try again."
        ));
    }

    #[test]
    fn classifies_read_only_command_as_low_risk() {
        let (risk, destructive, sudo, modifies, confirm) = classify_command("ls -la");
        assert_eq!(risk, RiskLevel::Low);
        assert!(!destructive);
        assert!(!sudo);
        assert!(!modifies);
        assert!(!confirm);
    }

    #[test]
    fn classifies_destructive_command_as_high_risk() {
        let (risk, destructive, _, _, confirm) = classify_command("rm -rf /tmp/example");
        assert_eq!(risk, RiskLevel::High);
        assert!(destructive);
        assert!(confirm);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            keyring::use_native_store(false)
                .map_err(|error| format!("Could not initialize secure storage: {error}"))?;
            let db_path = app_data_dir(&app.handle())?.join("shellpro.sqlite3");
            let conn = open_db(&db_path)?;
            let _ = load_ai_config(&conn)?;
            let workspace_root = workspace_root()?;
        app.manage(AppState {
            db_path,
            workspace_root,
            terminals: Arc::new(Mutex::new(HashMap::new())),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            list_workspace_files,
            preview_workspace_file,
            create_workspace_file,
            delete_workspace_file,
            rename_workspace_file,
            upload_workspace_files,
            write_workspace_file,
            list_profiles,
            save_profile,
            delete_profile,
            test_connection,
            import_openssh_config,
            save_profile_secret,
            save_ai_config,
            preview_ai_context,
            ask_ai_for_commands,
            classify_command_risk,
            create_command_queue_item,
            start_local_session,
            start_ssh_session,
            list_ssh_tunnels,
            start_ssh_tunnel,
            stop_ssh_tunnel,
            resize_session,
            write_to_session,
            execute_queued_command,
            close_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShellPro");
}
