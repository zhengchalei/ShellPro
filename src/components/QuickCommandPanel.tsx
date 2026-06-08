import { Check, Copy, Plus, Send, TerminalSquare, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import type { QuickCommandTemplate } from "../appTypes";

export function QuickCommandPanel({
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
