import { Download, Server, Settings, TerminalSquare } from "lucide-react";
import type { ConnectionProfile } from "../types";

export function ConnectionRow({
  profile,
  onConnect,
  onEdit,
  t,
}: {
  profile: ConnectionProfile;
  onConnect: () => void;
  onEdit: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="connection-row">
      <button onClick={onConnect}>
        <Server size={15} />
        <span>{profile.name}</span>
      </button>
      <button
        className="icon-button compact"
        title={t("connections.edit")}
        onClick={onEdit}
      >
        <Settings size={13} />
      </button>
    </div>
  );
}

export function ShellProLogo({
  size = "normal",
}: {
  size?: "compact" | "normal" | "large";
}) {
  return (
    <span className={`logo-mark ${size}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <rect className="logo-shell" x="7" y="9" width="50" height="46" rx="10" />
        <path className="logo-window" d="M14 20h36" />
        <path className="logo-prompt" d="M18 33l7 6-7 6" />
        <path className="logo-cursor" d="M31 45h12" />
        <path className="logo-bolt" d="M39 16 30 34h10l-6 15 17-25H40l6-8Z" />
      </svg>
    </span>
  );
}

export function EmptyWorkspace({
  onLocal,
  onSsh,
  onImport,
  t,
}: {
  onLocal: () => void;
  onSsh: () => void;
  onImport: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="empty-workspace">
      <ShellProLogo size="large" />
      <h1>ShellPro</h1>
      <p>{t("workspace.startDescription")}</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={onLocal}>
          <TerminalSquare size={17} />
          {t("workspace.newLocal")}
        </button>
        <button className="secondary-button" onClick={onSsh}>
          <Server size={17} />
          {t("workspace.newSsh")}
        </button>
        <button className="secondary-button" onClick={onImport}>
          <Download size={17} />
          {t("workspace.importConfig")}
        </button>
      </div>
    </div>
  );
}
