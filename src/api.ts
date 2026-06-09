import { invoke } from "@tauri-apps/api/core";
import type {
  AiCommandSuggestion,
  AiProviderConfig,
  AiProviderInput,
  AppBootstrap,
  CommandQueueItem,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionTestResult,
  ImportProfilesResult,
  SshTunnelInput,
  SshTunnelSession,
  RedactionPreview,
  TerminalSession,
  WorkspaceFileEntry,
  WorkspaceFilePreview,
  WorkspaceFileTree,
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

function mockTunnels(): SshTunnelSession[] {
  try {
    return JSON.parse(localStorage.getItem("shellpro.preview.tunnels") ?? "[]");
  } catch {
    return [];
  }
}

function saveMockTunnels(tunnels: SshTunnelSession[]) {
  localStorage.setItem("shellpro.preview.tunnels", JSON.stringify(tunnels));
}

function hasOpenSshWildcard(value: string) {
  return /[*?!]/.test(value);
}

function parseProxyJumpHost(value: string) {
  const first = value.split(",")[0]?.trim();
  if (!first || first.toLowerCase() === "none") {
    return "";
  }
  const withoutUser = first.includes("@") ? first.split("@").pop() ?? first : first;
  return withoutUser.split(":")[0]?.trim() ?? "";
}

function importOpenSshProfilesForPreview(content: string): ImportProfilesResult {
  const existingProfiles = mockProfiles();
  const imported: Array<ConnectionProfile & { proxyJumpHost?: string }> = [];
  const warnings: string[] = [];
  let skipped = 0;
  let inMatchBlock = false;
  let current:
    | {
        aliases: string[];
        values: Record<string, string>;
      }
    | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const alias = current.aliases.find((item) => !hasOpenSshWildcard(item));
    if (!alias) {
      skipped += current.aliases.length;
      current = null;
      return;
    }
    const hostName = current.values.hostname || alias;
    const user = current.values.user || "root";
    const port = Number(current.values.port || 22);
    if (!hostName || !Number.isFinite(port) || port < 1 || port > 65535) {
      skipped += 1;
      warnings.push(`Skipped ${alias}: invalid host or port.`);
      current = null;
      return;
    }
    const proxyJumpHost = parseProxyJumpHost(current.values.proxyjump || "");
    const jumpHostId =
      existingProfiles.find(
        (profile) => profile.host === proxyJumpHost || profile.name === proxyJumpHost,
      )?.id ?? "";
    const nowValue = now();
    const existingProfile = existingProfiles.find((profile) => profile.name === alias);
    imported.push({
      id: existingProfile?.id ?? crypto.randomUUID(),
      name: alias,
      host: hostName,
      port,
      username: user,
      authType: current.values.identityfile ? "privateKey" : "agent",
      privateKeyPath: current.values.identityfile || "",
      groupId: "Imported",
      tags: ["openssh"],
      jumpHostId,
      favorite: false,
      createdAt: existingProfile?.createdAt ?? nowValue,
      updatedAt: nowValue,
      proxyJumpHost,
    });
    current = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const [keyword = "", ...rest] = trimmed.split(/\s+/);
    const key = keyword.toLowerCase();
    const value = rest.join(" ").trim();
    if (key === "host") {
      inMatchBlock = false;
      flush();
      const aliases = rest.filter(Boolean);
      if (
        aliases.length === 0 ||
        aliases.some((alias) => alias.toLowerCase() === "*" || hasOpenSshWildcard(alias))
      ) {
        skipped += aliases.length || 1;
        current = null;
        continue;
      }
      current = { aliases, values: {} };
      continue;
    }
    if (key === "match") {
      flush();
      inMatchBlock = true;
      warnings.push("Skipped Match block; complex OpenSSH conditions are not imported.");
      continue;
    }
    if (key === "include") {
      warnings.push("Skipped Include directive; import one resolved config file at a time.");
      continue;
    }
    if (inMatchBlock) {
      continue;
    }
    if (!current) {
      continue;
    }
    if (["hostname", "user", "port", "identityfile", "proxyjump"].includes(key)) {
      current.values[key] = value;
    }
  }
  flush();

  const profileIndex = new Map<string, string>();
  [...existingProfiles, ...imported].forEach((profile) => {
    profileIndex.set(profile.name, profile.id);
    profileIndex.set(profile.host, profile.id);
  });
  const importedProfiles = imported.map(({ proxyJumpHost, ...profile }) => {
    if (!profile.jumpHostId && proxyJumpHost) {
      profile.jumpHostId = profileIndex.get(proxyJumpHost) ?? "";
      if (!profile.jumpHostId) {
        warnings.push(
          `Imported ${profile.name} without ProxyJump because the jump host profile was not found.`,
        );
      }
    }
    return profile;
  });

  const importedIds = new Set(importedProfiles.map((profile) => profile.id));
  saveMockProfiles([
    ...importedProfiles,
    ...existingProfiles.filter((profile) => !importedIds.has(profile.id)),
  ]);
  return {
    imported: importedProfiles.length,
    skipped,
    profiles: importedProfiles,
    warnings,
  };
}

const mockFileStorageKey = "shellpro.preview.files";
const mockFileContentStorageKey = "shellpro.preview.fileContents";

function defaultMockFiles(): WorkspaceFileEntry[] {
  return [
    {
      name: "README.md",
      path: "/preview/README.md",
      relativePath: "README.md",
      parentPath: "/preview",
      kind: "file",
      size: 1409,
      modifiedAt: now(),
    },
    {
      name: "src",
      path: "/preview/src",
      relativePath: "src",
      parentPath: "/preview",
      kind: "directory",
      modifiedAt: now(),
      children: [
        {
          name: "App.tsx",
          path: "/preview/src/App.tsx",
          relativePath: "src/App.tsx",
          parentPath: "/preview/src",
          kind: "file",
          size: 38442,
          modifiedAt: now(),
        },
        {
          name: "api.ts",
          path: "/preview/src/api.ts",
          relativePath: "src/api.ts",
          parentPath: "/preview/src",
          kind: "file",
          size: 8120,
          modifiedAt: now(),
        },
      ],
    },
    {
      name: "docs",
      path: "/preview/docs",
      relativePath: "docs",
      parentPath: "/preview",
      kind: "directory",
      modifiedAt: now(),
      children: [
        {
          name: "shellpro-preview.png",
          path: "/preview/docs/shellpro-preview.png",
          relativePath: "docs/shellpro-preview.png",
          parentPath: "/preview/docs",
          kind: "file",
          size: 182420,
          modifiedAt: now(),
        },
      ],
    },
  ];
}

function mockFiles(): WorkspaceFileEntry[] {
  try {
    const saved = localStorage.getItem(mockFileStorageKey);
    if (saved) {
      return JSON.parse(saved) as WorkspaceFileEntry[];
    }
  } catch {
    // Ignore invalid preview state and recreate it below.
  }
  const files = defaultMockFiles();
  saveMockFiles(files);
  return files;
}

function saveMockFiles(files: WorkspaceFileEntry[]) {
  localStorage.setItem(mockFileStorageKey, JSON.stringify(files));
}

function mockFileContents(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem(mockFileContentStorageKey) ?? "{}",
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveMockFileContents(contents: Record<string, string>) {
  localStorage.setItem(mockFileContentStorageKey, JSON.stringify(contents));
}

function dirname(path: string) {
  if (path === "/preview") {
    return null;
  }
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/preview" : path.slice(0, index);
}

function basename(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function relativePath(path: string) {
  return path.replace(/^\/preview\/?/, "");
}

function normalizeMockParent(path?: string | null) {
  if (!path || path === "/preview") {
    return "/preview";
  }
  return path;
}

function walkMockFiles(
  entries: WorkspaceFileEntry[],
  callback: (entry: WorkspaceFileEntry, siblings: WorkspaceFileEntry[]) => boolean | void,
): WorkspaceFileEntry | null {
  for (const entry of entries) {
    if (callback(entry, entries)) {
      return entry;
    }
    if (entry.children) {
      const found = walkMockFiles(entry.children, callback);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findMockFile(path: string) {
  if (path === "/preview") {
    return null;
  }
  return walkMockFiles(mockFiles(), (entry) => entry.path === path) ?? null;
}

function findMockDirectoryEntries(files: WorkspaceFileEntry[], parentPath: string) {
  if (parentPath === "/preview") {
    return files;
  }
  const directory = walkMockFiles(files, (entry) => entry.path === parentPath);
  if (!directory || directory.kind !== "directory") {
    throw new Error("Folder not found.");
  }
  directory.children ??= [];
  return directory.children;
}

function rewriteMockDescendants(entry: WorkspaceFileEntry) {
  entry.name = basename(entry.path);
  entry.relativePath = relativePath(entry.path);
  entry.parentPath = dirname(entry.path);
  entry.children?.forEach((child) => {
    child.path = `${entry.path}/${child.name}`;
    rewriteMockDescendants(child);
  });
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
        workspaceRoot: "/preview",
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
    case "test_connection": {
      const input = args.input as ConnectionProfileInput;
      return {
        reachable: true,
        latencyMs: 18,
        message: `${input.host}:${input.port} is reachable in browser preview.`,
      } as T;
    }
    case "import_openssh_config":
      return importOpenSshProfilesForPreview(args.content as string) as T;
    case "list_ssh_tunnels":
      return mockTunnels() as T;
    case "start_ssh_tunnel": {
      const input = args.input as SshTunnelInput;
      const profile = mockProfiles().find((item) => item.id === input.profileId);
      if (!profile) {
        throw new Error("Profile not found.");
      }
      if (profile.authType === "password") {
        throw new Error(
          "SSH tunnels currently support SSH agent or private key profiles only.",
        );
      }
      if (!input.localPort || !input.remotePort) {
        throw new Error("Tunnel ports must be between 1 and 65535.");
      }
      if (!["127.0.0.1", "localhost", "::1"].includes(input.localHost.trim())) {
        throw new Error("Only loopback bind addresses are supported for tunnels.");
      }
      const tunnel: SshTunnelSession = {
        id: crypto.randomUUID(),
        profileId: profile.id,
        profileName: profile.name,
        localHost: input.localHost.trim(),
        localPort: input.localPort,
        remoteHost: input.remoteHost.trim(),
        remotePort: input.remotePort,
        status: "running",
        createdAt: now(),
      };
      saveMockTunnels([tunnel, ...mockTunnels()]);
      return tunnel as T;
    }
    case "stop_ssh_tunnel":
      saveMockTunnels(
        mockTunnels().filter((tunnel) => tunnel.id !== args.tunnelId),
      );
      return undefined as T;
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
    case "list_workspace_files":
      return {
        root: "/preview",
        entries: mockFiles(),
      } as T;
    case "preview_workspace_file": {
      const path = String(args.path ?? "");
      const entry = findMockFile(path);
      if (!entry) {
        throw new Error("File not found.");
      }
      return {
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath,
        kind: entry.kind,
        size: entry.size ?? null,
        modifiedAt: entry.modifiedAt ?? null,
        content:
          entry.kind === "directory"
            ? null
            : mockFileContents()[entry.path] ??
              `Preview content for ${entry.relativePath}\n\nThis browser preview mirrors desktop file actions.`,
        truncated: false,
      } as T;
    }
    case "save_workspace_file": {
      const files = mockFiles();
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const entry = walkMockFiles(files, (item) => item.path === path);
      if (!entry || entry.kind !== "file") {
        throw new Error("File not found.");
      }
      const contents = mockFileContents();
      contents[path] = content;
      entry.size = new TextEncoder().encode(content).length;
      entry.modifiedAt = now();
      saveMockFileContents(contents);
      saveMockFiles(files);
      return undefined as T;
    }
    case "create_workspace_file": {
      const files = mockFiles();
      const parentPath = normalizeMockParent(args.parentPath as string | undefined);
      const siblings = findMockDirectoryEntries(files, parentPath);
      const name = String(args.name ?? "").trim();
      const kind = args.kind as WorkspaceFileEntry["kind"];
      if (!name) {
        throw new Error("Name is required.");
      }
      const path = `${parentPath}/${name}`;
      if (siblings.some((entry) => entry.path === path)) {
        throw new Error("A file or folder with that name already exists.");
      }
      siblings.push({
        name,
        path,
        relativePath: relativePath(path),
        parentPath,
        kind,
        size: kind === "file" ? 0 : null,
        modifiedAt: now(),
        children: kind === "directory" ? [] : undefined,
      });
      saveMockFiles(files);
      return undefined as T;
    }
    case "delete_workspace_file": {
      const files = mockFiles();
      const path = String(args.path ?? "");
      walkMockFiles(files, (entry, siblings) => {
        if (entry.path === path) {
          siblings.splice(siblings.indexOf(entry), 1);
          return true;
        }
        return false;
      });
      saveMockFiles(files);
      return undefined as T;
    }
    case "rename_workspace_file": {
      const files = mockFiles();
      const path = String(args.path ?? "");
      const newName = String(args.newName ?? "").trim();
      const entry = walkMockFiles(files, (item) => item.path === path);
      if (!entry || !newName) {
        throw new Error("File not found.");
      }
      const parentPath = dirname(path) ?? "/preview";
      entry.name = newName;
      entry.path = `${parentPath}/${newName}`;
      rewriteMockDescendants(entry);
      saveMockFiles(files);
      return entry as T;
    }
    case "upload_workspace_files": {
      const files = mockFiles();
      const parentPath = normalizeMockParent(args.parentPath as string | undefined);
      const siblings = findMockDirectoryEntries(files, parentPath);
      const paths = (args.paths as string[] | undefined) ?? [];
      paths.forEach((sourcePath) => {
        const name = basename(sourcePath);
        const path = `${parentPath}/${name}`;
        siblings.push({
          name,
          path,
          relativePath: relativePath(path),
          parentPath,
          kind: "file",
          size: 0,
          modifiedAt: now(),
        });
      });
      saveMockFiles(files);
      return undefined as T;
    }
    case "write_workspace_file": {
      const files = mockFiles();
      const parentPath = normalizeMockParent(args.parentPath as string | undefined);
      const siblings = findMockDirectoryEntries(files, parentPath);
      const name = String(args.name ?? "").trim();
      if (!name) {
        throw new Error("File name is required.");
      }
      const path = `${parentPath}/${name}`;
      const bytes = (args.bytes as number[] | undefined) ?? [];
      const existing = siblings.find((entry) => entry.path === path);
      if (existing) {
        existing.kind = "file";
        existing.size = bytes.length;
        existing.modifiedAt = now();
        existing.children = undefined;
      } else {
        siblings.push({
          name,
          path,
          relativePath: relativePath(path),
          parentPath,
          kind: "file",
          size: bytes.length,
          modifiedAt: now(),
        });
      }
      try {
        const contents = mockFileContents();
        contents[path] = new TextDecoder().decode(new Uint8Array(bytes));
        saveMockFileContents(contents);
      } catch {
        // Binary preview content remains unavailable.
      }
      saveMockFiles(files);
      return undefined as T;
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

  listWorkspaceFiles: (sessionId?: string | null) =>
    call<WorkspaceFileTree>("list_workspace_files", { sessionId }),

  previewWorkspaceFile: (path: string, sessionId?: string | null) =>
    call<WorkspaceFilePreview>("preview_workspace_file", { path, sessionId }),

  saveWorkspaceFile: (
    path: string,
    content: string,
    sessionId?: string | null,
  ) => call<void>("save_workspace_file", { path, content, sessionId }),

  createWorkspaceFile: (
    parentPath: string | null,
    name: string,
    kind: WorkspaceFileEntry["kind"],
  ) =>
    call<void>("create_workspace_file", {
      parentPath,
      name,
      kind,
    }),

  deleteWorkspaceFile: (path: string) =>
    call<void>("delete_workspace_file", { path }),

  renameWorkspaceFile: (path: string, newName: string) =>
    call<WorkspaceFileEntry>("rename_workspace_file", { path, newName }),

  uploadWorkspaceFiles: (parentPath: string | null, paths: string[]) =>
    call<void>("upload_workspace_files", { parentPath, paths }),

  writeWorkspaceFile: (parentPath: string | null, name: string, bytes: number[]) =>
    call<void>("write_workspace_file", { parentPath, name, bytes }),

  saveProfile: (input: ConnectionProfileInput) =>
    call<ConnectionProfile>("save_profile", { input }),

  deleteProfile: (id: string) => call<void>("delete_profile", { id }),

  testConnection: (input: ConnectionProfileInput) =>
    call<ConnectionTestResult>("test_connection", { input }),

  importOpenSshConfig: (content: string) =>
    call<ImportProfilesResult>("import_openssh_config", { content }),

  listSshTunnels: () => call<SshTunnelSession[]>("list_ssh_tunnels"),

  startSshTunnel: (input: SshTunnelInput) =>
    call<SshTunnelSession>("start_ssh_tunnel", { input }),

  stopSshTunnel: (tunnelId: string) =>
    call<void>("stop_ssh_tunnel", { tunnelId }),

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
