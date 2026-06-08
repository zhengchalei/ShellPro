import { Server, ShieldCheck, TerminalSquare } from "lucide-react";
import type { TerminalLayout } from "../appTypes";
import type { TerminalSession } from "../types";

export function SessionOverview({
  sessions,
  activeSessionId,
  terminalLayout,
  connectedCount,
  visibleCount,
  onSelect,
  onLayoutChange,
  t,
}: {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  terminalLayout: TerminalLayout;
  connectedCount: number;
  visibleCount: number;
  onSelect: (sessionId: string) => void;
  onLayoutChange: (layout: TerminalLayout) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const sshCount = sessions.filter((session) => session.kind === "ssh").length;

  return (
    <div className="session-overview">
      <div className="session-metrics">
        <div className="session-metric">
          <TerminalSquare size={15} />
          <strong>{sessions.length}</strong>
          <span>{t("workspace.sessions")}</span>
        </div>
        <div className="session-metric">
          <ShieldCheck size={15} />
          <strong>{connectedCount}</strong>
          <span>{t("workspace.connected")}</span>
        </div>
        <div className="session-metric">
          <Server size={15} />
          <strong>{sshCount}</strong>
          <span>{t("workspace.sshSessions")}</span>
        </div>
      </div>

      <div className="session-overview-main">
        <span className={`status-dot ${activeSession.status}`} />
        <div>
          <strong>{activeSession.title}</strong>
          <span>
            {t(`session.${activeSession.kind}`)} ·{" "}
            {t(`session.${activeSession.status}`)}
          </span>
        </div>
      </div>

      <div className="session-pickers">
        <select
          value={activeSession.id}
          onChange={(event) => onSelect(event.currentTarget.value)}
          title={t("workspace.activeSession")}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </select>
        <div className="layout-switch" aria-label={t("workspace.layout")}>
          {(["single", "split", "grid"] as TerminalLayout[]).map((layout) => (
            <button
              key={layout}
              className={terminalLayout === layout ? "active" : ""}
              type="button"
              title={t(`layout.${layout}`)}
              onClick={() => onLayoutChange(layout)}
            >
              {layout === "single" ? "1" : layout === "split" ? "2" : "4"}
            </button>
          ))}
        </div>
        <span className="visible-pane-count">
          {t("workspace.visiblePanes", { count: visibleCount })}
        </span>
      </div>
    </div>
  );
}
