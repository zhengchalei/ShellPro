import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "en-US" | "zh-CN";

type Messages = Record<string, string>;

const storageKey = "shellpro.locale";

const enUS: Messages = {
  "app.ready": "ShellPro ready",
  "app.noActiveSession": "No active session",
  "app.localTerminalStarted": "Local terminal started",
  "app.connectionDeleted": "Connection deleted",
  "app.aiSettingsSaved": "AI settings saved",
  "app.connectionSaved": "Saved connection: {name}",
  "app.sshStarted": "SSH session started: {title}",
  "app.aiSuggested": "AI suggested {count} command(s)",
  "app.openTerminalFirst": "Open a terminal session before queueing commands.",
  "app.commandQueued": "Command added to execution list",
  "app.reconnectLater": "Reconnect is tracked for MVP 4",
  "app.deleteConfirm": "Delete {name}?",
  "app.thisConnection": "this connection",
  "app.highRiskConfirm":
    "High risk command:\n\n{command}\n\nSend it to the terminal?",
  "toolbar.toggleSidebar": "Toggle sidebar",
  "toolbar.local": "Local",
  "toolbar.ssh": "SSH",
  "toolbar.splitTerminal": "Split terminal",
  "toolbar.search": "Search",
  "toolbar.reconnect": "Reconnect active session",
  "toolbar.more": "More",
  "toolbar.toggleInspector": "Toggle AI inspector",
  "toolbar.settings": "Settings",
  "sidebar.searchConnections": "Search connections",
  "sidebar.workspace": "Workspace",
  "sidebar.connections": "Connections",
  "sidebar.settings": "Settings",
  "sidebar.favorites": "Favorites",
  "sidebar.noFavorites": "No favorites yet.",
  "sidebar.groups": "Groups",
  "workspace.startDescription":
    "Start with a local terminal, connect to SSH, or import profiles.",
  "workspace.newLocal": "New local terminal",
  "workspace.newSsh": "New SSH connection",
  "workspace.importConfig": "Import config",
  "connections.manager": "Connection Manager",
  "connections.sshProfiles": "SSH profiles",
  "connections.new": "New",
  "connections.connect": "Connect",
  "connections.edit": "Edit",
  "connections.delete": "Delete",
  "connections.noMatches": "No matching SSH profiles.",
  "profile.detail": "Profile detail",
  "profile.name": "Name",
  "profile.namePlaceholder": "Production API",
  "profile.host": "Host",
  "profile.hostPlaceholder": "example.com",
  "profile.port": "Port",
  "profile.username": "Username",
  "profile.usernamePlaceholder": "root",
  "profile.auth": "Auth",
  "profile.authAgent": "SSH agent",
  "profile.authPrivateKey": "Private key",
  "profile.authPassword": "Password",
  "profile.secret": "Secret",
  "profile.secretPlaceholder": "Stored in keychain",
  "profile.privateKeyPath": "Private key path",
  "profile.group": "Group",
  "profile.tags": "Tags",
  "profile.tagsPlaceholder": "prod, api",
  "profile.jumpHost": "Jump host profile id",
  "profile.favorite": "Add to favorites",
  "profile.save": "Save profile",
  "settings.preferences": "Preferences",
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.languageSystem": "System default",
  "settings.languageEn": "English",
  "settings.languageZh": "Simplified Chinese",
  "settings.aiProvider": "AI provider",
  "settings.baseUrl": "Base URL",
  "settings.model": "Model",
  "settings.apiKey": "API key",
  "settings.storedKeychain": "Stored in system keychain",
  "settings.notConfigured": "Not configured",
  "settings.context": "Context",
  "settings.selectedText": "Selected text",
  "settings.recentLines": "Recent lines",
  "settings.fullBuffer": "Full buffer",
  "settings.lines": "Lines",
  "settings.redactSecrets": "Redact secrets before AI requests",
  "settings.saveAi": "Save AI settings",
  "settings.terminal": "Terminal",
  "settings.font": "Font",
  "settings.scrollback": "Scrollback",
  "settings.theme": "Theme",
  "settings.followsSystem": "Follows system",
  "settings.security": "Security",
  "settings.credentials": "Credentials",
  "settings.systemKeychain": "System keychain",
  "settings.aiExecution": "AI execution",
  "settings.manualOnly": "Manual only",
  "settings.highRiskCommands": "High risk commands",
  "settings.confirmEveryTime": "Confirm every time",
  "ai.inspector": "AI Inspector",
  "ai.commandAdvisor": "Command advisor",
  "ai.manual": "Manual",
  "ai.recent": "Recent",
  "ai.selected": "Selected",
  "ai.pasteSelected": "Paste selected terminal text",
  "ai.askPlaceholder": "Ask what command should run next",
  "ai.suggestCommands": "Suggest commands",
  "ai.contextPreview": "AI context preview",
  "ai.openTerminalContext": "Open a terminal to collect context.",
  "ai.executionList": "Execution list",
  "ai.noQueued": "No queued commands.",
  "ai.execute": "Execute",
  "ai.cancel": "Cancel",
  "ai.queue": "Queue",
  "ai.fill": "Fill",
  "ai.copyCommand": "Copy command",
  "ai.flagSudo": "sudo",
  "ai.flagModifies": "modifies",
  "ai.flagDestructive": "destructive",
  "risk.low": "Low",
  "risk.medium": "Medium",
  "risk.high": "High",
  "session.local": "local",
  "session.ssh": "ssh",
  "session.connected": "connected",
  "session.connecting": "connecting",
  "session.disconnected": "disconnected",
  "session.error": "error",
  "terminal.bannerHint":
    "AI suggestions are queued here only after you click execute.",
  "terminal.disconnected": "Session disconnected.",
};

const zhCN: Messages = {
  "app.ready": "ShellPro 已就绪",
  "app.noActiveSession": "暂无活动会话",
  "app.localTerminalStarted": "本地终端已启动",
  "app.connectionDeleted": "连接已删除",
  "app.aiSettingsSaved": "AI 设置已保存",
  "app.connectionSaved": "已保存连接：{name}",
  "app.sshStarted": "SSH 会话已启动：{title}",
  "app.aiSuggested": "AI 已建议 {count} 条命令",
  "app.openTerminalFirst": "请先打开一个终端会话，再加入命令队列。",
  "app.commandQueued": "命令已加入执行列表",
  "app.reconnectLater": "重连能力将在 MVP 4 中完善",
  "app.deleteConfirm": "删除 {name}？",
  "app.thisConnection": "这个连接",
  "app.highRiskConfirm": "高风险命令：\n\n{command}\n\n要发送到终端吗？",
  "toolbar.toggleSidebar": "切换侧边栏",
  "toolbar.local": "本地",
  "toolbar.ssh": "SSH",
  "toolbar.splitTerminal": "分屏终端",
  "toolbar.search": "搜索",
  "toolbar.reconnect": "重连当前会话",
  "toolbar.more": "更多",
  "toolbar.toggleInspector": "切换 AI 面板",
  "toolbar.settings": "设置",
  "sidebar.searchConnections": "搜索连接",
  "sidebar.workspace": "工作台",
  "sidebar.connections": "连接",
  "sidebar.settings": "设置",
  "sidebar.favorites": "收藏",
  "sidebar.noFavorites": "暂无收藏。",
  "sidebar.groups": "分组",
  "workspace.startDescription": "新建本地终端、连接 SSH，或导入配置。",
  "workspace.newLocal": "新建本地终端",
  "workspace.newSsh": "新建 SSH 连接",
  "workspace.importConfig": "导入配置",
  "connections.manager": "连接管理",
  "connections.sshProfiles": "SSH 配置",
  "connections.new": "新建",
  "connections.connect": "连接",
  "connections.edit": "编辑",
  "connections.delete": "删除",
  "connections.noMatches": "没有匹配的 SSH 配置。",
  "profile.detail": "配置详情",
  "profile.name": "名称",
  "profile.namePlaceholder": "生产 API",
  "profile.host": "主机",
  "profile.hostPlaceholder": "example.com",
  "profile.port": "端口",
  "profile.username": "用户名",
  "profile.usernamePlaceholder": "root",
  "profile.auth": "认证",
  "profile.authAgent": "SSH agent",
  "profile.authPrivateKey": "私钥",
  "profile.authPassword": "密码",
  "profile.secret": "密钥/密码",
  "profile.secretPlaceholder": "保存到系统钥匙串",
  "profile.privateKeyPath": "私钥路径",
  "profile.group": "分组",
  "profile.tags": "标签",
  "profile.tagsPlaceholder": "生产, API",
  "profile.jumpHost": "跳板机配置 ID",
  "profile.favorite": "加入收藏",
  "profile.save": "保存配置",
  "settings.preferences": "偏好设置",
  "settings.title": "设置",
  "settings.language": "语言",
  "settings.languageSystem": "跟随系统",
  "settings.languageEn": "English",
  "settings.languageZh": "简体中文",
  "settings.aiProvider": "AI 服务",
  "settings.baseUrl": "Base URL",
  "settings.model": "模型",
  "settings.apiKey": "API Key",
  "settings.storedKeychain": "已保存到系统钥匙串",
  "settings.notConfigured": "未配置",
  "settings.context": "上下文",
  "settings.selectedText": "选中文本",
  "settings.recentLines": "最近行",
  "settings.fullBuffer": "完整缓冲区",
  "settings.lines": "行数",
  "settings.redactSecrets": "发送给 AI 前脱敏",
  "settings.saveAi": "保存 AI 设置",
  "settings.terminal": "终端",
  "settings.font": "字体",
  "settings.scrollback": "滚动缓冲",
  "settings.theme": "主题",
  "settings.followsSystem": "跟随系统",
  "settings.security": "安全",
  "settings.credentials": "凭据",
  "settings.systemKeychain": "系统钥匙串",
  "settings.aiExecution": "AI 执行",
  "settings.manualOnly": "仅手动",
  "settings.highRiskCommands": "高风险命令",
  "settings.confirmEveryTime": "每次确认",
  "ai.inspector": "AI 面板",
  "ai.commandAdvisor": "命令建议",
  "ai.manual": "手动",
  "ai.recent": "最近",
  "ai.selected": "选中",
  "ai.pasteSelected": "粘贴选中的终端文本",
  "ai.askPlaceholder": "询问下一步应该执行什么命令",
  "ai.suggestCommands": "生成命令建议",
  "ai.contextPreview": "AI 上下文预览",
  "ai.openTerminalContext": "打开终端后会收集上下文。",
  "ai.executionList": "执行列表",
  "ai.noQueued": "暂无待执行命令。",
  "ai.execute": "执行",
  "ai.cancel": "取消",
  "ai.queue": "加入队列",
  "ai.fill": "填入",
  "ai.copyCommand": "复制命令",
  "ai.flagSudo": "sudo",
  "ai.flagModifies": "修改",
  "ai.flagDestructive": "破坏性",
  "risk.low": "低",
  "risk.medium": "中",
  "risk.high": "高",
  "session.local": "本地",
  "session.ssh": "SSH",
  "session.connected": "已连接",
  "session.connecting": "连接中",
  "session.disconnected": "已断开",
  "session.error": "错误",
  "terminal.bannerHint": "AI 建议只会在你点击执行后进入这里。",
  "terminal.disconnected": "会话已断开。",
};

const dictionaries: Record<Locale, Messages> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function detectLocale(): Locale {
  const stored = localStorage.getItem(storageKey);
  if (stored === "en-US" || stored === "zh-CN") {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function format(message: string, values?: Record<string, string | number>) {
  if (!values) {
    return message;
  }
  return Object.entries(values).reduce(
    (current, [key, value]) =>
      current.split(`{${key}}`).join(String(value)),
    message,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(storageKey, locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
  }, []);

  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      const message = dictionaries[locale][key] ?? enUS[key] ?? key;
      return format(message, values);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
