import type {
  ConnectionProfile,
  ConnectionProfileInput,
  TerminalPreferences,
  TerminalTheme,
} from "./types";
import type {
  QuickCommandTemplate,
  RecentConnection,
  TunnelDraft,
} from "./appTypes";

const recentConnectionsStorageKey = "shellpro.recentConnections";
const terminalPreferencesStorageKey = "shellpro.terminalPreferences";
const quickCommandsStorageKey = "shellpro.quickCommands";

export const defaultTerminalPreferences: TerminalPreferences = {
  fontFamily:
    "'SF Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
  scrollback: 5000,
  theme: "system",
};

export const terminalFontOptions = [
  {
    label: "SF Mono / JetBrains Mono / Menlo",
    value: "'SF Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: "Cascadia Mono / Consolas",
    value: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  },
  {
    label: "Fira Code / Consolas",
    value: "'Fira Code', Consolas, 'Courier New', monospace",
  },
];

export const quickCommandTemplates: QuickCommandTemplate[] = [
  {
    id: "whoami",
    titleKey: "quick.identity",
    command: "whoami && hostname",
    explanationKey: "quick.identityHelp",
    builtin: true,
  },
  {
    id: "pwd",
    titleKey: "quick.currentDir",
    command: "pwd && ls -la",
    explanationKey: "quick.currentDirHelp",
    builtin: true,
  },
  {
    id: "disk",
    titleKey: "quick.disk",
    command: "df -h",
    explanationKey: "quick.diskHelp",
    builtin: true,
  },
  {
    id: "memory",
    titleKey: "quick.memory",
    command: "free -h",
    explanationKey: "quick.memoryHelp",
    builtin: true,
  },
  {
    id: "process",
    titleKey: "quick.process",
    command: "ps aux --sort=-%mem | head",
    explanationKey: "quick.processHelp",
    builtin: true,
  },
  {
    id: "service",
    titleKey: "quick.service",
    command: "systemctl status",
    explanationKey: "quick.serviceHelp",
    builtin: true,
  },
];

const emptyProfile: ConnectionProfileInput = {
  name: "",
  host: "",
  port: 22,
  username: "",
  authType: "agent",
  privateKeyPath: "",
  groupId: "Production",
  tags: [],
  jumpHostId: "",
  favorite: false,
};

export function createEmptyProfile(): ConnectionProfileInput {
  return {
    ...emptyProfile,
    tags: [],
  };
}

export function createTunnelDraft(profileId = ""): TunnelDraft {
  return {
    profileId,
    localHost: "127.0.0.1",
    localPort: 15432,
    remoteHost: "127.0.0.1",
    remotePort: 5432,
  };
}

export function compactBuffer(buffer: string, limit = 24000) {
  if (buffer.length <= limit) {
    return buffer;
  }
  return buffer.slice(buffer.length - limit);
}

export function tagsToText(tags: string[]) {
  return tags.join(", ");
}

export function textToTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function readTerminalPreferences(): TerminalPreferences {
  if (typeof localStorage === "undefined") {
    return defaultTerminalPreferences;
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(terminalPreferencesStorageKey) ?? "{}",
    ) as Partial<TerminalPreferences>;
    const theme: TerminalTheme =
      parsed.theme === "dark" ||
      parsed.theme === "light" ||
      parsed.theme === "system"
        ? parsed.theme
        : defaultTerminalPreferences.theme;
    return {
      fontFamily:
        typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
          ? parsed.fontFamily
          : defaultTerminalPreferences.fontFamily,
      fontSize: clampNumber(
        Number(parsed.fontSize),
        10,
        22,
        defaultTerminalPreferences.fontSize,
      ),
      scrollback: clampNumber(
        Number(parsed.scrollback),
        1000,
        50000,
        defaultTerminalPreferences.scrollback,
      ),
      theme,
    };
  } catch {
    return defaultTerminalPreferences;
  }
}

export function saveTerminalPreferences(preferences: TerminalPreferences) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    terminalPreferencesStorageKey,
    JSON.stringify(preferences),
  );
}

export function readCustomQuickCommands(): QuickCommandTemplate[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(quickCommandsStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is QuickCommandTemplate =>
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.command === "string",
      )
      .map((item) => ({
        id: item.id,
        title: item.title?.trim() || item.command,
        command: item.command.trim(),
        explanation: item.explanation?.trim() || "",
        builtin: false,
      }))
      .filter((item) => item.command)
      .slice(0, 24);
  } catch {
    return [];
  }
}

export function saveCustomQuickCommands(commands: QuickCommandTemplate[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    quickCommandsStorageKey,
    JSON.stringify(commands.filter((command) => !command.builtin).slice(0, 24)),
  );
}

export function readRecentConnections(): RecentConnection[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(recentConnectionsStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is RecentConnection =>
          typeof item === "object" &&
          item !== null &&
          typeof item.profileId === "string" &&
          typeof item.name === "string" &&
          typeof item.endpoint === "string" &&
          typeof item.connectedAt === "string" &&
          typeof item.count === "number",
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function saveRecentConnections(connections: RecentConnection[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    recentConnectionsStorageKey,
    JSON.stringify(connections.slice(0, 8)),
  );
}

export function updateRecentConnections(
  current: RecentConnection[],
  profile: ConnectionProfile,
) {
  const existing = current.find((item) => item.profileId === profile.id);
  const next: RecentConnection = {
    profileId: profile.id,
    name: profile.name,
    endpoint: `${profile.username}@${profile.host}:${profile.port}`,
    connectedAt: new Date().toISOString(),
    count: (existing?.count ?? 0) + 1,
  };
  return [
    next,
    ...current.filter((item) => item.profileId !== profile.id),
  ].slice(0, 8);
}

export function authTypeLabel(
  authType: ConnectionProfile["authType"],
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  const labels: Record<ConnectionProfile["authType"], string> = {
    agent: t("profile.authAgent"),
    privateKey: t("profile.authPrivateKey"),
    password: t("profile.authPassword"),
  };
  return labels[authType];
}
