import {
  Bot,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import type { FormEvent } from "react";
import { terminalFontOptions } from "../appState";
import type { Locale } from "../i18n";
import type {
  AiProviderConfig,
  ContextMode,
  TerminalPreferences,
  TerminalTheme,
} from "../types";

export type AiSettingsDraft = {
  name: string;
  baseUrl: string;
  model: string;
  contextMode: ContextMode;
  recentLineLimit: number;
  redactSecrets: boolean;
};

export function SettingsView({
  locale,
  onLocaleChange,
  aiConfig,
  aiDraft,
  onAiDraftChange,
  aiKeyDraft,
  onAiKeyDraftChange,
  onSaveAiSettings,
  terminalPreferences,
  onTerminalPreferencesChange,
  onResetTerminalPreferences,
  t,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  aiConfig: AiProviderConfig | null;
  aiDraft: AiSettingsDraft;
  onAiDraftChange: (draft: AiSettingsDraft) => void;
  aiKeyDraft: string;
  onAiKeyDraftChange: (value: string) => void;
  onSaveAiSettings: (event: FormEvent) => void;
  terminalPreferences: TerminalPreferences;
  onTerminalPreferencesChange: (update: Partial<TerminalPreferences>) => void;
  onResetTerminalPreferences: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
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
                onLocaleChange(event.currentTarget.value as Locale)
              }
            >
              <option value="en-US">{t("settings.languageEn")}</option>
              <option value="zh-CN">{t("settings.languageZh")}</option>
            </select>
          </label>
        </div>

        <form className="settings-panel" onSubmit={onSaveAiSettings}>
          <div className="panel-title">
            <Bot size={17} />
            {t("settings.aiProvider")}
          </div>
          <label>
            {t("profile.name")}
            <input
              value={aiDraft.name}
              onChange={(event) =>
                onAiDraftChange({
                  ...aiDraft,
                  name: event.currentTarget.value,
                })
              }
            />
          </label>
          <label>
            {t("settings.baseUrl")}
            <input
              value={aiDraft.baseUrl}
              onChange={(event) =>
                onAiDraftChange({
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
                onAiDraftChange({
                  ...aiDraft,
                  model: event.currentTarget.value,
                })
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
              onChange={(event) => onAiKeyDraftChange(event.currentTarget.value)}
            />
          </label>
          <div className="split-fields">
            <label>
              {t("settings.context")}
              <select
                value={aiDraft.contextMode}
                onChange={(event) =>
                  onAiDraftChange({
                    ...aiDraft,
                    contextMode: event.currentTarget.value as ContextMode,
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
                  onAiDraftChange({
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
                onAiDraftChange({
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
                onTerminalPreferencesChange({
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
                  onTerminalPreferencesChange({
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
                  onTerminalPreferencesChange({
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
                onTerminalPreferencesChange({
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
            onClick={onResetTerminalPreferences}
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
  );
}
