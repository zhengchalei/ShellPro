export type AuthType = "password" | "privateKey" | "agent";
export type SessionKind = "local" | "ssh";
export type SessionStatus = "connecting" | "connected" | "disconnected" | "error";
export type SshTunnelStatus = "starting" | "running" | "stopped";
export type RiskLevel = "low" | "medium" | "high";
export type ContextMode = "selected" | "recentLines" | "fullBuffer";
export type WorkspaceFileKind = "file" | "directory";
export type TerminalTheme = "system" | "dark" | "light";

export type TerminalPreferences = {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  theme: TerminalTheme;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  groupId?: string | null;
  tags: string[];
  jumpHostId?: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionProfileInput = Omit<
  ConnectionProfile,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type ConnectionTestResult = {
  reachable: boolean;
  latencyMs?: number | null;
  message: string;
};

export type ImportProfilesResult = {
  imported: number;
  skipped: number;
  profiles: ConnectionProfile[];
  warnings: string[];
};

export type SshTunnelInput = {
  profileId: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
};

export type SshTunnelSession = {
  id: string;
  profileId: string;
  profileName: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: SshTunnelStatus;
  createdAt: string;
};

export type TerminalSession = {
  id: string;
  profileId?: string | null;
  kind: SessionKind;
  title: string;
  status: SessionStatus;
  cwd?: string | null;
  shell?: string | null;
  createdAt: string;
};

export type AiProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeySecretRef: string;
  contextMode: ContextMode;
  recentLineLimit: number;
  redactSecrets: boolean;
};

export type AiProviderInput = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  contextMode: ContextMode;
  recentLineLimit: number;
  redactSecrets: boolean;
};

export type AiCommandSuggestion = {
  id: string;
  command: string;
  explanation: string;
  riskLevel: RiskLevel;
  expectedOutcome: string;
  destructive: boolean;
  requiresSudo: boolean;
  modifiesFiles: boolean;
  needsConfirmation: boolean;
};

export type CommandQueueItem = {
  id: string;
  sessionId: string;
  command: string;
  explanation: string;
  riskLevel: RiskLevel;
  source: "ai" | "snippet" | "manual";
  status: "pending" | "sent" | "cancelled";
  createdAt: string;
};

export type RedactionPreview = {
  originalChars: number;
  redactedChars: number;
  content: string;
};

export type WorkspaceFileEntry = {
  name: string;
  path: string;
  relativePath: string;
  parentPath?: string | null;
  kind: WorkspaceFileKind;
  size?: number | null;
  modifiedAt?: string | null;
  children?: WorkspaceFileEntry[];
};

export type WorkspaceFilePreview = {
  name: string;
  path: string;
  relativePath: string;
  kind: WorkspaceFileKind;
  size?: number | null;
  modifiedAt?: string | null;
  content?: string | null;
  truncated: boolean;
};

export type WorkspaceFileTree = {
  root: string;
  entries: WorkspaceFileEntry[];
};

export type AppBootstrap = {
  profiles: ConnectionProfile[];
  aiConfig: AiProviderConfig;
  shell: string;
  cwd: string;
  os: string;
  workspaceRoot: string;
};

export type TerminalEvent =
  | {
      sessionId: string;
      event: "data";
      payload: { data: string };
    }
  | {
      sessionId: string;
      event: "exit";
      payload: Record<string, never>;
    }
  | {
      sessionId: string;
      event: "error";
      payload: { message: string };
    };
