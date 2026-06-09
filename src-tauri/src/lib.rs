use keyring_core::{Entry as KeyringEntry, Error as KeyringError};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

mod ai;
mod models;
mod openssh;
mod workspace_files;

use ai::*;
use models::*;
use openssh::*;
use workspace_files::*;

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

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
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
                    latency_ms: Some(started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)),
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
fn list_workspace_files(
    state: State<AppState>,
    _session_id: Option<String>,
) -> Result<WorkspaceFileTree, String> {
    list_workspace(&state.workspace_root)
}

#[tauri::command]
fn preview_workspace_file(
    state: State<AppState>,
    path: String,
    _session_id: Option<String>,
) -> Result<WorkspaceFilePreview, String> {
    let path = resolve_workspace_path(&state.workspace_root, Some(path))?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not read file metadata: {error}"))?;
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
fn save_workspace_file(
    state: State<AppState>,
    path: String,
    content: String,
    _session_id: Option<String>,
) -> Result<(), String> {
    let target = resolve_workspace_path(&state.workspace_root, Some(path))?;
    let metadata =
        fs::metadata(&target).map_err(|error| format!("Could not read file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("Only files can be saved from the editor.".to_string());
    }
    fs::write(&target, content).map_err(|error| format!("Could not save file: {error}"))
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
            fs::create_dir(&target).map_err(|error| format!("Could not create folder: {error}"))?;
        }
        WorkspaceFileKind::File => {
            fs::File::create(&target).map_err(|error| format!("Could not create file: {error}"))?;
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
    let metadata =
        fs::metadata(&target).map_err(|error| format!("Could not read file metadata: {error}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target).map_err(|error| format!("Could not delete folder: {error}"))?;
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
        if tunnel.session.status == TunnelStatus::Running
            && tunnel.child.try_wait().ok().flatten().is_some()
        {
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
        assert_eq!(
            profile.private_key_path.as_deref(),
            Some("~/.ssh/id_ed25519")
        );
        assert_eq!(profile.jump_host_id.as_deref(), Some("jump-id"));
    }

    #[test]
    fn imports_proxyjump_from_same_config_and_reuses_existing_id() {
        let existing = vec![test_profile(
            "existing-app-id",
            "app-server",
            "old.example.com",
        )];
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
            save_workspace_file,
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
