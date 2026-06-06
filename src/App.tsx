import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileKey2,
  FolderTree,
  Laptop,
  PanelRight,
  Loader2,
  MoreHorizontal,
  PanelLeft,
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
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./types";

type ViewMode = "workspace" | "connections" | "settings";

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

function App() {
  const { locale, setLocale, t } = useI18n();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>(
    {},
  );
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  const [profileDraft, setProfileDraft] =
    useState<ConnectionProfileInput>(emptyProfile);
  const [aiQuestion, setAiQuestion] = useState("");
  const [suggestions, setSuggestions] = useState<AiCommandSuggestion[]>([]);
  const [queue, setQueue] = useState<CommandQueueItem[]>([]);
  const [contextPreview, setContextPreview] = useState("");
  const [selectedContextMode, setSelectedContextMode] = useState<
    "recent" | "selected"
  >("recent");
  const [manualSelection, setManualSelection] = useState("");
  const [statusMessage, setStatusMessage] = useState(t("app.ready"));
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [aiKeyDraft, setAiKeyDraft] = useState("");
  const contextPreviewRef = useRef<HTMLPreElement | null>(null);
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

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

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
      setProfileDraft(emptyProfile);
      setStatusMessage(t("app.connectionSaved", { name: saved.name }));
    } catch (error) {
      setStatusMessage(String(error));
    }
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
    setIsAiBusy(true);
    try {
      const context =
        selectedContextMode === "selected" && manualSelection.trim()
          ? manualSelection
          : activeBuffer.split(/\r?\n/).slice(-200).join("\n");
      const result = await shellProApi.askAiForCommands({
        question: aiQuestion,
        context,
        selectedText: manualSelection || undefined,
        os: navigator.platform,
        shell: activeSession?.shell ?? undefined,
        cwd: activeSession?.cwd ?? undefined,
      });
      setSuggestions(result);
      setStatusMessage(t("app.aiSuggested", { count: result.length }));
    } catch (error) {
      setStatusMessage(String(error));
    } finally {
      setIsAiBusy(false);
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
            <TerminalSquare size={18} />
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
                onClick={() => setProfileDraft(emptyProfile)}
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
                      <span>
                        {profile.username}@{profile.host}:{profile.port}
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
              <ProfileEditor
                draft={profileDraft}
                secretDraft={secretDraft}
                setSecretDraft={setSecretDraft}
                onChange={setProfileDraft}
                onSubmit={saveProfile}
                t={t}
              />
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

      {isInspectorVisible && (
        <aside className="inspector">
          <div className="inspector-header">
            <div>
              <p className="eyebrow">{t("ai.inspector")}</p>
              <h2>{t("ai.commandAdvisor")}</h2>
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
            <button className="primary-button" type="submit" disabled={isAiBusy}>
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
            {suggestions.map((item) => (
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
            {queue.length === 0 && <p className="muted">{t("ai.noQueued")}</p>}
            {queue.map((item) => (
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
      <TerminalSquare size={42} />
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
  t,
}: {
  draft: ConnectionProfileInput;
  secretDraft: string;
  setSecretDraft: (value: string) => void;
  onChange: (draft: ConnectionProfileInput) => void;
  onSubmit: (event: FormEvent) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <form className="profile-editor" onSubmit={onSubmit}>
      <div className="panel-title">
        <FileKey2 size={17} />
        {t("profile.detail")}
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
      <div className="split-fields">
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
      <div className="split-fields">
        <label>
          {t("profile.auth")}
          <select
            value={draft.authType}
            onChange={(event) =>
              onChange({
                ...draft,
                authType: event.currentTarget.value as ConnectionProfile["authType"],
              })
            }
          >
            <option value="agent">{t("profile.authAgent")}</option>
            <option value="privateKey">{t("profile.authPrivateKey")}</option>
            <option value="password">{t("profile.authPassword")}</option>
          </select>
        </label>
        <label>
          {t("profile.secret")}
          <input
            type="password"
            value={secretDraft}
            placeholder={t("profile.secretPlaceholder")}
            onChange={(event) => setSecretDraft(event.currentTarget.value)}
          />
        </label>
      </div>
      <label>
        {t("profile.privateKeyPath")}
        <input
          value={draft.privateKeyPath ?? ""}
          onChange={(event) =>
            onChange({ ...draft, privateKeyPath: event.currentTarget.value })
          }
          placeholder="~/.ssh/id_ed25519"
        />
      </label>
      <div className="split-fields">
        <label>
          {t("profile.group")}
          <input
            value={draft.groupId ?? ""}
            onChange={(event) =>
              onChange({ ...draft, groupId: event.currentTarget.value })
            }
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
        {t("profile.favorite")}
      </label>
      <button className="primary-button" type="submit">
        <Save size={16} />
        {t("profile.save")}
      </button>
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
