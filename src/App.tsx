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
import { TerminalPane } from "./TerminalPane";
import type {
  AiCommandSuggestion,
  AiProviderConfig,
  CommandQueueItem,
  ConnectionProfile,
  ConnectionProfileInput,
  ContextMode,
  RiskLevel,
  TerminalSession,
  WorkspaceFileEntry,
  WorkspaceFileKind,
  WorkspaceFilePreview,
} from "./types";

type ViewMode = "workspace" | "connections" | "settings";
type SuggestionState = "idle" | "loading" | "empty" | "ready";
type FileContextMenuState = {
  x: number;
  y: number;
  entry: WorkspaceFileEntry | null;
  parentPath: string | null;
} | null;

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
  const [profileDraft, setProfileDraft] =
    useState<ConnectionProfileInput>(createEmptyProfile);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
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
  const [searchText, setSearchText] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const contextPreviewRef = useRef<HTMLPreElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
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
  const isAiBusy = activeSessionId ? busySessionIds[activeSessionId] ?? false : false;
  const activeSessionLabel = activeSession
    ? `${activeSession.title} · ${t(`session.${activeSession.status}`)}`
    : t("app.noActiveSession");
  const allFileEntries = useMemo(
    () => flattenFileEntries(fileEntries),
    [fileEntries],
  );
  const filteredProfiles = profiles.filter((profile) => {
    const needle = searchText.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return [
      profile.name,
      profile.host,
      profile.username,
      profile.groupId ?? "",
      ...profile.tags,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const favoriteProfiles = profiles.filter((profile) => profile.favorite);
  const groups = useMemo(
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

  useEffect(() => {
    void refreshBootstrap();
    void refreshFileTree();
  }, [refreshBootstrap, refreshFileTree]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
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
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  async function startSshSession(profileId: string) {
    try {
      const session = await shellProApi.startSshSession(profileId);
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      setViewMode("workspace");
      setStatusMessage(t("app.sshStarted", { title: session.title }));
    } catch (error) {
      setStatusMessage(String(error));
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
    await refreshBootstrap();
    setStatusMessage(t("app.connectionDeleted"));
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
    if (!activeSessionId) {
      return;
    }
    await shellProApi.writeToSession(activeSessionId, command);
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
          <button className="icon-button" title={t("toolbar.splitTerminal")}>
            <SplitSquareHorizontal size={17} />
          </button>
          <button className="icon-button" title={t("toolbar.search")}>
            <Search size={17} />
          </button>
          <button
            className="icon-button"
            title={t("toolbar.reconnect")}
            onClick={() => setStatusMessage(t("app.reconnectLater"))}
          >
            <RefreshCcw size={17} />
          </button>
          <button className="icon-button" title={t("toolbar.more")}>
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
          <section className="workspace">
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

            {sessions.length === 0 ? (
              <EmptyWorkspace
                onLocal={startLocalSession}
                onSsh={() => setViewMode("connections")}
                t={t}
              />
            ) : (
              <div className="terminal-stack">
                {sessions.map((session) => (
                  <TerminalPane
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
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
              <button
                className="toolbar-button"
                onClick={openCreateProfile}
              >
                <Plus size={16} />
                {t("connections.new")}
              </button>
            </div>
            <div className="manager-grid">
              <div className="profile-table">
                {filteredProfiles.map((profile) => (
                  <div className="profile-row" key={profile.id}>
                    <div>
                      <strong>{profile.name}</strong>
                      <span className="profile-meta">
                        <span>
                          {profile.username}@{profile.host}:{profile.port}
                        </span>
                        <span className="auth-chip">
                          {authTypeLabel(profile.authType, t)}
                        </span>
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
                        title={t("connections.edit")}
                        onClick={() => editProfile(profile)}
                      >
                        <Settings size={15} />
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
                <div className="preference-row">
                  <span>{t("settings.font")}</span>
                  <strong>SF Mono / JetBrains Mono / Menlo</strong>
                </div>
                <div className="preference-row">
                  <span>{t("settings.scrollback")}</span>
                  <strong>5,000 lines</strong>
                </div>
                <div className="preference-row">
                  <span>{t("settings.theme")}</span>
                  <strong>{t("settings.followsSystem")}</strong>
                </div>
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
              secretDraft={secretDraft}
              setSecretDraft={setSecretDraft}
              onChange={setProfileDraft}
              onSubmit={saveProfile}
              onCancel={closeProfileDialog}
              isEditing={Boolean(profileDraft.id)}
              t={t}
            />
          </div>
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
  t,
}: {
  onLocal: () => void;
  onSsh: () => void;
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
        <button className="secondary-button">
          <Download size={17} />
          {t("workspace.importConfig")}
        </button>
      </div>
    </div>
  );
}

function ProfileEditor({
  draft,
  secretDraft,
  setSecretDraft,
  onChange,
  onSubmit,
  onCancel,
  isEditing,
  t,
}: {
  draft: ConnectionProfileInput;
  secretDraft: string;
  setSecretDraft: (value: string) => void;
  onChange: (draft: ConnectionProfileInput) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  isEditing: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const showPrivateKey = draft.authType === "privateKey";
  const showSecret = draft.authType !== "agent";
  const secretLabel =
    draft.authType === "password"
      ? t("profile.password")
      : t("profile.passphrase");

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
          <input
            value={draft.jumpHostId ?? ""}
            onChange={(event) =>
              onChange({ ...draft, jumpHostId: event.currentTarget.value })
            }
            placeholder={t("profile.jumpHostPlaceholder")}
          />
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
        <button className="primary-button" type="submit">
          <Save size={16} />
          {t("profile.save")}
        </button>
      </div>
    </form>
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
