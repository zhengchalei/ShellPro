use chrono::Utc;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use regex::Regex;
use keyring_core::{Entry as KeyringEntry, Error as KeyringError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
    terminals: Arc<Mutex<HashMap<String, TerminalProcess>>>,
}

struct TerminalProcess {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBootstrap {
    profiles: Vec<ConnectionProfile>,
    ai_config: AiProviderConfig,
    shell: String,
    cwd: String,
    os: String,
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
    let conn = Connection::open(path).map_err(|error| format!("Could not open database: {error}"))?;
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

fn default_ai_config() -> AiProviderConfig {
    AiProviderConfig {
        id: "default".to_string(),
        name: "OpenAI Compatible".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        model: "gpt-4.1-mini".to_string(),
        api_key_secret_ref: "shellpro-ai-default".to_string(),
        context_mode: ContextMode::RecentLines,
        recent_line_limit: 200,
        redact_secrets: true,
    }
}

fn load_ai_config(conn: &Connection) -> Result<AiProviderConfig, String> {
    conn.query_row(
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
    .map_err(|error| format!("Could not load AI configuration: {error}"))?
    .map_or_else(
        || {
            let config = default_ai_config();
            save_ai_config_record(conn, &config)?;
            Ok(config)
        },
        Ok,
    )
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

fn save_profile_record(conn: &Connection, input: ConnectionProfileInput) -> Result<ConnectionProfile, String> {
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
        private_key_path: input.private_key_path.filter(|value| !value.trim().is_empty()),
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

fn keyring_entry(secret_ref: &str) -> Result<KeyringEntry, String> {
    KeyringEntry::new("ShellPro", secret_ref)
        .map_err(|error| format!("Could not open secure storage entry: {error}"))
}

fn set_secret(secret_ref: &str, secret: &str) -> Result<(), String> {
    keyring_entry(secret_ref)?
        .set_password(secret)
        .map_err(|error| format!("Could not store secret: {error}"))
}

#[allow(dead_code)]
fn get_secret(secret_ref: &str) -> Result<Option<String>, String> {
    match keyring_entry(secret_ref)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read secret: {error}")),
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

fn spawn_reader(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    emit_terminal_event(&app, &session_id, "exit", json!({}));
                    break;
                }
                Ok(size) => {
                    let output = String::from_utf8_lossy(&buffer[..size]).to_string();
                    emit_terminal_event(&app, &session_id, "data", json!({ "data": output }));
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

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not clone terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not open terminal writer: {error}"))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not spawn terminal process: {error}"))?;

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
                writer,
                child,
                master: pair.master,
            },
        );
    spawn_reader(app, session_id, reader);
    Ok(session)
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
    } else if requires_sudo || modifies_files || medium_patterns.iter().any(|pattern| normalized.contains(pattern)) {
        RiskLevel::Medium
    } else if is_read_only {
        RiskLevel::Low
    } else {
        RiskLevel::Medium
    };
    let needs_confirmation = risk == RiskLevel::High || destructive;
    (risk, destructive, requires_sudo, modifies_files, needs_confirmation)
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
        (r"(?i)(password|passwd|pwd)\s*[:=]\s*[^\s]+", "$1=[REDACTED]"),
        (r"(?i)(api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}", "$1=[REDACTED]"),
        (r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9_\-./+=]+", "$1[REDACTED]"),
        (r"(?i)(aws_access_key_id|aws_secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]+", "$1=[REDACTED]"),
        (r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", "[REDACTED PRIVATE KEY]"),
        (r"(?i)(cookie:\s*)[^\r\n]+", "$1[REDACTED]"),
    ];

    patterns.iter().fold(input.to_string(), |current, (pattern, replacement)| {
        Regex::new(pattern)
            .map(|regex| regex.replace_all(&current, *replacement).to_string())
            .unwrap_or(current)
    })
}

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
    } else if text.contains("port") || text.contains("端口") || text.contains("address already in use") {
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
    } else if text.contains("ssh") || text.contains("connection refused") || text.contains("连接") {
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
    })
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
fn save_profile_secret(profile_id: String, secret_kind: String, secret: String) -> Result<String, String> {
    let secret_ref = format!("profile-{profile_id}-{secret_kind}");
    set_secret(&secret_ref, &secret)?;
    Ok(secret_ref)
}

#[tauri::command]
fn save_ai_config(
    state: State<AppState>,
    input: AiProviderInput,
) -> Result<AiProviderConfig, String> {
    let conn = open_db(&state.db_path)?;
    let config = AiProviderConfig {
        id: "default".to_string(),
        name: input.name,
        base_url: input.base_url,
        model: input.model,
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
    let redacted = redact_secrets(&context);
    RedactionPreview {
        original_chars: context.chars().count(),
        redacted_chars: redacted.chars().count(),
        content: redacted,
    }
}

#[tauri::command]
fn ask_ai_for_commands(request: AiRequest) -> Vec<AiCommandSuggestion> {
    let safe_request = AiRequest {
        context: redact_secrets(&request.context),
        selected_text: request.selected_text.map(|text| redact_secrets(&text)),
        ..request
    };
    generate_local_ai_suggestions(&safe_request)
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
    let session_id = Uuid::new_v4().to_string();
    let destination = format!("{}@{}", profile.username, profile.host);
    let mut command = CommandBuilder::new("ssh");
    command.arg("-p");
    command.arg(profile.port.to_string());
    command.arg("-o");
    command.arg("ServerAliveInterval=30");
    command.arg("-o");
    command.arg("ServerAliveCountMax=3");

    if let Some(key_path) = &profile.private_key_path {
        if matches!(profile.auth_type, AuthType::PrivateKey) {
            command.arg("-i");
            command.arg(key_path);
        }
    }

    if let Some(jump_host_id) = &profile.jump_host_id {
        if let Ok(jump_profile) = find_profile(&conn, jump_host_id) {
            command.arg("-J");
            command.arg(format!(
                "{}@{}:{}",
                jump_profile.username, jump_profile.host, jump_profile.port
            ));
        }
    }

    command.arg(destination);
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
    )
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
    terminal
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Could not write to terminal: {error}"))?;
    terminal
        .writer
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
    write_to_session(state, session_id, format!("{command}\n"))
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
            app.manage(AppState {
                db_path,
                terminals: Arc::new(Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            list_profiles,
            save_profile,
            delete_profile,
            save_profile_secret,
            save_ai_config,
            preview_ai_context,
            ask_ai_for_commands,
            classify_command_risk,
            create_command_queue_item,
            start_local_session,
            start_ssh_session,
            resize_session,
            write_to_session,
            execute_queued_command,
            close_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShellPro");
}
