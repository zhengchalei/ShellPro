import {
  ChevronDown,
  Copy,
  Download,
  FolderTree,
  Gauge,
  Laptop,
  PanelRight,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Server,
  Settings,
  Shuffle,
  ShieldCheck,
  SplitSquareHorizontal,
  Star,
  Trash2,
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
import {
  authTypeLabel,
  clampNumber,
  compactBuffer,
  createEmptyProfile,
  createTunnelDraft,
  defaultTerminalPreferences,
  quickCommandTemplates,
  readCustomQuickCommands,
  readRecentConnections,
  readTerminalPreferences,
  saveCustomQuickCommands,
  saveRecentConnections,
  saveTerminalPreferences,
  updateRecentConnections,
} from "./appState";
import type {
  FileContextMenuState,
  ProfileFilters,
  QuickCommandTemplate,
  RecentConnection,
  SuggestionState,
  TerminalLayout,
  TunnelDraft,
  ViewMode,
} from "./appTypes";
import {
  AiInspector,
  type AiInspectorContextMode,
} from "./components/AiInspector";
import { FileContextMenu, FileExplorer } from "./components/FileExplorer";
import { ProfileEditor } from "./components/ProfileEditor";
import { SessionOverview } from "./components/SessionOverview";
import {
  SettingsView,
  type AiSettingsDraft,
} from "./components/SettingsView";
import {
  ConnectionRow,
  EmptyWorkspace,
  ShellProLogo,
} from "./components/WorkspaceShell";
import {
  filesToUploads,
  flattenFileEntries,
  parentForFileAction,
} from "./fileUtils";
import { useI18n } from "./i18n";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import type {
  AiCommandSuggestion,
  AiProviderConfig,
  CommandQueueItem,
  ConnectionProfile,
  ConnectionProfileInput,
  RiskLevel,
  SshTunnelSession,
  TerminalPreferences,
  TerminalSession,
  WorkspaceFileEntry,
  WorkspaceFileKind,
  WorkspaceFilePreview,
} from "./types";

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
  const [selectedContextMode, setSelectedContextMode] =
    useState<AiInspectorContextMode>("recent");
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
  const [aiDraft, setAiDraft] = useState<AiSettingsDraft>({
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

  function cancelQueueItem(itemId: string) {
    setQueue((current) =>
      current.map((queueItem) =>
        queueItem.id === itemId
          ? { ...queueItem, status: "cancelled" }
          : queueItem,
      ),
    );
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
          <SettingsView
            locale={locale}
            onLocaleChange={setLocale}
            aiConfig={aiConfig}
            aiDraft={aiDraft}
            onAiDraftChange={setAiDraft}
            aiKeyDraft={aiKeyDraft}
            onAiKeyDraftChange={setAiKeyDraft}
            onSaveAiSettings={saveAiSettings}
            terminalPreferences={terminalPreferences}
            onTerminalPreferencesChange={updateTerminalPreferences}
            onResetTerminalPreferences={resetTerminalPreferences}
            t={t}
          />
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
        <AiInspector
          activeSessionLabel={activeSessionLabel}
          selectedContextMode={selectedContextMode}
          onSelectedContextModeChange={setSelectedContextMode}
          manualSelection={manualSelection}
          onManualSelectionChange={setManualSelection}
          aiQuestion={aiQuestion}
          onAiQuestionChange={setAiQuestion}
          onAskAi={askAi}
          isAiBusy={isAiBusy}
          hasActiveSession={Boolean(activeSessionId)}
          quickCommands={quickCommands}
          quickCommandDraft={quickCommandDraft}
          onQuickCommandDraftChange={setQuickCommandDraft}
          onAddQuickCommand={addQuickCommand}
          onDeleteQuickCommand={deleteQuickCommand}
          onQueueQuickCommand={queueQuickCommand}
          onFillTerminal={fillTerminal}
          contextPreview={contextPreview}
          contextPreviewRef={contextPreviewRef}
          activeSuggestions={activeSuggestions}
          activeSuggestionState={activeSuggestionState}
          onQueueSuggestion={(suggestion) => void queueSuggestion(suggestion)}
          riskLabel={riskLabel}
          activeQueue={activeQueue}
          onExecuteQueueItem={(item) => void executeQueueItem(item)}
          onCancelQueueItem={cancelQueueItem}
          t={t}
        />
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

export default App;
