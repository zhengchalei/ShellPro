use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_type: AuthType,
    pub(crate) private_key_path: Option<String>,
    pub(crate) group_id: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) jump_host_id: Option<String>,
    pub(crate) favorite: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AuthType {
    Password,
    PrivateKey,
    Agent,
}

impl AuthType {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            AuthType::Password => "password",
            AuthType::PrivateKey => "privateKey",
            AuthType::Agent => "agent",
        }
    }

    pub(crate) fn from_str(value: &str) -> Self {
        match value {
            "privateKey" => AuthType::PrivateKey,
            "agent" => AuthType::Agent,
            _ => AuthType::Password,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionProfileInput {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_type: AuthType,
    pub(crate) private_key_path: Option<String>,
    pub(crate) group_id: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) jump_host_id: Option<String>,
    pub(crate) favorite: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSession {
    pub(crate) id: String,
    pub(crate) profile_id: Option<String>,
    pub(crate) kind: SessionKind,
    pub(crate) title: String,
    pub(crate) status: SessionStatus,
    pub(crate) cwd: Option<String>,
    pub(crate) shell: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestResult {
    pub(crate) reachable: bool,
    pub(crate) latency_ms: Option<u64>,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProfilesResult {
    pub(crate) imported: usize,
    pub(crate) skipped: usize,
    pub(crate) profiles: Vec<ConnectionProfile>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshTunnelInput {
    pub(crate) profile_id: String,
    pub(crate) local_host: String,
    pub(crate) local_port: u16,
    pub(crate) remote_host: String,
    pub(crate) remote_port: u16,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshTunnelSession {
    pub(crate) id: String,
    pub(crate) profile_id: String,
    pub(crate) profile_name: String,
    pub(crate) local_host: String,
    pub(crate) local_port: u16,
    pub(crate) remote_host: String,
    pub(crate) remote_port: u16,
    pub(crate) status: TunnelStatus,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TunnelStatus {
    Running,
    Stopped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SessionKind {
    Local,
    Ssh,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key_secret_ref: String,
    pub(crate) context_mode: ContextMode,
    pub(crate) recent_line_limit: u16,
    pub(crate) redact_secrets: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ContextMode {
    Selected,
    RecentLines,
    FullBuffer,
}

impl ContextMode {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            ContextMode::Selected => "selected",
            ContextMode::RecentLines => "recentLines",
            ContextMode::FullBuffer => "fullBuffer",
        }
    }

    pub(crate) fn from_str(value: &str) -> Self {
        match value {
            "selected" => ContextMode::Selected,
            "fullBuffer" => ContextMode::FullBuffer,
            _ => ContextMode::RecentLines,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderInput {
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key: Option<String>,
    pub(crate) context_mode: ContextMode,
    pub(crate) recent_line_limit: u16,
    pub(crate) redact_secrets: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiRequest {
    pub(crate) question: String,
    pub(crate) context: String,
    pub(crate) selected_text: Option<String>,
    pub(crate) os: Option<String>,
    pub(crate) shell: Option<String>,
    pub(crate) cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiCommandSuggestion {
    pub(crate) id: String,
    pub(crate) command: String,
    pub(crate) explanation: String,
    pub(crate) risk_level: RiskLevel,
    pub(crate) expected_outcome: String,
    pub(crate) destructive: bool,
    pub(crate) requires_sudo: bool,
    pub(crate) modifies_files: bool,
    pub(crate) needs_confirmation: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct ChatCompletionRequest {
    pub(crate) model: String,
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) temperature: f32,
    pub(crate) max_tokens: u16,
    pub(crate) response_format: ChatResponseFormat,
}

#[derive(Debug, Serialize)]
pub(crate) struct ChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ChatResponseFormat {
    #[serde(rename = "type")]
    pub(crate) kind: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatCompletionResponse {
    pub(crate) choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatCompletionChoice {
    pub(crate) message: ChatCompletionMessage,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatCompletionMessage {
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatErrorEnvelope {
    pub(crate) error: Option<ChatError>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ChatError {
    pub(crate) message: Option<String>,
    #[serde(rename = "type")]
    pub(crate) error_type: Option<String>,
    pub(crate) code: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum AiSuggestionPayload {
    Envelope { suggestions: Vec<AiSuggestionDraft> },
    Array(Vec<AiSuggestionDraft>),
}

#[derive(Debug, Deserialize)]
pub(crate) struct AiSuggestionDraft {
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) explanation: String,
    #[serde(default, alias = "expectedOutcome")]
    pub(crate) expected_outcome: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandQueueItem {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) command: String,
    pub(crate) explanation: String,
    pub(crate) risk_level: RiskLevel,
    pub(crate) source: CommandSource,
    pub(crate) status: CommandStatus,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CommandSource {
    Ai,
    Snippet,
    Manual,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CommandStatus {
    Pending,
    Sent,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RedactionPreview {
    pub(crate) original_chars: usize,
    pub(crate) redacted_chars: usize,
    pub(crate) content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceFileKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFileEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) parent_path: Option<String>,
    pub(crate) kind: WorkspaceFileKind,
    pub(crate) size: Option<u64>,
    pub(crate) modified_at: Option<String>,
    pub(crate) children: Option<Vec<WorkspaceFileEntry>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFileTree {
    pub(crate) root: String,
    pub(crate) entries: Vec<WorkspaceFileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFilePreview {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) kind: WorkspaceFileKind,
    pub(crate) size: Option<u64>,
    pub(crate) modified_at: Option<String>,
    pub(crate) content: Option<String>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppBootstrap {
    pub(crate) profiles: Vec<ConnectionProfile>,
    pub(crate) ai_config: AiProviderConfig,
    pub(crate) shell: String,
    pub(crate) cwd: String,
    pub(crate) os: String,
    pub(crate) workspace_root: String,
}
