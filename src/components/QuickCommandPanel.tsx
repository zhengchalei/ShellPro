import { Button, Card, Input, Label, TextField } from "@heroui/react";
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
    <Card className="quick-command-panel" variant="secondary">
      <Card.Header className="panel-title">
        <TerminalSquare size={16} />
        {t("quick.title")}
      </Card.Header>
      <Card.Content className="quick-command-panel-content">
        <form className="quick-command-form" onSubmit={onAdd}>
          <TextField>
            <Label>{t("quick.namePlaceholder")}</Label>
            <Input
              value={draft.title}
              onChange={(event) =>
                onDraftChange({ ...draft, title: event.currentTarget.value })
              }
            />
          </TextField>
          <TextField>
            <Label>{t("quick.commandPlaceholder")}</Label>
            <Input
              value={draft.command}
              onChange={(event) =>
                onDraftChange({ ...draft, command: event.currentTarget.value })
              }
            />
          </TextField>
          <TextField className="quick-command-note">
            <Label>{t("quick.notePlaceholder")}</Label>
            <Input
              value={draft.explanation}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  explanation: event.currentTarget.value,
                })
              }
            />
          </TextField>
          <Button size="sm" type="submit" variant="primary">
            <Plus size={13} />
            {t("quick.add")}
          </Button>
        </form>
        <div className="quick-command-grid">
          {templates.map((template) => (
            <Card className="quick-command" key={template.id} variant="default">
              <Card.Content className="quick-command-content">
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
                  <Button
                    isDisabled={disabled}
                    size="sm"
                    variant="outline"
                    onPress={() => void onFill(template.command)}
                  >
                    <Send size={13} />
                    {t("ai.fill")}
                  </Button>
                  <Button
                    isDisabled={disabled}
                    size="sm"
                    variant="outline"
                    onPress={() => void onQueue(template)}
                  >
                    <Check size={13} />
                    {t("ai.queue")}
                  </Button>
                  <Button
                    aria-label={t("ai.copyCommand")}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      void navigator.clipboard.writeText(template.command)
                    }
                  >
                    <Copy size={13} />
                  </Button>
                  {!template.builtin && (
                    <Button
                      aria-label={t("quick.delete")}
                      isIconOnly
                      size="sm"
                      variant="danger-soft"
                      onPress={() => onDelete(template.id)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </Card.Content>
            </Card>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}
