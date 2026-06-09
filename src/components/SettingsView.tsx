import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import {
  Bot,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import type { FormEvent, Key } from "react";
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
  function updateContextMode(key: Key | null) {
    onAiDraftChange({
      ...aiDraft,
      contextMode: String(key || "selected") as ContextMode,
    });
  }

  function updateTerminalTheme(key: Key | null) {
    onTerminalPreferencesChange({
      theme: String(key || "dark") as TerminalTheme,
    });
  }

  return (
    <section className="management-view settings-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">{t("settings.preferences")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </div>
      <div className="settings-grid">
        <Card className="settings-panel" variant="secondary">
          <Card.Header className="panel-title">
            <Settings size={17} />
            {t("settings.language")}
          </Card.Header>
          <Card.Content className="settings-panel-content">
            <Select
              selectedKey={locale}
              onSelectionChange={(key) =>
                onLocaleChange(String(key || "en-US") as Locale)
              }
              fullWidth
            >
              <Label>{t("settings.language")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="en-US">
                    {t("settings.languageEn")}
                  </ListBox.Item>
                  <ListBox.Item id="zh-CN">
                    {t("settings.languageZh")}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </Card.Content>
        </Card>

        <Card className="settings-panel" variant="secondary">
          <Card.Header className="panel-title">
            <Bot size={17} />
            {t("settings.aiProvider")}
          </Card.Header>
          <Card.Content>
            <form className="settings-panel-content" onSubmit={onSaveAiSettings}>
              <TextField fullWidth>
                <Label>{t("profile.name")}</Label>
                <Input
                  value={aiDraft.name}
                  onChange={(event) =>
                    onAiDraftChange({
                      ...aiDraft,
                      name: event.currentTarget.value,
                    })
                  }
                />
              </TextField>
              <TextField fullWidth>
                <Label>{t("settings.baseUrl")}</Label>
                <Input
                  value={aiDraft.baseUrl}
                  onChange={(event) =>
                    onAiDraftChange({
                      ...aiDraft,
                      baseUrl: event.currentTarget.value,
                    })
                  }
                />
              </TextField>
              <TextField fullWidth>
                <Label>{t("settings.model")}</Label>
                <Input
                  value={aiDraft.model}
                  onChange={(event) =>
                    onAiDraftChange({
                      ...aiDraft,
                      model: event.currentTarget.value,
                    })
                  }
                />
              </TextField>
              <TextField fullWidth>
                <Label>{t("settings.apiKey")}</Label>
                <Input
                  type="password"
                  value={aiKeyDraft}
                  placeholder={
                    aiConfig?.apiKeySecretRef
                      ? t("settings.storedKeychain")
                      : t("settings.notConfigured")
                  }
                  onChange={(event) =>
                    onAiKeyDraftChange(event.currentTarget.value)
                  }
                />
              </TextField>
              <div className="split-fields">
                <Select
                  selectedKey={aiDraft.contextMode}
                  onSelectionChange={updateContextMode}
                  fullWidth
                >
                  <Label>{t("settings.context")}</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="selected">
                        {t("settings.selectedText")}
                      </ListBox.Item>
                      <ListBox.Item id="recentLines">
                        {t("settings.recentLines")}
                      </ListBox.Item>
                      <ListBox.Item id="fullBuffer">
                        {t("settings.fullBuffer")}
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <TextField fullWidth>
                  <Label>{t("settings.lines")}</Label>
                  <Input
                    type="number"
                    min={20}
                    max={5000}
                    value={String(aiDraft.recentLineLimit)}
                    onChange={(event) =>
                      onAiDraftChange({
                        ...aiDraft,
                        recentLineLimit: Number(event.currentTarget.value),
                      })
                    }
                  />
                </TextField>
              </div>
              <Checkbox
                isSelected={aiDraft.redactSecrets}
                onChange={(redactSecrets) =>
                  onAiDraftChange({
                    ...aiDraft,
                    redactSecrets,
                  })
                }
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>{t("settings.redactSecrets")}</Checkbox.Content>
              </Checkbox>
              <Button type="submit" variant="primary">
                <Save size={16} />
                {t("settings.saveAi")}
              </Button>
            </form>
          </Card.Content>
        </Card>

        <Card className="settings-panel" variant="secondary">
          <Card.Header className="panel-title">
            <TerminalSquare size={17} />
            {t("settings.terminal")}
          </Card.Header>
          <Card.Content className="settings-panel-content">
            <Select
              selectedKey={terminalPreferences.fontFamily}
              onSelectionChange={(key) =>
                onTerminalPreferencesChange({
                  fontFamily: String(key || terminalFontOptions[0]?.value || ""),
                })
              }
              fullWidth
            >
              <Label>{t("settings.font")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {terminalFontOptions.map((option) => (
                    <ListBox.Item key={option.value} id={option.value}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <div className="split-fields">
              <TextField fullWidth>
                <Label>{t("settings.fontSize")}</Label>
                <Input
                  type="number"
                  min={10}
                  max={22}
                  value={String(terminalPreferences.fontSize)}
                  onChange={(event) =>
                    onTerminalPreferencesChange({
                      fontSize: Number(event.currentTarget.value),
                    })
                  }
                />
              </TextField>
              <TextField fullWidth>
                <Label>{t("settings.scrollback")}</Label>
                <Input
                  type="number"
                  min={1000}
                  max={50000}
                  step={1000}
                  value={String(terminalPreferences.scrollback)}
                  onChange={(event) =>
                    onTerminalPreferencesChange({
                      scrollback: Number(event.currentTarget.value),
                    })
                  }
                />
              </TextField>
            </div>
            <Select
              selectedKey={terminalPreferences.theme}
              onSelectionChange={updateTerminalTheme}
              fullWidth
            >
              <Label>{t("settings.theme")}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="system">
                    {t("settings.followsSystem")}
                  </ListBox.Item>
                  <ListBox.Item id="dark">{t("settings.themeDark")}</ListBox.Item>
                  <ListBox.Item id="light">
                    {t("settings.themeLight")}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              type="button"
              variant="outline"
              onPress={onResetTerminalPreferences}
            >
              <RefreshCcw size={16} />
              {t("settings.restoreTerminalDefaults")}
            </Button>
          </Card.Content>
        </Card>

        <Card className="settings-panel" variant="secondary">
          <Card.Header className="panel-title">
            <ShieldCheck size={17} />
            {t("settings.security")}
          </Card.Header>
          <Card.Content className="settings-panel-content">
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
          </Card.Content>
        </Card>
      </div>
    </section>
  );
}
