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

      <form className="ai-form" onSubmit={onAskAi}>
        <div className="segmented">
          <button
            type="button"
            className={selectedContextMode === "recent" ? "active" : ""}
            onClick={() => onSelectedContextModeChange("recent")}
          >
            {t("ai.recent")}
          </button>
          <button
            type="button"
            className={selectedContextMode === "selected" ? "active" : ""}
            onClick={() => onSelectedContextModeChange("selected")}
          >
            {t("ai.selected")}
          </button>
        </div>
        {selectedContextMode === "selected" && (
          <textarea
            className="context-input"
            value={manualSelection}
            onChange={(event) =>
              onManualSelectionChange(event.currentTarget.value)
            }
            placeholder={t("ai.pasteSelected")}
          />
        )}
        <textarea
          value={aiQuestion}
          onChange={(event) => onAiQuestionChange(event.currentTarget.value)}
          placeholder={t("ai.askPlaceholder")}
        />
        <button
          className="primary-button"
          type="submit"
          disabled={isAiBusy || !hasActiveSession}
        >
          {isAiBusy ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />}
          {t("ai.suggestCommands")}
        </button>
      </form>

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
            onQueue={() => onQueueSuggestion(item)}
            onFill={() => void onFillTerminal(item.command)}
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
                onClick={() => onExecuteQueueItem(item)}
              >
                <Play size={13} />
                {t("ai.execute")}
              </button>
              <button
                className="icon-button"
                title={t("ai.cancel")}
                onClick={() => onCancelQueueItem(item.id)}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
