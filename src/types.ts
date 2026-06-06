export type AuthType = "password" | "privateKey" | "agent";
export type SessionKind = "local" | "ssh";
export type SessionStatus = "connecting" | "connected" | "disconnected" | "error";
export type RiskLevel = "low" | "medium" | "high";
export type ContextMode = "selected" | "recentLines" | "fullBuffer";

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

export type AppBootstrap = {
  profiles: ConnectionProfile[];
  aiConfig: AiProviderConfig;
  shell: string;
  cwd: string;
  os: string;
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
