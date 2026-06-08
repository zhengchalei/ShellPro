import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  FileKey2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Gauge,
  Laptop,
  PanelRight,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Shuffle,
  ShieldAlert,
  ShieldCheck,
  SplitSquareHorizontal,
  Star,
  TerminalSquare,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shellProApi } from "./api";
import "./App.css";
import { Locale, useI18n } from "./i18n";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import type {
  AiCommandSuggestion,
  AiProviderConfig,
  CommandQueueItem,
  ConnectionProfile,
  ConnectionProfileInput,
  ContextMode,
  RiskLevel,
  SshTunnelInput,
  SshTunnelSession,
  TerminalPreferences,
  TerminalSession,
  TerminalTheme,
  WorkspaceFileEntry,
  WorkspaceFileKind,
  WorkspaceFilePreview,
} from "./types";

type ViewMode = "workspace" | "connections" | "settings";
type TerminalLayout = "single" | "split" | "grid";
type SuggestionState = "idle" | "loading" | "empty" | "ready";
type QuickCommandTemplate = {
  id: string;
  titleKey?: string;
  title?: string;
  command: string;
  explanationKey?: string;
  explanation?: string;
  builtin?: boolean;
};
type RecentConnection = {
  profileId: string;
  name: string;
  endpoint: string;
  connectedAt: string;
  count: number;
};
type ProfileFilters = {
  group: string;
  tag: string;
  authType: "" | ConnectionProfile["authType"];
  favoritesOnly: boolean;
};
type TunnelDraft = SshTunnelInput;
type FileContextMenuState = {
  x: number;
  y: number;
  entry: WorkspaceFileEntry | null;
  parentPath: string | null;
} | null;

const recentConnectionsStorageKey = "shellpro.recentConnections";
const terminalPreferencesStorageKey = "shellpro.terminalPreferences";
const quickCommandsStorageKey = "shellpro.quickCommands";

const defaultTerminalPreferences: TerminalPreferences = {
  fontFamily:
    "'SF Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
  scrollback: 5000,
  theme: "system",
};

const terminalFontOptions = [
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

const quickCommandTemplates: QuickCommandTemplate[] = [
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

function createEmptyProfile(): ConnectionProfileInput {
  return {
    ...emptyProfile,
    tags: [],
  };
}

function createTunnelDraft(profileId = ""): TunnelDraft {
  return {
    profileId,
    localHost: "127.0.0.1",
    localPort: 15432,
    remoteHost: "127.0.0.1",
    remotePort: 5432,
  };
}

function compactBuffer(buffer: string, limit = 24000) {
  if (buffer.length <= limit) {
    return buffer;
  }
  return buffer.slice(buffer.length - limit);
}

function tagsToText(tags: string[]) {
  return tags.join(", ");
}

function textToTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function readTerminalPreferences(): TerminalPreferences {
  if (typeof localStorage === "undefined") {
    return defaultTerminalPreferences;
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(terminalPreferencesStorageKey) ?? "{}",
    ) as Partial<TerminalPreferences>;
    const theme: TerminalTheme =
      parsed.theme === "dark" || parsed.theme === "light" || parsed.theme === "system"
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

function saveTerminalPreferences(preferences: TerminalPreferences) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    terminalPreferencesStorageKey,
    JSON.stringify(preferences),
  );
}

function readCustomQuickCommands(): QuickCommandTemplate[] {
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

function saveCustomQuickCommands(commands: QuickCommandTemplate[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    quickCommandsStorageKey,
    JSON.stringify(commands.filter((command) => !command.builtin).slice(0, 24)),
  );
}

function readRecentConnections(): RecentConnection[] {
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

function saveRecentConnections(connections: RecentConnection[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(
    recentConnectionsStorageKey,
    JSON.stringify(connections.slice(0, 8)),
  );
}

function updateRecentConnections(
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

function flattenFileEntries(entries: WorkspaceFileEntry[]) {
  const output: WorkspaceFileEntry[] = [];

  const visit = (entry: WorkspaceFileEntry) => {
    output.push(entry);
    entry.children?.forEach(visit);
  };

  entries.forEach(visit);
  return output;
}

function formatFileSize(size?: number | null) {
  if (size === null || size === undefined) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatFileDate(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

function parentForFileAction(entry: WorkspaceFileEntry | null, fallback: string | null) {
  if (!entry) {
    return fallback;
  }
  return entry.kind === "directory" ? entry.path : entry.parentPath ?? fallback;
}

async function filesToUploads(
  parentPath: string | null,
  files: File[],
  onStatus: (message: string) => void,
) {
  const paths = files
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));

  if (paths.length === files.length && paths.length > 0) {
    await shellProApi.uploadWorkspaceFiles(parentPath, paths);
    return;
  }

  for (const file of files) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await shellProApi.writeWorkspaceFile(parentPath, file.name, bytes);
    onStatus(`${file.name} uploaded`);
  }
}

function authTypeLabel(
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

function App() {
  const { locale, setLocale, t } = useI18n();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>(
    {},
  );
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [fileEntries, setFileEntries] = useState<WorkspaceFileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<WorkspaceFilePreview | null>(null);
  const [expandedDirPaths, setExpandedDirPaths] = useState<Record<string, boolean>>(
    {},
  );
  const [fileContextMenu, setFileContextMenu] =
    useState<FileContextMenuState>(null);
  const [fileDropTarget, setFileDropTarget] = useState<string | null>(null);
  const [pendingUploadParent, setPendingUploadParent] = useState<string | null>(null);
  const [isFileBusy, setIsFileBusy] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  const [terminalLayout, setTerminalLayout] =
    useState<TerminalLayout>("single");
  const [terminalPreferences, setTerminalPreferences] =
    useState<TerminalPreferences>(readTerminalPreferences);
  const [customQuickCommands, setCustomQuickCommands] =
    useState<QuickCommandTemplate[]>(readCustomQuickCommands);
  const [quickCommandDraft, setQuickCommandDraft] = useState({
    title: "",
    command: "",
    explanation: "",
  });
  const [recentConnections, setRecentConnections] =
    useState<RecentConnection[]>(readRecentConnections);
  const [profileDraft, setProfileDraft] =
    useState<ConnectionProfileInput>(createEmptyProfile);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [profileFilters, setProfileFilters] = useState<ProfileFilters>({
    group: "",
    tag: "",
    authType: "",
    favoritesOnly: false,
  });
  const [testingProfileIds, setTestingProfileIds] = useState<Record<string, boolean>>(
    {},
  );
  const [isTestingProfileDraft, setIsTestingProfileDraft] = useState(false);
  const [tunnels, setTunnels] = useState<SshTunnelSession[]>([]);
  const [tunnelDraft, setTunnelDraft] = useState<TunnelDraft>(createTunnelDraft);
  const [isTunnelDialogOpen, setIsTunnelDialogOpen] = useState(false);
  const [isStartingTunnel, setIsStartingTunnel] = useState(false);
  const [stoppingTunnelIds, setStoppingTunnelIds] = useState<Record<string, boolean>>(
    {},
  );
  const [aiQuestion, setAiQuestion] = useState("");
  const [suggestionsBySessionId, setSuggestionsBySessionId] = useState<
    Record<string, AiCommandSuggestion[]>
  >({});
  const [suggestionStatesBySessionId, setSuggestionStatesBySessionId] = useState<
    Record<string, SuggestionState>
  >({});
  const [queue, setQueue] = useState<CommandQueueItem[]>([]);
  const [contextPreview, setContextPreview] = useState("");
  const [selectedContextMode, setSelectedContextMode] = useState<
    "recent" | "selected"
  >("recent");
  const [manualSelection, setManualSelection] = useState("");
  const [statusMessage, setStatusMessage] = useState(t("app.ready"));
  const [busySessionIds, setBusySessionIds] = useState<Record<string, boolean>>(
    {},
  );
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [isTerminalSearchVisible, setIsTerminalSearchVisible] = useState(false);
  const [isTerminalToolsVisible, setIsTerminalToolsVisible] = useState(false);
  const [terminalSearchText, setTerminalSearchText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const contextPreviewRef = useRef<HTMLPreElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const importConfigInputRef = useRef<HTMLInputElement | null>(null);
  const terminalHandlesRef = useRef<Record<string, TerminalPaneHandle | null>>(
    {},
  );
  const aiRequestTokensRef = useRef<Record<string, number>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const [aiDraft, setAiDraft] = useState<{
    name: string;
    baseUrl: string;
    model: string;
    contextMode: ContextMode;
    recentLineLimit: number;
    redactSecrets: boolean;
  }>({
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    contextMode: "recentLines",
    recentLineLimit: 200,
    redactSecrets: true,
  });

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeBuffer = activeSessionId ? terminalBuffers[activeSessionId] ?? "" : "";
  const activeSuggestions = activeSessionId
    ? suggestionsBySessionId[activeSessionId] ?? []
    : [];
  const activeSuggestionState = activeSessionId
    ? suggestionStatesBySessionId[activeSessionId] ?? "idle"
    : "idle";
  const activeQueue = activeSessionId
    ? queue.filter((item) => item.sessionId === activeSessionId)
    : [];
  const quickCommands = useMemo(
    () => [...quickCommandTemplates, ...customQuickCommands],
    [customQuickCommands],
  );
  const isAiBusy = activeSessionId ? busySessionIds[activeSessionId] ?? false : false;
  const activeSessionLabel = activeSession
    ? `${activeSession.title} · ${t(`session.${activeSession.status}`)}`
    : t("app.noActiveSession");
  const allFileEntries = useMemo(
    () => flattenFileEntries(fileEntries),
    [fileEntries],
  );
  const profileGroups = useMemo(
    () =>
      Array.from(
        profiles.reduce((set, profile) => {
          if (profile.groupId) {
            set.add(profile.groupId);
          }
          return set;
        }, new Set<string>()),
      ).sort(),
    [profiles],
  );
  const profileTags = useMemo(
    () =>
      Array.from(
        profiles.reduce((set, profile) => {
          profile.tags.forEach((tag) => set.add(tag));
          return set;
        }, new Set<string>()),
      ).sort(),
    [profiles],
  );
  const filteredProfiles = profiles.filter((profile) => {
    const needle = searchText.trim().toLowerCase();
    const matchesSearch =
      !needle ||
      [
        profile.name,
        profile.host,
        profile.username,
        profile.groupId ?? "",
        ...profile.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    return (
      matchesSearch &&
      (!profileFilters.group || profile.groupId === profileFilters.group) &&
      (!profileFilters.tag || profile.tags.includes(profileFilters.tag)) &&
      (!profileFilters.authType || profile.authType === profileFilters.authType) &&
      (!profileFilters.favoritesOnly || profile.favorite)
    );
  });
  const favoriteProfiles = profiles.filter((profile) => profile.favorite);
  const activeTunnels = tunnels.filter((tunnel) => tunnel.status === "running");
  const activeTunnelCount = activeTunnels.length;
  const tunnelProfile = profiles.find((profile) => profile.id === tunnelDraft.profileId);
  const tunnelProfileUnsupported = tunnelProfile?.authType === "password";
  const recentProfiles = recentConnections
    .map((recent) => ({
      recent,
      profile: profiles.find((profile) => profile.id === recent.profileId),
    }))
    .filter(
      (item): item is { recent: RecentConnection; profile: ConnectionProfile } =>
        Boolean(item.profile),
    );
  const connectedSessions = sessions.filter(
    (session) => session.status === "connected",
  );
  const activeSshSessionCount = connectedSessions.filter(
    (session) => session.kind === "ssh",
  ).length;
  const visiblePaneLimit =
    terminalLayout === "grid" ? 4 : terminalLayout === "split" ? 2 : 1;
  const visibleTerminalSessions = useMemo(() => {
    if (!activeSessionId) {
      return sessions.slice(0, visiblePaneLimit);
    }
    const active = sessions.find((session) => session.id === activeSessionId);
    const others = sessions.filter((session) => session.id !== activeSessionId);
    return [...(active ? [active] : []), ...others].slice(0, visiblePaneLimit);
  }, [activeSessionId, sessions, visiblePaneLimit]);
  const visibleSessionIds = useMemo(
    () => new Set(visibleTerminalSessions.map((session) => session.id)),
    [visibleTerminalSessions],
  );
  const groups = profileGroups;
  const riskLabel: Record<RiskLevel, string> = {
    low: t("risk.low"),
    medium: t("risk.medium"),
    high: t("risk.high"),
  };

  const refreshBootstrap = useCallback(async () => {
    try {
      const bootstrap = await shellProApi.bootstrap();
      setProfiles(bootstrap.profiles);
      setAiConfig(bootstrap.aiConfig);
      setWorkspaceRoot(bootstrap.workspaceRoot || bootstrap.cwd);
      setAiDraft({
        name: bootstrap.aiConfig.name,
        baseUrl: bootstrap.aiConfig.baseUrl,
        model: bootstrap.aiConfig.model,
        contextMode: bootstrap.aiConfig.contextMode,
        recentLineLimit: bootstrap.aiConfig.recentLineLimit,
        redactSecrets: bootstrap.aiConfig.redactSecrets,
      });
      setStatusMessage(`${bootstrap.os} · ${bootstrap.shell}`);
    } catch (error) {
      setStatusMessage(String(error));
    }
  }, []);

  const refreshFileTree = useCallback(async () => {
    try {
      const tree = await shellProApi.listWorkspaceFiles();
      setWorkspaceRoot(tree.root);
      setFileEntries(tree.entries);
      setExpandedDirPaths((current) => {
        if (Object.keys(current).length > 0) {
          return current;
        }
        return tree.entries.reduce<Record<string, boolean>>((next, entry) => {
          if (entry.kind === "directory") {
            next[entry.path] = true;
          }
          return next;
        }, {});
      });
    } catch (error) {
      setStatusMessage(String(error));
    }
  }, []);

  const refreshTunnels = useCallback(async () => {
    try {
      const result = await shellProApi.listSshTunnels();
      setTunnels(result);
    } catch (error) {
      setStatusMessage(String(error));
    }
  }, []);

  useEffect(() => {
    void refreshBootstrap();
    void refreshFileTree();
    void refreshTunnels();
  }, [refreshBootstrap, refreshFileTree, refreshTunnels]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId) {
      return;
    }
    setIsTerminalSearchVisible(false);
    setIsTerminalToolsVisible(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeBuffer) {
      setContextPreview("");
      return;
    }

    const source =
      selectedContextMode === "selected" && manualSelection.trim()
        ? manualSelection
        : activeBuffer;
    const recentLines = source.split(/\r?\n/).slice(-200).join("\n");
    void shellProApi
      .previewAiContext(recentLines)
      .then((preview) => setContextPreview(preview.content))
      .catch(() => setContextPreview(recentLines));
  }, [activeBuffer, manualSelection, selectedContextMode]);

  useEffect(() => {
    const preview = contextPreviewRef.current;
    if (!preview) {
      return;
    }
    preview.scrollTop = preview.scrollHeight;
  }, [contextPreview, isInspectorVisible]);

  useEffect(() => {
    if (!isProfileDialogOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeProfileDialog();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isProfileDialogOpen]);

  useEffect(() => {
    if (!selectedFilePath) {
      setFilePreview(null);
      return;
    }

    const entry = allFileEntries.find((item) => item.path === selectedFilePath);
    if (!entry) {
      setSelectedFilePath(null);
      setFilePreview(null);
      return;
    }

    let cancelled = false;
    void shellProApi
      .previewWorkspaceFile(entry.path)
      .then((preview) => {
        if (!cancelled) {
          setFilePreview(preview);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [allFileEntries, selectedFilePath]);

  useEffect(() => {
    if (!fileContextMenu) {
      return;
    }

    const closeMenu = () => setFileContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fileContextMenu]);

  const updateSessionStatus = useCallback(
    (sessionId: string, status: TerminalSession["status"]) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, status } : session,
        ),
      );
    },
    [],
  );

  const appendBuffer = useCallback((sessionId: string, data: string) => {
    setTerminalBuffers((current) => ({
      ...current,
      [sessionId]: compactBuffer(`${current[sessionId] ?? ""}${data}`),
    }));
  }, []);

  function activeTerminalHandle() {
    return activeSessionId ? terminalHandlesRef.current[activeSessionId] : null;
  }

  async function writeToActiveTerminal(data: string) {
    if (!activeSessionId) {
      setStatusMessage(t("app.openTerminalFirst"));
      return false;
    }

    try {
      const handle = activeTerminalHandle();
      if (handle) {
        await handle.writeInput(data);
      } else {
        await shellProApi.writeToSession(activeSessionId, data);
      }
      return true;
    } catch (error) {
      setStatusMessage(String(error));
      return false;
    }
  }

  function searchActiveTerminal(direction: "next" | "previous") {
    const term = terminalSearchText.trim();
    if (!term) {
      setStatusMessage(t("terminal.searchRequired"));
      return;
    }
    const handle = activeTerminalHandle();
    if (!handle) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }
    const found =
      direction === "next" ? handle.findNext(term) : handle.findPrevious(term);
    setStatusMessage(found ? t("terminal.searchFound") : t("terminal.searchNoMatch"));
    handle.focus();
  }

  async function copyTerminalSelection() {
    const selection = activeTerminalHandle()?.getSelection() ?? "";
    if (!selection) {
      setStatusMessage(t("terminal.noSelection"));
      return;
    }
    await navigator.clipboard.writeText(selection);
    setStatusMessage(t("terminal.selectionCopied"));
  }

  async function pasteClipboardIntoTerminal() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setStatusMessage(t("terminal.clipboardEmpty"));
        return;
      }
      if (await writeToActiveTerminal(text)) {
        setStatusMessage(t("terminal.pasted"));
      }
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  function clearActiveTerminal() {
    const handle = activeTerminalHandle();
    if (!handle) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }
    handle.clear();
    handle.focus();
    setStatusMessage(t("terminal.cleared"));
  }

  function useTerminalSelectionForAi() {
    const selection = activeTerminalHandle()?.getSelection() ?? "";
    if (!selection.trim()) {
      setStatusMessage(t("terminal.noSelection"));
      return;
    }
    setManualSelection(selection);
    setSelectedContextMode("selected");
    setIsInspectorVisible(true);
    setStatusMessage(t("terminal.selectionSentToAi"));
  }

  async function startLocalSession() {
    try {
      const session = await shellProApi.startLocalSession();
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      if (session.shell === "mock") {
        setTerminalBuffers((current) => ({
          ...current,
          [session.id]: "ShellPro browser preview\n$ ",
        }));
      }
      setViewMode("workspace");
      setStatusMessage(t("app.localTerminalStarted"));
      return session;
    } catch (error) {
      setStatusMessage(String(error));
      return null;
    }
  }

  async function startSshSession(profileId: string) {
    try {
      const profile = profiles.find((item) => item.id === profileId);
      const session = await shellProApi.startSshSession(profileId);
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      setViewMode("workspace");
      if (profile) {
        setRecentConnections((current) => {
          const next = updateRecentConnections(current, profile);
          saveRecentConnections(next);
          return next;
        });
      }
      setStatusMessage(t("app.sshStarted", { title: session.title }));
      return session;
    } catch (error) {
      setStatusMessage(String(error));
      return null;
    }
  }

  async function reconnectActiveSession() {
    if (!activeSession) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }

    if (activeSession.kind === "ssh") {
      if (!activeSession.profileId) {
        setStatusMessage(t("app.reconnectUnavailable"));
        return;
      }
      const session = await startSshSession(activeSession.profileId);
      if (session) {
        setStatusMessage(t("app.reconnected", { title: activeSession.title }));
      }
      return;
    }

    const session = await startLocalSession();
    if (session) {
      setStatusMessage(t("app.reconnected", { title: activeSession.title }));
    }
  }

  async function closeSession(sessionId: string) {
    await shellProApi.closeSession(sessionId).catch((error) => {
      setStatusMessage(String(error));
    });
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    setTerminalBuffers((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSuggestionsBySessionId((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setSuggestionStatesBySessionId((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setQueue((current) => current.filter((item) => item.sessionId !== sessionId));
    setBusySessionIds((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    delete terminalHandlesRef.current[sessionId];
    delete aiRequestTokensRef.current[sessionId];
    if (activeSessionId === sessionId) {
      const nextSession = sessions.find((session) => session.id !== sessionId);
      setActiveSessionId(nextSession?.id ?? null);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await shellProApi.saveProfile(profileDraft);
      if (secretDraft.trim()) {
        await shellProApi.saveProfileSecret(saved.id, saved.authType, secretDraft);
        setSecretDraft("");
      }
      await refreshBootstrap();
      setProfileDraft(createEmptyProfile());
      setIsProfileDialogOpen(false);
      setStatusMessage(t("app.connectionSaved", { name: saved.name }));
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  function openCreateProfile() {
    setViewMode("connections");
    setProfileDraft(createEmptyProfile());
    setSecretDraft("");
    setIsProfileDialogOpen(true);
  }

  function editProfile(profile: ConnectionProfile) {
    setViewMode("connections");
    setProfileDraft({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.authType,
      privateKeyPath: profile.privateKeyPath ?? "",
      groupId: profile.groupId ?? "",
      tags: profile.tags,
      jumpHostId: profile.jumpHostId ?? "",
      favorite: profile.favorite,
    });
    setSecretDraft("");
    setIsProfileDialogOpen(true);
  }

  function cloneProfile(profile: ConnectionProfile) {
    setViewMode("connections");
    setProfileDraft({
      name: t("profile.copyName", { name: profile.name }),
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.authType,
      privateKeyPath: profile.privateKeyPath ?? "",
      groupId: profile.groupId ?? "",
      tags: [...profile.tags],
      jumpHostId: profile.jumpHostId ?? "",
      favorite: profile.favorite,
    });
    setSecretDraft("");
    setIsProfileDialogOpen(true);
  }

  function closeProfileDialog() {
    setIsProfileDialogOpen(false);
    setProfileDraft(createEmptyProfile());
    setSecretDraft("");
  }

  async function deleteProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (
      !window.confirm(
        t("app.deleteConfirm", {
          name: profile?.name ?? t("app.thisConnection"),
        }),
      )
    ) {
      return;
    }
    await shellProApi.deleteProfile(profileId);
    setRecentConnections((current) => {
      const next = current.filter((item) => item.profileId !== profileId);
      saveRecentConnections(next);
      return next;
    });
    await refreshBootstrap();
    setStatusMessage(t("app.connectionDeleted"));
  }

  async function testConnectionProfile(profile: ConnectionProfile) {
    setTestingProfileIds((current) => ({ ...current, [profile.id]: true }));
    try {
      const result = await shellProApi.testConnection({
        id: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authType: profile.authType,
        privateKeyPath: profile.privateKeyPath ?? "",
        groupId: profile.groupId ?? "",
        tags: profile.tags,
        jumpHostId: profile.jumpHostId ?? "",
        favorite: profile.favorite,
      });
      setStatusMessage(
        result.reachable
          ? t("connections.testSuccess", {
              name: profile.name,
              latency: result.latencyMs ?? 0,
            })
          : t("connections.testFailed", {
              name: profile.name,
              message: result.message,
            }),
      );
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setTestingProfileIds((current) => {
        const next = { ...current };
        delete next[profile.id];
        return next;
      });
    }
  }

  async function testProfileDraft() {
    setIsTestingProfileDraft(true);
    try {
      const result = await shellProApi.testConnection(profileDraft);
      setStatusMessage(
        result.reachable
          ? t("connections.testDraftSuccess", {
              latency: result.latencyMs ?? 0,
            })
          : t("connections.testDraftFailed", { message: result.message }),
      );
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsTestingProfileDraft(false);
    }
  }

  function openTunnelDialog(profile: ConnectionProfile) {
    setTunnelDraft(createTunnelDraft(profile.id));
    setIsTunnelDialogOpen(true);
  }

  function closeTunnelDialog() {
    setIsTunnelDialogOpen(false);
    setTunnelDraft(createTunnelDraft());
    setIsStartingTunnel(false);
  }

  async function startTunnel(event: FormEvent) {
    event.preventDefault();
    setIsStartingTunnel(true);
    try {
      const tunnel = await shellProApi.startSshTunnel({
        ...tunnelDraft,
        localHost: tunnelDraft.localHost.trim(),
        remoteHost: tunnelDraft.remoteHost.trim(),
        localPort: Number(tunnelDraft.localPort),
        remotePort: Number(tunnelDraft.remotePort),
      });
      setTunnels((current) => [tunnel, ...current]);
      setStatusMessage(
        t("tunnel.started", {
          local: `${tunnel.localHost}:${tunnel.localPort}`,
          remote: `${tunnel.remoteHost}:${tunnel.remotePort}`,
        }),
      );
      setIsTunnelDialogOpen(false);
      setTunnelDraft(createTunnelDraft());
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsStartingTunnel(false);
    }
  }

  async function stopTunnel(tunnelId: string) {
    setStoppingTunnelIds((current) => ({ ...current, [tunnelId]: true }));
    try {
      await shellProApi.stopSshTunnel(tunnelId);
      setTunnels((current) => current.filter((tunnel) => tunnel.id !== tunnelId));
      setStatusMessage(t("tunnel.stopped"));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setStoppingTunnelIds((current) => {
        const next = { ...current };
        delete next[tunnelId];
        return next;
      });
    }
  }

  async function askAi(event: FormEvent) {
    event.preventDefault();
    if (!aiQuestion.trim()) {
      return;
    }
    if (!activeSessionId) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }

    const sessionId = activeSessionId;
    const session = activeSession;
    const buffer = activeBuffer;
    const requestToken = (aiRequestTokensRef.current[sessionId] ?? 0) + 1;
    aiRequestTokensRef.current[sessionId] = requestToken;
    setSuggestionsBySessionId((current) => ({
      ...current,
      [sessionId]: [],
    }));
    setSuggestionStatesBySessionId((current) => ({
      ...current,
      [sessionId]: "loading",
    }));
    setBusySessionIds((current) => ({
      ...current,
      [sessionId]: true,
    }));
    try {
      const context =
        selectedContextMode === "selected" && manualSelection.trim()
          ? manualSelection
          : buffer.split(/\r?\n/).slice(-200).join("\n");
      const result = await shellProApi.askAiForCommands({
        question: aiQuestion,
        context,
        selectedText: manualSelection || undefined,
        os: navigator.platform,
        shell: session?.shell ?? undefined,
        cwd: session?.cwd ?? undefined,
      });
      if (aiRequestTokensRef.current[sessionId] !== requestToken) {
        return;
      }
      setSuggestionsBySessionId((current) => ({
        ...current,
        [sessionId]: result,
      }));
      setSuggestionStatesBySessionId((current) => ({
        ...current,
        [sessionId]: result.length > 0 ? "ready" : "empty",
      }));
      if (activeSessionIdRef.current === sessionId) {
        setStatusMessage(t("app.aiSuggested", { count: result.length }));
      }
    } catch (error) {
      if (
        aiRequestTokensRef.current[sessionId] === requestToken &&
        activeSessionIdRef.current === sessionId
      ) {
        setStatusMessage(String(error));
      }
      if (aiRequestTokensRef.current[sessionId] === requestToken) {
        setSuggestionStatesBySessionId((current) => ({
          ...current,
          [sessionId]: "idle",
        }));
      }
    } finally {
      if (aiRequestTokensRef.current[sessionId] === requestToken) {
        setBusySessionIds((current) => ({
          ...current,
          [sessionId]: false,
        }));
      }
    }
  }

  async function queueSuggestion(suggestion: AiCommandSuggestion) {
    if (!activeSessionId) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }
    const item = await shellProApi.createCommandQueueItem(
      activeSessionId,
      suggestion.command,
      suggestion.explanation,
    );
    setQueue((current) => [item, ...current]);
    setStatusMessage(t("app.commandQueued"));
  }

  async function queueQuickCommand(template: QuickCommandTemplate) {
    if (!activeSessionId) {
      setStatusMessage(t("app.openTerminalFirst"));
      return;
    }

    try {
      const risk = await shellProApi.classifyCommandRisk(template.command);
      const explanation =
        template.explanationKey
          ? t(template.explanationKey)
          : template.explanation || t("quick.customCommand");
      const item: CommandQueueItem = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        command: template.command,
        explanation,
        riskLevel: risk.riskLevel,
        source: "snippet",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      setQueue((current) => [item, ...current]);
      setStatusMessage(t("app.commandQueued"));
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  function updateTerminalPreferences(update: Partial<TerminalPreferences>) {
    setTerminalPreferences((current) => {
      const next: TerminalPreferences = {
        ...current,
        ...update,
        fontSize: clampNumber(
          Number(update.fontSize ?? current.fontSize),
          10,
          22,
          current.fontSize,
        ),
        scrollback: clampNumber(
          Number(update.scrollback ?? current.scrollback),
          1000,
          50000,
          current.scrollback,
        ),
      };
      saveTerminalPreferences(next);
      setStatusMessage(t("settings.terminalSaved"));
      return next;
    });
  }

  function resetTerminalPreferences() {
    setTerminalPreferences(defaultTerminalPreferences);
    saveTerminalPreferences(defaultTerminalPreferences);
    setStatusMessage(t("settings.terminalDefaultsRestored"));
  }

  function addQuickCommand(event: FormEvent) {
    event.preventDefault();
    const title = quickCommandDraft.title.trim();
    const command = quickCommandDraft.command.trim();
    const explanation = quickCommandDraft.explanation.trim();
    if (!title || !command) {
      setStatusMessage(t("quick.required"));
      return;
    }
    setCustomQuickCommands((current) => {
      const next = [
        {
          id: crypto.randomUUID(),
          title,
          command,
          explanation,
          builtin: false,
        },
        ...current,
      ].slice(0, 24);
      saveCustomQuickCommands(next);
      return next;
    });
    setQuickCommandDraft({ title: "", command: "", explanation: "" });
    setStatusMessage(t("quick.saved"));
  }

  function deleteQuickCommand(commandId: string) {
    setCustomQuickCommands((current) => {
      const next = current.filter((command) => command.id !== commandId);
      saveCustomQuickCommands(next);
      return next;
    });
    setStatusMessage(t("quick.deleted"));
  }

  async function executeQueueItem(item: CommandQueueItem) {
    if (item.riskLevel === "high") {
      const confirmed = window.confirm(
        t("app.highRiskConfirm", { command: item.command }),
      );
      if (!confirmed) {
        return;
      }
    }
    try {
      await shellProApi.executeQueuedCommand(
        item.sessionId,
        item.command,
        item.riskLevel === "high",
      );
      setQueue((current) =>
        current.map((queueItem) =>
          queueItem.id === item.id ? { ...queueItem, status: "sent" } : queueItem,
        ),
      );
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  async function fillTerminal(command: string) {
    if (await writeToActiveTerminal(command)) {
      setStatusMessage(t("terminal.filled"));
    }
  }

  function cycleTerminalLayout() {
    setTerminalLayout((current) => {
      const next =
        current === "single" ? "split" : current === "split" ? "grid" : "single";
      setStatusMessage(t(`layout.${next}`));
      return next;
    });
  }

  function changeTerminalLayout(layout: TerminalLayout) {
    setTerminalLayout(layout);
    setStatusMessage(t(`layout.${layout}`));
  }

  async function saveAiSettings(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await shellProApi.saveAiConfig({
        ...aiDraft,
        apiKey: aiKeyDraft || undefined,
      });
      setAiConfig(saved);
      setAiKeyDraft("");
      setStatusMessage(t("app.aiSettingsSaved"));
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  function selectFileEntry(entry: WorkspaceFileEntry) {
    setSelectedFilePath(entry.path);
    if (entry.kind === "directory") {
      setExpandedDirPaths((current) => ({
        ...current,
        [entry.path]: !current[entry.path],
      }));
    }
  }

  function showFileContextMenu(
    event: MouseEvent,
    entry: WorkspaceFileEntry | null,
    parentPath: string | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setFileContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
      parentPath,
    });
  }

  async function createWorkspaceFile(
    target: WorkspaceFileEntry | null,
    kind: WorkspaceFileKind,
  ) {
    const parentPath = parentForFileAction(target, workspaceRoot || null);
    const defaultName = kind === "directory" ? "new-folder" : "new-file.txt";
    const name = window.prompt(t("files.namePrompt"), defaultName)?.trim();
    if (!name) {
      return;
    }

    setIsFileBusy(true);
    try {
      await shellProApi.createWorkspaceFile(parentPath, name, kind);
      if (parentPath) {
        setExpandedDirPaths((current) => ({ ...current, [parentPath]: true }));
      }
      await refreshFileTree();
      setStatusMessage(t("files.created", { name }));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsFileBusy(false);
    }
  }

  async function deleteWorkspaceFile(entry: WorkspaceFileEntry) {
    if (!window.confirm(t("files.deleteConfirm", { name: entry.name }))) {
      return;
    }

    setIsFileBusy(true);
    try {
      await shellProApi.deleteWorkspaceFile(entry.path);
      if (selectedFilePath === entry.path) {
        setSelectedFilePath(null);
        setFilePreview(null);
      }
      await refreshFileTree();
      setStatusMessage(t("files.deleted", { name: entry.name }));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsFileBusy(false);
    }
  }

  async function renameWorkspaceFile(entry: WorkspaceFileEntry) {
    const newName = window.prompt(t("files.renamePrompt"), entry.name)?.trim();
    if (!newName || newName === entry.name) {
      return;
    }

    setIsFileBusy(true);
    try {
      const renamed = await shellProApi.renameWorkspaceFile(entry.path, newName);
      if (selectedFilePath === entry.path) {
        setSelectedFilePath(renamed.path);
      }
      await refreshFileTree();
      setStatusMessage(t("files.renamed", { name: newName }));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsFileBusy(false);
    }
  }

  function openUploadPicker(parentPath: string | null) {
    setPendingUploadParent(parentPath);
    uploadInputRef.current?.click();
  }

  async function uploadFiles(parentPath: string | null, files: File[]) {
    if (files.length === 0) {
      return;
    }

    setIsFileBusy(true);
    try {
      await filesToUploads(parentPath, files, setStatusMessage);
      if (parentPath) {
        setExpandedDirPaths((current) => ({ ...current, [parentPath]: true }));
      }
      await refreshFileTree();
      setStatusMessage(t("files.uploaded", { count: files.length }));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsFileBusy(false);
    }
  }

  function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(pendingUploadParent || workspaceRoot || null, files);
  }

  function handleFileDrop(event: DragEvent, parentPath: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setFileDropTarget(null);
    void uploadFiles(parentPath || workspaceRoot || null, Array.from(event.dataTransfer.files));
  }

  function openImportConfigPicker() {
    importConfigInputRef.current?.click();
  }

  async function importOpenSshConfigFile(file: File) {
    setIsFileBusy(true);
    try {
      const content = await file.text();
      const result = await shellProApi.importOpenSshConfig(content);
      await refreshBootstrap();
      setViewMode("connections");
      const warningSuffix =
        result.warnings.length > 0
          ? ` ${t("connections.importWarnings", {
              count: result.warnings.length,
              detail: result.warnings.slice(0, 2).join(" · "),
            })}`
          : "";
      setStatusMessage(
        `${t("connections.imported", {
          count: result.imported,
          skipped: result.skipped,
        })}${warningSuffix}`,
      );
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsFileBusy(false);
    }
  }

  function handleImportConfigInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    void importOpenSshConfigFile(file);
  }

  function resetProfileFilters() {
    setProfileFilters({
      group: "",
      tag: "",
      authType: "",
      favoritesOnly: false,
    });
    setSearchText("");
  }

  return (
    <div
      className={`app-shell ${!isSidebarVisible ? "sidebar-hidden" : ""} ${
        !isInspectorVisible ? "inspector-hidden" : ""
      }`}
    >
      <header className="toolbar">
        <div className="toolbar-left">
          <button
            className="icon-button"
            aria-label={t("toolbar.toggleSidebar")}
            title={t("toolbar.toggleSidebar")}
            onClick={() => setIsSidebarVisible((value) => !value)}
          >
            <PanelLeft size={17} />
          </button>
          <div className="window-title">
            <ShellProLogo size="compact" />
            <span>ShellPro</span>
          </div>
        </div>
        <div className="toolbar-center">
          <button className="toolbar-button" onClick={startLocalSession}>
            <Plus size={16} />
            {t("toolbar.local")}
          </button>
          <button
            className="toolbar-button"
            onClick={() => setViewMode("connections")}
          >
            <Server size={16} />
            {t("toolbar.ssh")}
          </button>
          <button
            className={
              terminalLayout === "single" ? "icon-button" : "icon-button active"
            }
            title={t("toolbar.splitTerminal")}
            onClick={cycleTerminalLayout}
            disabled={sessions.length === 0}
          >
            <SplitSquareHorizontal size={17} />
          </button>
          <button
            className={
              isTerminalSearchVisible ? "icon-button active" : "icon-button"
            }
            title={t("toolbar.search")}
            onClick={() => {
              setIsTerminalSearchVisible((value) => !value);
              setIsTerminalToolsVisible(false);
            }}
            disabled={!activeSession}
          >
            <Search size={17} />
          </button>
          <button
            className="icon-button"
            title={t("toolbar.reconnect")}
            onClick={() => void reconnectActiveSession()}
            disabled={!activeSession}
          >
            <RefreshCcw size={17} />
          </button>
          <button
            className={
              isTerminalToolsVisible ? "icon-button active" : "icon-button"
            }
            title={t("toolbar.more")}
            onClick={() => {
              setIsTerminalToolsVisible((value) => !value);
              setIsTerminalSearchVisible(false);
            }}
            disabled={!activeSession}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
        <div className="toolbar-right">
          <button
            className="icon-button"
            aria-label={t("toolbar.toggleInspector")}
            title={t("toolbar.toggleInspector")}
            onClick={() => setIsInspectorVisible((value) => !value)}
          >
            <PanelRight size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={t("toolbar.settings")}
            title={t("toolbar.settings")}
            onClick={() => setViewMode("settings")}
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {isTerminalSearchVisible && (
        <form
          className="floating-terminal-panel terminal-search-panel"
          onSubmit={(event) => {
            event.preventDefault();
            searchActiveTerminal("next");
          }}
        >
          <Search size={15} />
          <input
            value={terminalSearchText}
            onChange={(event) => setTerminalSearchText(event.currentTarget.value)}
            placeholder={t("terminal.searchPlaceholder")}
            autoFocus
          />
          <button className="mini-button" type="submit">
            {t("terminal.findNext")}
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => searchActiveTerminal("previous")}
          >
            {t("terminal.findPrevious")}
          </button>
          <button
            className="icon-button compact"
            type="button"
            title={t("terminal.closeSearch")}
            onClick={() => setIsTerminalSearchVisible(false)}
          >
            <X size={13} />
          </button>
        </form>
      )}

      {isTerminalToolsVisible && (
        <div className="floating-terminal-panel terminal-tools-panel">
          <button className="mini-button" onClick={() => void copyTerminalSelection()}>
            <Copy size={13} />
            {t("terminal.copySelection")}
          </button>
          <button className="mini-button" onClick={() => void pasteClipboardIntoTerminal()}>
            <Send size={13} />
            {t("terminal.paste")}
          </button>
          <button className="mini-button" onClick={clearActiveTerminal}>
            <Trash2 size={13} />
            {t("terminal.clear")}
          </button>
          <button className="mini-button" onClick={useTerminalSelectionForAi}>
            <Wand2 size={13} />
            {t("terminal.useSelectionForAi")}
          </button>
        </div>
      )}

      {isSidebarVisible && (
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="search-field">
              <Search size={15} />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder={t("sidebar.searchConnections")}
              />
            </div>
          </div>

          <nav className="sidebar-nav">
            <button
              className={viewMode === "workspace" ? "nav-item active" : "nav-item"}
              onClick={() => setViewMode("workspace")}
            >
              <Laptop size={16} />
              {t("sidebar.workspace")}
            </button>
            <button
              className={
                viewMode === "connections" ? "nav-item active" : "nav-item"
              }
              onClick={() => setViewMode("connections")}
            >
              <FolderTree size={16} />
              {t("sidebar.connections")}
            </button>
            <button
              className={viewMode === "settings" ? "nav-item active" : "nav-item"}
              onClick={() => setViewMode("settings")}
            >
              <Settings size={16} />
              {t("sidebar.settings")}
            </button>
          </nav>

          <FileExplorer
            entries={fileEntries}
            workspaceRoot={workspaceRoot}
            selectedPath={selectedFilePath}
            preview={filePreview}
            expandedDirPaths={expandedDirPaths}
            dropTargetPath={fileDropTarget}
            isBusy={isFileBusy}
            onSelect={selectFileEntry}
            onToggleDirectory={(path) =>
              setExpandedDirPaths((current) => ({
                ...current,
                [path]: !current[path],
              }))
            }
            onContextMenu={showFileContextMenu}
            onCreate={createWorkspaceFile}
            onUpload={openUploadPicker}
            onDragOver={(event, parentPath) => {
              event.preventDefault();
              setFileDropTarget(parentPath || workspaceRoot || null);
            }}
            onDragLeave={() => setFileDropTarget(null)}
            onDrop={handleFileDrop}
            t={t}
          />

          <input
            ref={uploadInputRef}
            className="visually-hidden"
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleUploadInputChange}
          />
          <input
            ref={importConfigInputRef}
            className="visually-hidden"
            type="file"
            accept=".config,.conf,.txt"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImportConfigInputChange}
          />

          <div className="sidebar-section">
            <div className="section-title">
              <Star size={14} />
              {t("sidebar.favorites")}
            </div>
            {favoriteProfiles.length === 0 && (
              <p className="muted tight">{t("sidebar.noFavorites")}</p>
            )}
            {favoriteProfiles.map((profile) => (
              <ConnectionRow
                key={profile.id}
                profile={profile}
                onConnect={() => void startSshSession(profile.id)}
                onEdit={() => editProfile(profile)}
                t={t}
              />
            ))}
          </div>

          <div className="sidebar-section">
            <div className="section-title">
              <ChevronDown size={14} />
              {t("sidebar.groups")}
            </div>
            {groups.map((group) => (
              <div key={group} className="group-block">
                <div className="group-name">{group}</div>
                {filteredProfiles
                  .filter((profile) => profile.groupId === group)
                  .map((profile) => (
                    <ConnectionRow
                      key={profile.id}
                      profile={profile}
                      onConnect={() => void startSshSession(profile.id)}
                      onEdit={() => editProfile(profile)}
                      t={t}
                    />
                  ))}
              </div>
            ))}
          </div>
        </aside>
      )}

      {fileContextMenu && (
        <FileContextMenu
          state={fileContextMenu}
          onCreate={createWorkspaceFile}
          onRename={renameWorkspaceFile}
          onDelete={deleteWorkspaceFile}
          onUpload={(parentPath) => openUploadPicker(parentPath)}
          onClose={() => setFileContextMenu(null)}
          t={t}
        />
      )}

      <main className="content">
        {viewMode === "workspace" && (
          <section
            className={
              sessions.length > 0 ? "workspace has-sessions" : "workspace"
            }
          >
            <div className="tab-strip">
              {sessions.map((session) => (
                <button
                  className={
                    session.id === activeSessionId ? "tab-item active" : "tab-item"
                  }
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className={`status-dot ${session.status}`} />
                  {session.title}
                  <span className="tab-kind">{t(`session.${session.kind}`)}</span>
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeSession(session.id);
                    }}
                  >
                    <X size={13} />
                  </span>
                </button>
              ))}
            </div>

            {sessions.length > 0 && (
              <SessionOverview
                sessions={sessions}
                activeSessionId={activeSessionId}
                terminalLayout={terminalLayout}
                connectedCount={connectedSessions.length}
                visibleCount={visibleTerminalSessions.length}
                onSelect={setActiveSessionId}
                onLayoutChange={changeTerminalLayout}
                t={t}
              />
            )}

            {sessions.length === 0 ? (
              <EmptyWorkspace
                onLocal={startLocalSession}
                onSsh={() => setViewMode("connections")}
                onImport={openImportConfigPicker}
                t={t}
              />
            ) : (
              <div className={`terminal-stack layout-${terminalLayout}`}>
                {sessions.map((session) => (
                  <TerminalPane
                    key={session.id}
                    ref={(handle) => {
                      terminalHandlesRef.current[session.id] = handle;
                    }}
                    session={session}
                    active={session.id === activeSessionId}
                    visible={visibleSessionIds.has(session.id)}
                    preferences={terminalPreferences}
                    onActivate={() => setActiveSessionId(session.id)}
                    onBufferChange={appendBuffer}
                    onStatusChange={updateSessionStatus}
                    terminalHint={t("terminal.bannerHint")}
                    disconnectedMessage={t("terminal.disconnected")}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {viewMode === "connections" && (
          <section className="management-view">
            <div className="view-header">
              <div>
                <p className="eyebrow">{t("connections.manager")}</p>
                <h1>{t("connections.sshProfiles")}</h1>
              </div>
              <div className="view-actions">
                <button
                  className="secondary-button"
                  onClick={openImportConfigPicker}
                >
                  <Download size={16} />
                  {t("workspace.importConfig")}
                </button>
                <button
                  className="toolbar-button"
                  onClick={openCreateProfile}
                >
                  <Plus size={16} />
                  {t("connections.new")}
                </button>
              </div>
            </div>
            <div className="manager-grid">
              <div className="connection-summary">
                <div className="summary-stats">
                  <div className="summary-stat">
                    <strong>{profiles.length}</strong>
                    <span>{t("connections.totalProfiles")}</span>
                  </div>
                  <div className="summary-stat">
                    <strong>{favoriteProfiles.length}</strong>
                    <span>{t("connections.favoriteProfiles")}</span>
                  </div>
                  <div className="summary-stat">
                    <strong>{activeSshSessionCount}</strong>
                    <span>{t("connections.activeSsh")}</span>
                  </div>
                  <div className="summary-stat">
                    <strong>{activeTunnelCount}</strong>
                    <span>{t("tunnel.active")}</span>
                  </div>
                </div>
                <div className="recent-connections">
                  <div className="panel-title">
                    <RefreshCcw size={16} />
                    {t("connections.recent")}
                  </div>
                  {recentProfiles.length === 0 ? (
                    <p className="muted tight">{t("connections.noRecent")}</p>
                  ) : (
                    recentProfiles.map(({ recent, profile }) => (
                      <div className="recent-connection" key={recent.profileId}>
                        <button onClick={() => void startSshSession(profile.id)}>
                          <Server size={14} />
                          <span>{recent.name}</span>
                        </button>
                        <small>
                          {recent.endpoint} · {t("connections.usedTimes", { count: recent.count })}
                        </small>
                      </div>
                    ))
                  )}
                </div>
                <div className="tunnel-panel">
                  <div className="panel-title">
                    <Shuffle size={16} />
                    {t("tunnel.active")}
                  </div>
                  {activeTunnels.length === 0 ? (
                    <p className="muted tight">{t("tunnel.empty")}</p>
                  ) : (
                    activeTunnels.map((tunnel) => (
                      <div className="tunnel-row" key={tunnel.id}>
                        <div>
                          <strong>
                            {tunnel.localHost}:{tunnel.localPort}
                          </strong>
                          <span>
                            {tunnel.remoteHost}:{tunnel.remotePort} ·{" "}
                            {tunnel.profileName}
                          </span>
                        </div>
                        <button
                          className="mini-button"
                          disabled={stoppingTunnelIds[tunnel.id]}
                          onClick={() => void stopTunnel(tunnel.id)}
                        >
                          {stoppingTunnelIds[tunnel.id] ? (
                            <Loader2 className="spin" size={13} />
                          ) : (
                            <X size={13} />
                          )}
                          {t("tunnel.stop")}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="profile-filter-bar">
                <div className="filter-field">
                  <span>{t("connections.filterGroup")}</span>
                  <select
                    value={profileFilters.group}
                    onChange={(event) => {
                      const group = event.currentTarget.value;
                      setProfileFilters((current) => ({
                        ...current,
                        group,
                      }));
                    }}
                  >
                    <option value="">{t("connections.allGroups")}</option>
                    {profileGroups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <span>{t("connections.filterTag")}</span>
                  <select
                    value={profileFilters.tag}
                    onChange={(event) => {
                      const tag = event.currentTarget.value;
                      setProfileFilters((current) => ({
                        ...current,
                        tag,
                      }));
                    }}
                  >
                    <option value="">{t("connections.allTags")}</option>
                    {profileTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <span>{t("connections.filterAuth")}</span>
                  <select
                    value={profileFilters.authType}
                    onChange={(event) => {
                      const authType = event.currentTarget
                        .value as ProfileFilters["authType"];
                      setProfileFilters((current) => ({
                        ...current,
                        authType,
                      }));
                    }}
                  >
                    <option value="">{t("connections.allAuthTypes")}</option>
                    <option value="agent">{t("profile.authAgent")}</option>
                    <option value="privateKey">{t("profile.authPrivateKey")}</option>
                    <option value="password">{t("profile.authPassword")}</option>
                  </select>
                </div>
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={profileFilters.favoritesOnly}
                    onChange={(event) => {
                      const favoritesOnly = event.currentTarget.checked;
                      setProfileFilters((current) => ({
                        ...current,
                        favoritesOnly,
                      }));
                    }}
                  />
                  <span>{t("connections.favoritesOnly")}</span>
                </label>
                <div className="filter-result">
                  {t("connections.filteredCount", {
                    count: filteredProfiles.length,
                    total: profiles.length,
                  })}
                </div>
                <button className="mini-button" onClick={resetProfileFilters}>
                  <X size={13} />
                  {t("connections.clearFilters")}
                </button>
              </div>
              <div className="profile-table">
                {filteredProfiles.map((profile) => (
                  <div className="profile-row" key={profile.id}>
                    <div className="profile-row-main">
                      <strong>{profile.name}</strong>
                      <span className="profile-meta">
                        <span>
                          {profile.username}@{profile.host}:{profile.port}
                        </span>
                        <span className="auth-chip">
                          {authTypeLabel(profile.authType, t)}
                        </span>
                        {profile.jumpHostId && (
                          <span className="jump-chip">
                            {t("connections.jumpVia", {
                              name:
                                profiles.find(
                                  (item) => item.id === profile.jumpHostId,
                                )?.name ?? profile.jumpHostId,
                            })}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        title={t("connections.connect")}
                        onClick={() => void startSshSession(profile.id)}
                      >
                        <Play size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={testingProfileIds[profile.id]}
                        title={t("connections.test")}
                        onClick={() => void testConnectionProfile(profile)}
                      >
                        {testingProfileIds[profile.id] ? (
                          <Loader2 className="spin" size={15} />
                        ) : (
                          <ShieldCheck size={15} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        title={t("tunnel.open")}
                        onClick={() => openTunnelDialog(profile)}
                      >
                        <Shuffle size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title={t("connections.edit")}
                        onClick={() => editProfile(profile)}
                      >
                        <Settings size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title={t("connections.clone")}
                        onClick={() => cloneProfile(profile)}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        title={t("connections.delete")}
                        onClick={() => void deleteProfile(profile.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                {filteredProfiles.length === 0 && (
                  <div className="empty-table">{t("connections.noMatches")}</div>
                )}
              </div>
            </div>
          </section>
        )}

        {viewMode === "settings" && (
          <section className="management-view settings-view">
            <div className="view-header">
              <div>
                <p className="eyebrow">{t("settings.preferences")}</p>
                <h1>{t("settings.title")}</h1>
              </div>
            </div>
            <div className="settings-grid">
              <div className="settings-panel">
                <div className="panel-title">
                  <Settings size={17} />
                  {t("settings.language")}
                </div>
                <label>
                  {t("settings.language")}
                  <select
                    value={locale}
                    onChange={(event) =>
                      setLocale(event.currentTarget.value as Locale)
                    }
                  >
                    <option value="en-US">{t("settings.languageEn")}</option>
                    <option value="zh-CN">{t("settings.languageZh")}</option>
                  </select>
                </label>
              </div>

              <form className="settings-panel" onSubmit={saveAiSettings}>
                <div className="panel-title">
                  <Bot size={17} />
                  {t("settings.aiProvider")}
                </div>
                <label>
                  {t("profile.name")}
                  <input
                    value={aiDraft.name}
                    onChange={(event) =>
                      setAiDraft({ ...aiDraft, name: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  {t("settings.baseUrl")}
                  <input
                    value={aiDraft.baseUrl}
                    onChange={(event) =>
                      setAiDraft({
                        ...aiDraft,
                        baseUrl: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label>
                  {t("settings.model")}
                  <input
                    value={aiDraft.model}
                    onChange={(event) =>
                      setAiDraft({ ...aiDraft, model: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  {t("settings.apiKey")}
                  <input
                    type="password"
                    value={aiKeyDraft}
                    placeholder={
                      aiConfig?.apiKeySecretRef
                        ? t("settings.storedKeychain")
                        : t("settings.notConfigured")
                    }
                    onChange={(event) => setAiKeyDraft(event.currentTarget.value)}
                  />
                </label>
                <div className="split-fields">
                  <label>
                    {t("settings.context")}
                    <select
                      value={aiDraft.contextMode}
                      onChange={(event) =>
                        setAiDraft({
                          ...aiDraft,
                          contextMode: event.currentTarget
                            .value as typeof aiDraft.contextMode,
                        })
                      }
                    >
                      <option value="selected">{t("settings.selectedText")}</option>
                      <option value="recentLines">{t("settings.recentLines")}</option>
                      <option value="fullBuffer">{t("settings.fullBuffer")}</option>
                    </select>
                  </label>
                  <label>
                    {t("settings.lines")}
                    <input
                      type="number"
                      min={20}
                      max={5000}
                      value={aiDraft.recentLineLimit}
                      onChange={(event) =>
                        setAiDraft({
                          ...aiDraft,
                          recentLineLimit: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={aiDraft.redactSecrets}
                    onChange={(event) =>
                      setAiDraft({
                        ...aiDraft,
                        redactSecrets: event.currentTarget.checked,
                      })
                    }
                  />
                  {t("settings.redactSecrets")}
                </label>
                <button className="primary-button" type="submit">
                  <Save size={16} />
                  {t("settings.saveAi")}
                </button>
              </form>

              <div className="settings-panel">
                <div className="panel-title">
                  <TerminalSquare size={17} />
                  {t("settings.terminal")}
                </div>
                <label>
                  {t("settings.font")}
                  <select
                    value={terminalPreferences.fontFamily}
                    onChange={(event) =>
                      updateTerminalPreferences({
                        fontFamily: event.currentTarget.value,
                      })
                    }
                  >
                    {terminalFontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="split-fields">
                  <label>
                    {t("settings.fontSize")}
                    <input
                      type="number"
                      min={10}
                      max={22}
                      value={terminalPreferences.fontSize}
                      onChange={(event) =>
                        updateTerminalPreferences({
                          fontSize: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("settings.scrollback")}
                    <input
                      type="number"
                      min={1000}
                      max={50000}
                      step={1000}
                      value={terminalPreferences.scrollback}
                      onChange={(event) =>
                        updateTerminalPreferences({
                          scrollback: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  {t("settings.theme")}
                  <select
                    value={terminalPreferences.theme}
                    onChange={(event) =>
                      updateTerminalPreferences({
                        theme: event.currentTarget.value as TerminalTheme,
                      })
                    }
                  >
                    <option value="system">{t("settings.followsSystem")}</option>
                    <option value="dark">{t("settings.themeDark")}</option>
                    <option value="light">{t("settings.themeLight")}</option>
                  </select>
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetTerminalPreferences}
                >
                  <RefreshCcw size={16} />
                  {t("settings.restoreTerminalDefaults")}
                </button>
              </div>

              <div className="settings-panel">
                <div className="panel-title">
                  <ShieldCheck size={17} />
                  {t("settings.security")}
                </div>
                <div className="preference-row">
                  <span>{t("settings.credentials")}</span>
                  <strong>{t("settings.systemKeychain")}</strong>
                </div>
                <div className="preference-row">
                  <span>{t("settings.aiExecution")}</span>
                  <strong>{t("settings.manualOnly")}</strong>
                </div>
                <div className="preference-row">
                  <span>{t("settings.highRiskCommands")}</span>
                  <strong>{t("settings.confirmEveryTime")}</strong>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {isProfileDialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeProfileDialog();
            }
          }}
        >
          <div
            className="modal-panel profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-dialog-title"
          >
            <ProfileEditor
              draft={profileDraft}
              profiles={profiles}
              secretDraft={secretDraft}
              setSecretDraft={setSecretDraft}
              onChange={setProfileDraft}
              onSubmit={saveProfile}
              onCancel={closeProfileDialog}
              onTest={() => void testProfileDraft()}
              isEditing={Boolean(profileDraft.id)}
              isTesting={isTestingProfileDraft}
              t={t}
            />
          </div>
        </div>
      )}

      {isTunnelDialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeTunnelDialog();
            }
          }}
        >
          <form
            className="modal-panel profile-dialog tunnel-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tunnel-dialog-title"
            onSubmit={startTunnel}
          >
            <div className="profile-editor-head">
              <div>
                <p className="eyebrow">{t("tunnel.subtitle")}</p>
                <h2 id="tunnel-dialog-title">{t("tunnel.title")}</h2>
              </div>
              <button
                className="icon-button compact"
                type="button"
                onClick={closeTunnelDialog}
              >
                <X size={16} />
              </button>
            </div>
            <div className="form-section">
              <label>
                {t("tunnel.profile")}
                <select
                  value={tunnelDraft.profileId}
                  onChange={(event) => {
                    const profileId = event.currentTarget.value;
                    setTunnelDraft((current) => ({ ...current, profileId }));
                  }}
                >
                  <option value="">{t("tunnel.chooseProfile")}</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="split-fields">
                <label>
                  {t("tunnel.localHost")}
                  <input
                    value={tunnelDraft.localHost}
                    onChange={(event) => {
                      const localHost = event.currentTarget.value;
                      setTunnelDraft((current) => ({ ...current, localHost }));
                    }}
                  />
                </label>
                <label>
                  {t("tunnel.localPort")}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={tunnelDraft.localPort}
                    onChange={(event) => {
                      const localPort = Number(event.currentTarget.value);
                      setTunnelDraft((current) => ({ ...current, localPort }));
                    }}
                  />
                </label>
              </div>
              <div className="split-fields">
                <label>
                  {t("tunnel.remoteHost")}
                  <input
                    value={tunnelDraft.remoteHost}
                    onChange={(event) => {
                      const remoteHost = event.currentTarget.value;
                      setTunnelDraft((current) => ({ ...current, remoteHost }));
                    }}
                  />
                </label>
                <label>
                  {t("tunnel.remotePort")}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={tunnelDraft.remotePort}
                    onChange={(event) => {
                      const remotePort = Number(event.currentTarget.value);
                      setTunnelDraft((current) => ({ ...current, remotePort }));
                    }}
                  />
                </label>
              </div>
              <p className="muted tight">
                {tunnelProfileUnsupported
                  ? t("tunnel.passwordUnsupported")
                  : t("tunnel.loopbackHint")}
              </p>
            </div>
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeTunnelDialog}
              >
                {t("app.cancel")}
              </button>
              <button
                className="primary-button"
                disabled={
                  isStartingTunnel ||
                  tunnelProfileUnsupported ||
                  !tunnelDraft.profileId
                }
                type="submit"
              >
                {isStartingTunnel ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Gauge size={16} />
                )}
                {t("tunnel.start")}
              </button>
            </div>
          </form>
        </div>
      )}

      {isInspectorVisible && (
        <aside className="inspector">
          <div className="inspector-header">
            <div>
              <p className="eyebrow">{t("ai.inspector")}</p>
              <h2>{t("ai.commandAdvisor")}</h2>
              <p className="session-scope">{activeSessionLabel}</p>
            </div>
            <span className="safety-pill">
              <ShieldCheck size={14} />
              {t("ai.manual")}
            </span>
          </div>

          <form className="ai-form" onSubmit={askAi}>
            <div className="segmented">
              <button
                type="button"
                className={selectedContextMode === "recent" ? "active" : ""}
                onClick={() => setSelectedContextMode("recent")}
              >
                {t("ai.recent")}
              </button>
              <button
                type="button"
                className={selectedContextMode === "selected" ? "active" : ""}
                onClick={() => setSelectedContextMode("selected")}
              >
                {t("ai.selected")}
              </button>
            </div>
            {selectedContextMode === "selected" && (
              <textarea
                className="context-input"
                value={manualSelection}
                onChange={(event) => setManualSelection(event.currentTarget.value)}
                placeholder={t("ai.pasteSelected")}
              />
            )}
            <textarea
              value={aiQuestion}
              onChange={(event) => setAiQuestion(event.currentTarget.value)}
              placeholder={t("ai.askPlaceholder")}
            />
            <button
              className="primary-button"
              type="submit"
              disabled={isAiBusy || !activeSessionId}
            >
              {isAiBusy ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
              {t("ai.suggestCommands")}
            </button>
          </form>

          <QuickCommandPanel
            templates={quickCommands}
            disabled={!activeSessionId}
            draft={quickCommandDraft}
            onDraftChange={setQuickCommandDraft}
            onAdd={addQuickCommand}
            onDelete={deleteQuickCommand}
            onQueue={queueQuickCommand}
            onFill={fillTerminal}
            t={t}
          />

          <div className="context-preview">
            <div className="panel-title">
              <ShieldAlert size={16} />
              {t("ai.contextPreview")}
            </div>
            <pre ref={contextPreviewRef}>
              {contextPreview || t("ai.openTerminalContext")}
            </pre>
          </div>

          <div className="suggestion-list">
            {activeSuggestions.length === 0 && (
              <p className="muted">
                {activeSuggestionState === "loading"
                  ? t("ai.generating")
                  : activeSuggestionState === "empty"
                    ? t("ai.noUsableSuggestions")
                    : t("ai.noSuggestions")}
              </p>
            )}
            {activeSuggestions.map((item) => (
              <SuggestionCard
                key={item.id}
                suggestion={item}
                onQueue={() => void queueSuggestion(item)}
                onFill={() => void fillTerminal(item.command)}
                t={t}
                riskLabel={riskLabel}
              />
            ))}
          </div>

          <div className="queue-list">
            <div className="panel-title">
              <Send size={16} />
              {t("ai.executionList")}
            </div>
            {activeQueue.length === 0 && <p className="muted">{t("ai.noQueued")}</p>}
            {activeQueue.map((item) => (
              <div className="queue-item" key={item.id}>
                <code>{item.command}</code>
                <span className={`risk ${item.riskLevel}`}>
                  {riskLabel[item.riskLevel]}
                </span>
                <div className="queue-actions">
                  <button
                    className="mini-button"
                    disabled={item.status !== "pending"}
                    onClick={() => void executeQueueItem(item)}
                  >
                    <Play size={13} />
                    {t("ai.execute")}
                  </button>
                  <button
                    className="icon-button"
                    title={t("ai.cancel")}
                    onClick={() =>
                      setQueue((current) =>
                        current.map((queueItem) =>
                          queueItem.id === item.id
                            ? { ...queueItem, status: "cancelled" }
                            : queueItem,
                        ),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      <footer className="statusbar">
        <span>{statusMessage}</span>
        <span>
          {activeSession
            ? `${activeSession.title} · ${t(`session.${activeSession.status}`)}`
            : t("app.noActiveSession")}
        </span>
      </footer>
    </div>
  );
}

function SessionOverview({
  sessions,
  activeSessionId,
  terminalLayout,
  connectedCount,
  visibleCount,
  onSelect,
  onLayoutChange,
  t,
}: {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  terminalLayout: TerminalLayout;
  connectedCount: number;
  visibleCount: number;
  onSelect: (sessionId: string) => void;
  onLayoutChange: (layout: TerminalLayout) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const sshCount = sessions.filter((session) => session.kind === "ssh").length;

  return (
    <div className="session-overview">
      <div className="session-metrics">
        <div className="session-metric">
          <TerminalSquare size={15} />
          <strong>{sessions.length}</strong>
          <span>{t("workspace.sessions")}</span>
        </div>
        <div className="session-metric">
          <ShieldCheck size={15} />
          <strong>{connectedCount}</strong>
          <span>{t("workspace.connected")}</span>
        </div>
        <div className="session-metric">
          <Server size={15} />
          <strong>{sshCount}</strong>
          <span>{t("workspace.sshSessions")}</span>
        </div>
      </div>

      <div className="session-overview-main">
        <span className={`status-dot ${activeSession.status}`} />
        <div>
          <strong>{activeSession.title}</strong>
          <span>
            {t(`session.${activeSession.kind}`)} ·{" "}
            {t(`session.${activeSession.status}`)}
          </span>
        </div>
      </div>

      <div className="session-pickers">
        <select
          value={activeSession.id}
          onChange={(event) => onSelect(event.currentTarget.value)}
          title={t("workspace.activeSession")}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </select>
        <div className="layout-switch" aria-label={t("workspace.layout")}>
          {(["single", "split", "grid"] as TerminalLayout[]).map((layout) => (
            <button
              key={layout}
              className={terminalLayout === layout ? "active" : ""}
              type="button"
              title={t(`layout.${layout}`)}
              onClick={() => onLayoutChange(layout)}
            >
              {layout === "single" ? "1" : layout === "split" ? "2" : "4"}
            </button>
          ))}
        </div>
        <span className="visible-pane-count">
          {t("workspace.visiblePanes", { count: visibleCount })}
        </span>
      </div>
    </div>
  );
}

function FileExplorer({
  entries,
  workspaceRoot,
  selectedPath,
  preview,
  expandedDirPaths,
  dropTargetPath,
  isBusy,
  onSelect,
  onToggleDirectory,
  onContextMenu,
  onCreate,
  onUpload,
  onDragOver,
  onDragLeave,
  onDrop,
  t,
}: {
  entries: WorkspaceFileEntry[];
  workspaceRoot: string;
  selectedPath: string | null;
  preview: WorkspaceFilePreview | null;
  expandedDirPaths: Record<string, boolean>;
  dropTargetPath: string | null;
  isBusy: boolean;
  onSelect: (entry: WorkspaceFileEntry) => void;
  onToggleDirectory: (path: string) => void;
  onContextMenu: (
    event: MouseEvent,
    entry: WorkspaceFileEntry | null,
    parentPath: string | null,
  ) => void;
  onCreate: (
    target: WorkspaceFileEntry | null,
    kind: WorkspaceFileKind,
  ) => Promise<void>;
  onUpload: (parentPath: string | null) => void;
  onDragOver: (event: DragEvent, parentPath: string | null) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent, parentPath: string | null) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const selectedEntry = useMemo(
    () => flattenFileEntries(entries).find((entry) => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );
  const selectedChildCount = selectedEntry?.children?.length ?? 0;

  return (
    <section
      className="sidebar-section file-browser"
      onContextMenu={(event) => onContextMenu(event, null, workspaceRoot || null)}
      onDragOver={(event) => onDragOver(event, workspaceRoot || null)}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop(event, workspaceRoot || null)}
    >
      <div className="file-browser-head">
        <div className="section-title">
          <FolderTree size={14} />
          {t("files.title")}
        </div>
        <div className="file-actions">
          <button
            className="icon-button compact"
            title={t("files.newFile")}
            onClick={(event) => {
              event.stopPropagation();
              void onCreate(null, "file");
            }}
            disabled={isBusy}
          >
            <FilePlus2 size={13} />
          </button>
          <button
            className="icon-button compact"
            title={t("files.newFolder")}
            onClick={(event) => {
              event.stopPropagation();
              void onCreate(null, "directory");
            }}
            disabled={isBusy}
          >
            <FolderPlus size={13} />
          </button>
          <button
            className="icon-button compact"
            title={t("files.upload")}
            onClick={(event) => {
              event.stopPropagation();
              onUpload(workspaceRoot || null);
            }}
            disabled={isBusy}
          >
            <UploadCloud size={13} />
          </button>
        </div>
      </div>

      <div
        className={
          dropTargetPath === workspaceRoot ? "file-tree root is-drop-target" : "file-tree root"
        }
      >
        <div className="file-root-label" title={workspaceRoot}>
          {workspaceRoot || t("files.workspaceRoot")}
        </div>
        {entries.length === 0 ? (
          <p className="muted tight file-empty">{t("files.empty")}</p>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              level={0}
              selectedPath={selectedPath}
              expandedDirPaths={expandedDirPaths}
              dropTargetPath={dropTargetPath}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={onContextMenu}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))
        )}
      </div>

      <div className="file-preview">
        <div className="panel-title">
          <FileText size={15} />
          {t("files.preview")}
        </div>
        {!preview ? (
          <p className="muted tight">{t("files.previewEmpty")}</p>
        ) : (
          <div className="file-preview-body">
            <div className="file-preview-meta">
              <strong>{preview.name}</strong>
              <span>
                {preview.kind === "directory"
                  ? t("files.folderMeta", { count: selectedChildCount })
                  : formatFileSize(preview.size)}
              </span>
              {formatFileDate(preview.modifiedAt) && (
                <span>{formatFileDate(preview.modifiedAt)}</span>
              )}
            </div>
            {preview.kind === "directory" ? (
              <p className="muted tight">
                {t("files.folderPreview", { count: selectedChildCount })}
              </p>
            ) : preview.content ? (
              <pre>{preview.content}</pre>
            ) : (
              <p className="muted tight">{t("files.binaryPreview")}</p>
            )}
            {preview.truncated && (
              <p className="muted tight">{t("files.previewTruncated")}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FileTreeNode({
  entry,
  level,
  selectedPath,
  expandedDirPaths,
  dropTargetPath,
  onSelect,
  onToggleDirectory,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  entry: WorkspaceFileEntry;
  level: number;
  selectedPath: string | null;
  expandedDirPaths: Record<string, boolean>;
  dropTargetPath: string | null;
  onSelect: (entry: WorkspaceFileEntry) => void;
  onToggleDirectory: (path: string) => void;
  onContextMenu: (
    event: MouseEvent,
    entry: WorkspaceFileEntry | null,
    parentPath: string | null,
  ) => void;
  onDragOver: (event: DragEvent, parentPath: string | null) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent, parentPath: string | null) => void;
}) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = Boolean(expandedDirPaths[entry.path]);
  const childEntries = entry.children ?? [];
  const targetDropPath = isDirectory ? entry.path : entry.parentPath ?? null;
  const isDropTarget = Boolean(targetDropPath && dropTargetPath === targetDropPath);

  return (
    <div className="file-node-wrap">
      <button
        className={[
          "file-node",
          selectedPath === entry.path ? "selected" : "",
          isDropTarget ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 8 + level * 14 }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entry);
        }}
        onContextMenu={(event) => onContextMenu(event, entry, entry.parentPath ?? null)}
        onDragOver={(event) => {
          onDragOver(event, targetDropPath);
        }}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          onDrop(event, targetDropPath);
        }}
      >
        <span
          className="file-disclosure"
          onClick={(event) => {
            if (!isDirectory) {
              return;
            }
            event.stopPropagation();
            onToggleDirectory(entry.path);
          }}
        >
          {isDirectory ? <ChevronDown size={12} /> : null}
        </span>
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen size={14} />
          ) : (
            <Folder size={14} />
          )
        ) : (
          <FileText size={14} />
        )}
        <span>{entry.name}</span>
      </button>
      {isDirectory && isExpanded && childEntries.length > 0 && (
        <div className="file-children">
          {childEntries.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedDirPaths={expandedDirPaths}
              dropTargetPath={dropTargetPath}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onContextMenu={onContextMenu}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileContextMenu({
  state,
  onCreate,
  onRename,
  onDelete,
  onUpload,
  onClose,
  t,
}: {
  state: NonNullable<FileContextMenuState>;
  onCreate: (
    target: WorkspaceFileEntry | null,
    kind: WorkspaceFileKind,
  ) => Promise<void>;
  onRename: (entry: WorkspaceFileEntry) => Promise<void>;
  onDelete: (entry: WorkspaceFileEntry) => Promise<void>;
  onUpload: (parentPath: string | null) => void;
  onClose: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const uploadParent = parentForFileAction(state.entry, state.parentPath);
  const entry = state.entry;

  return (
    <div
      className="context-menu file-context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          void onCreate(state.entry, "file");
        }}
      >
        <FilePlus2 size={14} />
        {t("files.newFile")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          void onCreate(state.entry, "directory");
        }}
      >
        <FolderPlus size={14} />
        {t("files.newFolder")}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onUpload(uploadParent);
        }}
      >
        <UploadCloud size={14} />
        {t("files.upload")}
      </button>
      {entry && (
        <>
          <div className="context-menu-divider" />
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              void onRename(entry);
            }}
          >
            <Pencil size={14} />
            {t("files.rename")}
          </button>
          <button
            className="danger"
            role="menuitem"
            onClick={() => {
              onClose();
              void onDelete(entry);
            }}
          >
            <Trash2 size={14} />
            {t("files.delete")}
          </button>
        </>
      )}
    </div>
  );
}

function ConnectionRow({
  profile,
  onConnect,
  onEdit,
  t,
}: {
  profile: ConnectionProfile;
  onConnect: () => void;
  onEdit: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="connection-row">
      <button onClick={onConnect}>
        <Server size={15} />
        <span>{profile.name}</span>
      </button>
      <button
        className="icon-button compact"
        title={t("connections.edit")}
        onClick={onEdit}
      >
        <Settings size={13} />
      </button>
    </div>
  );
}

function ShellProLogo({ size = "normal" }: { size?: "compact" | "normal" | "large" }) {
  return (
    <span className={`logo-mark ${size}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <rect className="logo-shell" x="7" y="9" width="50" height="46" rx="10" />
        <path className="logo-window" d="M14 20h36" />
        <path className="logo-prompt" d="M18 33l7 6-7 6" />
        <path className="logo-cursor" d="M31 45h12" />
        <path className="logo-bolt" d="M39 16 30 34h10l-6 15 17-25H40l6-8Z" />
      </svg>
    </span>
  );
}

function EmptyWorkspace({
  onLocal,
  onSsh,
  onImport,
  t,
}: {
  onLocal: () => void;
  onSsh: () => void;
  onImport: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="empty-workspace">
      <ShellProLogo size="large" />
      <h1>ShellPro</h1>
      <p>{t("workspace.startDescription")}</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={onLocal}>
          <TerminalSquare size={17} />
          {t("workspace.newLocal")}
        </button>
        <button className="secondary-button" onClick={onSsh}>
          <Server size={17} />
          {t("workspace.newSsh")}
        </button>
        <button className="secondary-button" onClick={onImport}>
          <Download size={17} />
          {t("workspace.importConfig")}
        </button>
      </div>
    </div>
  );
}

function ProfileEditor({
  draft,
  profiles,
  secretDraft,
  setSecretDraft,
  onChange,
  onSubmit,
  onCancel,
  onTest,
  isEditing,
  isTesting,
  t,
}: {
  draft: ConnectionProfileInput;
  profiles: ConnectionProfile[];
  secretDraft: string;
  setSecretDraft: (value: string) => void;
  onChange: (draft: ConnectionProfileInput) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onTest: () => void;
  isEditing: boolean;
  isTesting: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const showPrivateKey = draft.authType === "privateKey";
  const showSecret = draft.authType !== "agent";
  const secretLabel =
    draft.authType === "password"
      ? t("profile.password")
      : t("profile.passphrase");
  const jumpHostOptions = profiles.filter((profile) => profile.id !== draft.id);

  return (
    <form className="profile-editor" onSubmit={onSubmit}>
      <div className="profile-editor-head">
        <div>
          <p className="eyebrow">{t("profile.detail")}</p>
          <h2 id="profile-dialog-title">
            {isEditing ? t("profile.editTitle") : t("profile.createTitle")}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t("profile.cancel")}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>

      <section className="form-section">
        <div className="panel-title">
          <Server size={17} />
          {t("profile.basicSection")}
        </div>
        <label>
          {t("profile.name")}
          <input
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
            placeholder={t("profile.namePlaceholder")}
          />
        </label>
        <div className="form-grid host-grid">
          <label>
            {t("profile.host")}
            <input
              value={draft.host}
              onChange={(event) =>
                onChange({ ...draft, host: event.currentTarget.value })
              }
              placeholder={t("profile.hostPlaceholder")}
            />
          </label>
          <label>
            {t("profile.port")}
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) =>
                onChange({ ...draft, port: Number(event.currentTarget.value) })
              }
            />
          </label>
        </div>
        <label>
          {t("profile.username")}
          <input
            value={draft.username}
            onChange={(event) =>
              onChange({ ...draft, username: event.currentTarget.value })
            }
            placeholder={t("profile.usernamePlaceholder")}
          />
        </label>
      </section>

      <section className="form-section">
        <div className="panel-title">
          <FileKey2 size={17} />
          {t("profile.authSection")}
        </div>
        <label>
          {t("profile.auth")}
          <select
            value={draft.authType}
            onChange={(event) => {
              const authType = event.currentTarget
                .value as ConnectionProfile["authType"];
              onChange({
                ...draft,
                authType,
                privateKeyPath:
                  authType === "privateKey" ? draft.privateKeyPath : "",
              });
              if (authType === "agent") {
                setSecretDraft("");
              }
            }}
          >
            <option value="agent">{t("profile.authAgent")}</option>
            <option value="privateKey">{t("profile.authPrivateKey")}</option>
            <option value="password">{t("profile.authPassword")}</option>
          </select>
          <small>{t("profile.authHelp")}</small>
        </label>
        {showPrivateKey && (
          <label>
            {t("profile.privateKeyPath")}
            <input
              value={draft.privateKeyPath ?? ""}
              onChange={(event) =>
                onChange({ ...draft, privateKeyPath: event.currentTarget.value })
              }
              placeholder={t("profile.privateKeyPlaceholder")}
            />
          </label>
        )}
        {showSecret && (
          <label>
            {secretLabel}
            <input
              type="password"
              value={secretDraft}
              placeholder={t("profile.secretPlaceholder")}
              onChange={(event) => setSecretDraft(event.currentTarget.value)}
            />
            <small>{t("profile.secretSavedHint")}</small>
          </label>
        )}
      </section>

      <section className="form-section">
        <div className="panel-title">
          <FolderTree size={17} />
          {t("profile.organizeSection")}
        </div>
        <div className="form-grid">
          <label>
            {t("profile.group")}
            <input
              value={draft.groupId ?? ""}
              onChange={(event) =>
                onChange({ ...draft, groupId: event.currentTarget.value })
              }
              placeholder={t("profile.groupPlaceholder")}
            />
          </label>
          <label>
            {t("profile.tags")}
            <input
              value={tagsToText(draft.tags)}
              onChange={(event) =>
                onChange({ ...draft, tags: textToTags(event.currentTarget.value) })
              }
              placeholder={t("profile.tagsPlaceholder")}
            />
          </label>
        </div>
        <label>
          {t("profile.jumpHost")}
          <select
            value={draft.jumpHostId ?? ""}
            onChange={(event) =>
              onChange({ ...draft, jumpHostId: event.currentTarget.value })
            }
          >
            <option value="">{t("profile.noJumpHost")}</option>
            {jumpHostOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.username}@{profile.host}:{profile.port}
              </option>
            ))}
          </select>
          <small>{t("profile.jumpHostHelp")}</small>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) =>
              onChange({ ...draft, favorite: event.currentTarget.checked })
            }
          />
          <span>{t("profile.favorite")}</span>
          <small>{t("profile.favoriteHelp")}</small>
        </label>
      </section>

      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          {t("profile.cancel")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={isTesting}
          onClick={onTest}
        >
          {isTesting ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          {t("profile.test")}
        </button>
        <button className="primary-button" type="submit">
          <Save size={16} />
          {t("profile.save")}
        </button>
      </div>
    </form>
  );
}

function QuickCommandPanel({
  templates,
  disabled,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
  onQueue,
  onFill,
  t,
}: {
  templates: QuickCommandTemplate[];
  disabled: boolean;
  draft: { title: string; command: string; explanation: string };
  onDraftChange: (draft: {
    title: string;
    command: string;
    explanation: string;
  }) => void;
  onAdd: (event: FormEvent) => void;
  onDelete: (commandId: string) => void;
  onQueue: (template: QuickCommandTemplate) => Promise<void>;
  onFill: (command: string) => Promise<void>;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="quick-command-panel">
      <div className="panel-title">
        <TerminalSquare size={16} />
        {t("quick.title")}
      </div>
      <form className="quick-command-form" onSubmit={onAdd}>
        <input
          value={draft.title}
          onChange={(event) =>
            onDraftChange({ ...draft, title: event.currentTarget.value })
          }
          placeholder={t("quick.namePlaceholder")}
        />
        <input
          value={draft.command}
          onChange={(event) =>
            onDraftChange({ ...draft, command: event.currentTarget.value })
          }
          placeholder={t("quick.commandPlaceholder")}
        />
        <input
          value={draft.explanation}
          onChange={(event) =>
            onDraftChange({ ...draft, explanation: event.currentTarget.value })
          }
          placeholder={t("quick.notePlaceholder")}
        />
        <button className="mini-button" type="submit">
          <Plus size={13} />
          {t("quick.add")}
        </button>
      </form>
      <div className="quick-command-grid">
        {templates.map((template) => (
          <div className="quick-command" key={template.id}>
            <div>
              <strong>
                {template.titleKey ? t(template.titleKey) : template.title}
              </strong>
              <span>
                {template.explanationKey
                  ? t(template.explanationKey)
                  : template.explanation || t("quick.customCommand")}
              </span>
            </div>
            <code>{template.command}</code>
            <div className="quick-command-actions">
              <button
                className="mini-button"
                disabled={disabled}
                onClick={() => void onFill(template.command)}
              >
                <Send size={13} />
                {t("ai.fill")}
              </button>
              <button
                className="mini-button"
                disabled={disabled}
                onClick={() => void onQueue(template)}
              >
                <Check size={13} />
                {t("ai.queue")}
              </button>
              <button
                className="icon-button compact"
                title={t("ai.copyCommand")}
                onClick={() => void navigator.clipboard.writeText(template.command)}
              >
                <Copy size={13} />
              </button>
              {!template.builtin && (
                <button
                  className="icon-button compact danger"
                  title={t("quick.delete")}
                  onClick={() => onDelete(template.id)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onQueue,
  onFill,
  t,
  riskLabel,
}: {
  suggestion: AiCommandSuggestion;
  onQueue: () => void;
  onFill: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  riskLabel: Record<RiskLevel, string>;
}) {
  return (
    <div className="suggestion-card">
      <div className="suggestion-head">
        <span className={`risk ${suggestion.riskLevel}`}>
          {riskLabel[suggestion.riskLevel]}
        </span>
        <div className="suggestion-flags">
          {suggestion.requiresSudo && <span>{t("ai.flagSudo")}</span>}
          {suggestion.modifiesFiles && <span>{t("ai.flagModifies")}</span>}
          {suggestion.destructive && <span>{t("ai.flagDestructive")}</span>}
        </div>
      </div>
      <code>{suggestion.command}</code>
      <p>{suggestion.explanation}</p>
      <small>{suggestion.expectedOutcome}</small>
      <div className="suggestion-actions">
        <button className="mini-button" onClick={onQueue}>
          <Check size={13} />
          {t("ai.queue")}
        </button>
        <button className="mini-button" onClick={onFill}>
          <Send size={13} />
          {t("ai.fill")}
        </button>
        <button
          className="icon-button"
          title={t("ai.copyCommand")}
          onClick={() => void navigator.clipboard.writeText(suggestion.command)}
        >
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}

export default App;
