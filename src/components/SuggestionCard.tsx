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
