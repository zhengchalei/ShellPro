import { Button, Card } from "@heroui/react";
import { Check, Copy, Send } from "lucide-react";
import type { AiCommandSuggestion, RiskLevel } from "../types";

export function SuggestionCard({
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
    <Card className="suggestion-card" variant="secondary">
      <Card.Content className="suggestion-card-content">
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
          <Button size="sm" variant="outline" onPress={onQueue}>
            <Check size={13} />
            {t("ai.queue")}
          </Button>
          <Button size="sm" variant="outline" onPress={onFill}>
            <Send size={13} />
            {t("ai.fill")}
          </Button>
          <Button
            aria-label={t("ai.copyCommand")}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => void navigator.clipboard.writeText(suggestion.command)}
          >
            <Copy size={13} />
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
