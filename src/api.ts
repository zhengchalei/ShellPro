import { invoke } from "@tauri-apps/api/core";
import type {
  AiCommandSuggestion,
  AiProviderConfig,
  AiProviderInput,
  AppBootstrap,
  CommandQueueItem,
  ConnectionProfile,
  ConnectionProfileInput,
  RedactionPreview,
  TerminalSession,
} from "./types";

const defaultAiConfig: AiProviderConfig = {
  id: "default",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeySecretRef: "shellpro-ai-default",
  contextMode: "recentLines",
  recentLineLimit: 200,
  redactSecrets: true,
};

function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }
  const tauriInternals = window.__TAURI_INTERNALS__;
  return (
    typeof tauriInternals === "object" &&
    tauriInternals !== null &&
    "invoke" in tauriInternals
  );
}

export function hasTauriRuntime() {
  return isTauriRuntime();
}

function now() {
  return new Date().toISOString();
}

function riskForCommand(command: string): AiCommandSuggestion {
  const normalized = command.toLowerCase();
  const high =
    normalized.includes("rm -rf") ||
    normalized.includes("mkfs") ||
    normalized.includes("drop database") ||
    normalized.includes("dd if=");
  const medium =
    !high &&
    (normalized.includes("sudo ") ||
      normalized.includes("systemctl") ||
      normalized.includes(" install ") ||
      normalized.includes(">"));
  return {
    id: crypto.randomUUID(),
    command,
    explanation: "ShellPro browser preview local risk estimate.",
    riskLevel: high ? "high" : medium ? "medium" : "low",
    expectedOutcome: "In the desktop app, this command is only sent after user confirmation.",
    destructive: high,
    requiresSudo: normalized.includes("sudo "),
    modifiesFiles: high || medium,
    needsConfirmation: high,
  };
}

function redact(text: string) {
  return text
    .replace(/(password|passwd|pwd)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}/gi, "$1=[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)[A-Za-z0-9_\-./+=]+/gi, "$1[REDACTED]");
}

function collapseBlankLines(text: string) {
  const lines = text.split("\n");
  const output: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (!line.trim()) {
      blankCount += 1;
      if (blankCount <= 2) {
        output.push("");
      }
      continue;
    }

    blankCount = 0;
    output.push(line);
  }

  return output.join("\n").trimEnd();
}

function sanitizeTerminalContext(text: string) {
  const withoutAnsi = text
    .replace(/\x1B\[[0-?]*[ -/]*[Hf]/g, "\n")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "");
  return collapseBlankLines(
    withoutAnsi
      .replace(/\r/g, "\n")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""),
  );
}

function mockProfiles(): ConnectionProfile[] {
  try {
    return JSON.parse(localStorage.getItem("shellpro.preview.profiles") ?? "[]");
  } catch {
    return [];
  }
}

function saveMockProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem("shellpro.preview.profiles", JSON.stringify(profiles));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }
  return mockInvoke<T>(command, args);
}

async function mockInvoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  switch (command) {
    case "app_bootstrap":
      return {
        profiles: mockProfiles(),
        aiConfig: defaultAiConfig,
        shell: "browser-preview",
        cwd: "/preview",
        os: navigator.platform,
      } as T;
    case "list_profiles":
      return mockProfiles() as T;
    case "save_profile": {
      const input = args.input as ConnectionProfileInput;
      const profiles = mockProfiles();
      const existing = profiles.find((profile) => profile.id === input.id);
      const profile: ConnectionProfile = {
        ...input,
        id: input.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      };
      saveMockProfiles([
        profile,
        ...profiles.filter((item) => item.id !== profile.id),
      ]);
      return profile as T;
    }
    case "delete_profile": {
      saveMockProfiles(
        mockProfiles().filter((profile) => profile.id !== args.id),
      );
      return undefined as T;
    }
    case "save_profile_secret":
      return "browser-preview-secret" as T;
    case "save_ai_config":
      return {
        ...(args.input as AiProviderInput),
        id: "default",
        apiKeySecretRef: "shellpro-ai-default",
      } as T;
    case "preview_ai_context": {
      const content = redact(sanitizeTerminalContext(String(args.context ?? "")));
      return {
        originalChars: String(args.context ?? "").length,
        redactedChars: content.length,
        content,
      } as T;
    }
    case "ask_ai_for_commands":
      return [
        {
          ...riskForCommand("pwd && ls -la"),
          explanation: "Confirm the current directory and inspect files before making changes.",
          expectedOutcome: "Shows the current path and a detailed directory listing.",
        },
        {
          ...riskForCommand("uname -a"),
          explanation: "Check OS and kernel details to choose the right troubleshooting command.",
          expectedOutcome: "Prints system information.",
        },
      ] as T;
    case "classify_command_risk":
      return riskForCommand(String(args.command ?? "")) as T;
    case "create_command_queue_item": {
      const suggestion = riskForCommand(String(args.command ?? ""));
      return {
        id: crypto.randomUUID(),
        sessionId: args.sessionId as string,
        command: suggestion.command,
        explanation: args.explanation as string,
        riskLevel: suggestion.riskLevel,
        source: "ai",
        status: "pending",
        createdAt: now(),
      } as T;
    }
    case "start_local_session":
      return {
        id: crypto.randomUUID(),
        kind: "local",
        title: "Browser Preview",
        status: "connected",
        cwd: "/preview",
        shell: "mock",
        createdAt: now(),
      } as T;
    case "start_ssh_session": {
      const profile = mockProfiles().find((item) => item.id === args.profileId);
      return {
        id: crypto.randomUUID(),
        profileId: args.profileId,
        kind: "ssh",
        title: profile?.name ?? "SSH Preview",
        status: "connected",
        shell: "ssh",
        createdAt: now(),
      } as T;
    }
    default:
      return undefined as T;
  }
}

export const shellProApi = {
  bootstrap: () => call<AppBootstrap>("app_bootstrap"),

  listProfiles: () => call<ConnectionProfile[]>("list_profiles"),

  saveProfile: (input: ConnectionProfileInput) =>
    call<ConnectionProfile>("save_profile", { input }),

  deleteProfile: (id: string) => call<void>("delete_profile", { id }),

  saveProfileSecret: (profileId: string, secretKind: string, secret: string) =>
    call<string>("save_profile_secret", { profileId, secretKind, secret }),

  saveAiConfig: (input: AiProviderInput) =>
    call<AiProviderConfig>("save_ai_config", { input }),

  previewAiContext: (context: string) =>
    call<RedactionPreview>("preview_ai_context", { context }),

  askAiForCommands: (request: {
    question: string;
    context: string;
    selectedText?: string;
    os?: string;
    shell?: string;
    cwd?: string;
  }) => call<AiCommandSuggestion[]>("ask_ai_for_commands", { request }),

  classifyCommandRisk: (command: string) =>
    call<AiCommandSuggestion>("classify_command_risk", { command }),

  createCommandQueueItem: (
    sessionId: string,
    command: string,
    explanation: string,
  ) =>
    call<CommandQueueItem>("create_command_queue_item", {
      sessionId,
      command,
      explanation,
    }),

  startLocalSession: (cols?: number, rows?: number) =>
    call<TerminalSession>("start_local_session", { cols, rows }),

  startSshSession: (profileId: string) =>
    call<TerminalSession>("start_ssh_session", { profileId }),

  resizeSession: (sessionId: string, cols: number, rows: number) =>
    call<void>("resize_session", { sessionId, cols, rows }),

  writeToSession: (sessionId: string, data: string) =>
    call<void>("write_to_session", { sessionId, data }),

  executeQueuedCommand: (
    sessionId: string,
    command: string,
    confirmedHighRisk: boolean,
  ) =>
    call<void>("execute_queued_command", {
      sessionId,
      command,
      confirmedHighRisk,
    }),

  closeSession: (sessionId: string) =>
    call<void>("close_session", { sessionId }),
};
