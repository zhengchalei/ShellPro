import { Button, Card, TextArea } from "@heroui/react";
import {
  Loader2,
  Play,
  Send,
  ShieldAlert,
  ShieldCheck,
  Wand2,
  X,
} from "lucide-react";
import type { FormEvent, RefObject } from "react";
import type {
  QuickCommandTemplate,
  SuggestionState,
} from "../appTypes";
import type {
  AiCommandSuggestion,
  CommandQueueItem,
  RiskLevel,
} from "../types";
import { QuickCommandPanel } from "./QuickCommandPanel";
import { SuggestionCard } from "./SuggestionCard";

export type AiInspectorContextMode = "recent" | "selected";

export function AiInspector({
  activeSessionLabel,
  selectedContextMode,
  onSelectedContextModeChange,
  manualSelection,
  onManualSelectionChange,
  aiQuestion,
  onAiQuestionChange,
  onAskAi,
  isAiBusy,
  hasActiveSession,
  quickCommands,
  quickCommandDraft,
  onQuickCommandDraftChange,
  onAddQuickCommand,
  onDeleteQuickCommand,
  onQueueQuickCommand,
  onFillTerminal,
  contextPreview,
  contextPreviewRef,
  activeSuggestions,
  activeSuggestionState,
  onQueueSuggestion,
  riskLabel,
  activeQueue,
  onExecuteQueueItem,
  onCancelQueueItem,
  t,
}: {
  activeSessionLabel: string;
  selectedContextMode: AiInspectorContextMode;
  onSelectedContextModeChange: (mode: AiInspectorContextMode) => void;
  manualSelection: string;
  onManualSelectionChange: (value: string) => void;
  aiQuestion: string;
  onAiQuestionChange: (value: string) => void;
  onAskAi: (event: FormEvent) => void;
  isAiBusy: boolean;
  hasActiveSession: boolean;
  quickCommands: QuickCommandTemplate[];
  quickCommandDraft: { title: string; command: string; explanation: string };
  onQuickCommandDraftChange: (draft: {
    title: string;
    command: string;
    explanation: string;
  }) => void;
  onAddQuickCommand: (event: FormEvent) => void;
  onDeleteQuickCommand: (commandId: string) => void;
  onQueueQuickCommand: (template: QuickCommandTemplate) => Promise<void>;
  onFillTerminal: (command: string) => Promise<void>;
  contextPreview: string;
  contextPreviewRef: RefObject<HTMLPreElement | null>;
  activeSuggestions: AiCommandSuggestion[];
  activeSuggestionState: SuggestionState;
  onQueueSuggestion: (suggestion: AiCommandSuggestion) => void;
  riskLabel: Record<RiskLevel, string>;
  activeQueue: CommandQueueItem[];
  onExecuteQueueItem: (item: CommandQueueItem) => void;
  onCancelQueueItem: (itemId: string) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
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

      <Card className="ai-form-card" variant="secondary">
        <Card.Content>
          <form className="ai-form" onSubmit={onAskAi}>
            <div className="segmented">
              <Button
                size="sm"
                type="button"
                variant={selectedContextMode === "recent" ? "primary" : "ghost"}
                onPress={() => onSelectedContextModeChange("recent")}
              >
                {t("ai.recent")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant={selectedContextMode === "selected" ? "primary" : "ghost"}
                onPress={() => onSelectedContextModeChange("selected")}
              >
                {t("ai.selected")}
              </Button>
            </div>
            {selectedContextMode === "selected" && (
              <TextArea
                aria-label={t("ai.pasteSelected")}
                className="context-input"
                value={manualSelection}
                onChange={(event) =>
                  onManualSelectionChange(event.currentTarget.value)
                }
                placeholder={t("ai.pasteSelected")}
              />
            )}
            <TextArea
              aria-label={t("ai.askPlaceholder")}
              value={aiQuestion}
              onChange={(event) => onAiQuestionChange(event.currentTarget.value)}
              placeholder={t("ai.askPlaceholder")}
            />
            <Button
              isDisabled={isAiBusy || !hasActiveSession}
              type="submit"
              variant="primary"
            >
              {isAiBusy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Wand2 size={16} />
              )}
              {t("ai.suggestCommands")}
            </Button>
          </form>
        </Card.Content>
      </Card>

      <QuickCommandPanel
        templates={quickCommands}
        disabled={!hasActiveSession}
        draft={quickCommandDraft}
        onDraftChange={onQuickCommandDraftChange}
        onAdd={onAddQuickCommand}
        onDelete={onDeleteQuickCommand}
        onQueue={onQueueQuickCommand}
        onFill={onFillTerminal}
        t={t}
      />

      <Card className="context-preview" variant="secondary">
        <Card.Header className="panel-title">
          <ShieldAlert size={16} />
          {t("ai.contextPreview")}
        </Card.Header>
        <Card.Content>
          <pre ref={contextPreviewRef}>
            {contextPreview || t("ai.openTerminalContext")}
          </pre>
        </Card.Content>
      </Card>

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
            onQueue={() => onQueueSuggestion(item)}
            onFill={() => void onFillTerminal(item.command)}
            t={t}
            riskLabel={riskLabel}
          />
        ))}
      </div>

      <Card className="queue-list-card" variant="secondary">
        <Card.Header className="panel-title">
          <Send size={16} />
          {t("ai.executionList")}
        </Card.Header>
        <Card.Content className="queue-list">
          {activeQueue.length === 0 && (
            <p className="muted">{t("ai.noQueued")}</p>
          )}
          {activeQueue.map((item) => (
            <Card className="queue-item" key={item.id} variant="default">
              <Card.Content className="queue-item-content">
                <code>{item.command}</code>
                <span className={`risk ${item.riskLevel}`}>
                  {riskLabel[item.riskLevel]}
                </span>
                <div className="queue-actions">
                  <Button
                    isDisabled={item.status !== "pending"}
                    size="sm"
                    variant="outline"
                    onPress={() => onExecuteQueueItem(item)}
                  >
                    <Play size={13} />
                    {t("ai.execute")}
                  </Button>
                  <Button
                    aria-label={t("ai.cancel")}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => onCancelQueueItem(item.id)}
                  >
                    <X size={13} />
                  </Button>
                </div>
              </Card.Content>
            </Card>
          ))}
        </Card.Content>
      </Card>
    </aside>
  );
}
