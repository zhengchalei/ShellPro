import type {
  ConnectionProfile,
  SshTunnelInput,
  WorkspaceFileEntry,
} from "./types";

export type ViewMode = "workspace" | "connections" | "settings";
export type TerminalLayout = "single" | "split" | "grid";
export type SuggestionState = "idle" | "loading" | "empty" | "ready";

export type QuickCommandTemplate = {
  id: string;
  titleKey?: string;
  title?: string;
  command: string;
  explanationKey?: string;
  explanation?: string;
  builtin?: boolean;
};

export type RecentConnection = {
  profileId: string;
  name: string;
  endpoint: string;
  connectedAt: string;
  count: number;
};

export type ProfileFilters = {
  group: string;
  tag: string;
  authType: "" | ConnectionProfile["authType"];
  favoritesOnly: boolean;
};

export type TunnelDraft = SshTunnelInput;

export type FileContextMenuState = {
  x: number;
  y: number;
  entry: WorkspaceFileEntry | null;
  parentPath: string | null;
} | null;
