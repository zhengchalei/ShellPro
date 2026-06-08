use std::time::Duration;

use regex::Regex;
use uuid::Uuid;

use crate::models::{
    AiCommandSuggestion, AiProviderConfig, AiRequest, AiSuggestionDraft, AiSuggestionPayload,
    ChatCompletionRequest, ChatCompletionResponse, ChatErrorEnvelope, ChatMessage,
    ChatResponseFormat, RiskLevel,
};

pub(crate) fn classify_command(command: &str) -> (RiskLevel, bool, bool, bool, bool) {
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

pub(crate) fn suggestion(
    command: &str,
    explanation: &str,
    expected_outcome: &str,
) -> AiCommandSuggestion {
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

pub(crate) fn redact_secrets(input: &str) -> String {
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

pub(crate) fn sanitize_terminal_context(input: &str) -> String {
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
pub(crate) fn generate_local_ai_suggestions(request: &AiRequest) -> Vec<AiCommandSuggestion> {
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

pub(crate) fn prepare_ai_request(request: AiRequest, redact: bool) -> AiRequest {
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

pub(crate) fn chat_completions_url(base_url: &str) -> Result<String, String> {
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

pub(crate) fn parse_ai_suggestions(content: &str) -> Result<Vec<AiCommandSuggestion>, String> {
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

pub(crate) fn request_ai_suggestions(
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
