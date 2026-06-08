import {
  FileKey2,
  FolderTree,
  Loader2,
  Save,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { tagsToText, textToTags } from "../appState";
import type { ConnectionProfile, ConnectionProfileInput } from "../types";

export function ProfileEditor({
  draft,
  profiles,
  secretDraft,
  setSecretDraft,
  onChange,
  onSubmit,
  onCancel,
  onTest,
  isEditing,
  isTesting,
  t,
}: {
  draft: ConnectionProfileInput;
  profiles: ConnectionProfile[];
  secretDraft: string;
  setSecretDraft: (value: string) => void;
  onChange: (draft: ConnectionProfileInput) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onTest: () => void;
  isEditing: boolean;
  isTesting: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const showPrivateKey = draft.authType === "privateKey";
  const showSecret = draft.authType !== "agent";
  const secretLabel =
    draft.authType === "password"
      ? t("profile.password")
      : t("profile.passphrase");
  const jumpHostOptions = profiles.filter((profile) => profile.id !== draft.id);

  return (
    <form className="profile-editor" onSubmit={onSubmit}>
      <div className="profile-editor-head">
        <div>
          <p className="eyebrow">{t("profile.detail")}</p>
          <h2 id="profile-dialog-title">
            {isEditing ? t("profile.editTitle") : t("profile.createTitle")}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t("profile.cancel")}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>

      <section className="form-section">
        <div className="panel-title">
          <Server size={17} />
          {t("profile.basicSection")}
        </div>
        <label>
          {t("profile.name")}
          <input
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
            placeholder={t("profile.namePlaceholder")}
          />
        </label>
        <div className="form-grid host-grid">
          <label>
            {t("profile.host")}
            <input
              value={draft.host}
              onChange={(event) =>
                onChange({ ...draft, host: event.currentTarget.value })
              }
              placeholder={t("profile.hostPlaceholder")}
            />
          </label>
          <label>
            {t("profile.port")}
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) =>
                onChange({ ...draft, port: Number(event.currentTarget.value) })
              }
            />
          </label>
        </div>
        <label>
          {t("profile.username")}
          <input
            value={draft.username}
            onChange={(event) =>
              onChange({ ...draft, username: event.currentTarget.value })
            }
            placeholder={t("profile.usernamePlaceholder")}
          />
        </label>
      </section>

      <section className="form-section">
        <div className="panel-title">
          <FileKey2 size={17} />
          {t("profile.authSection")}
        </div>
        <label>
          {t("profile.auth")}
          <select
            value={draft.authType}
            onChange={(event) => {
              const authType = event.currentTarget
                .value as ConnectionProfile["authType"];
              onChange({
                ...draft,
                authType,
                privateKeyPath:
                  authType === "privateKey" ? draft.privateKeyPath : "",
              });
              if (authType === "agent") {
                setSecretDraft("");
              }
            }}
          >
            <option value="agent">{t("profile.authAgent")}</option>
            <option value="privateKey">{t("profile.authPrivateKey")}</option>
            <option value="password">{t("profile.authPassword")}</option>
          </select>
          <small>{t("profile.authHelp")}</small>
        </label>
        {showPrivateKey && (
          <label>
            {t("profile.privateKeyPath")}
            <input
              value={draft.privateKeyPath ?? ""}
              onChange={(event) =>
                onChange({ ...draft, privateKeyPath: event.currentTarget.value })
              }
              placeholder={t("profile.privateKeyPlaceholder")}
            />
          </label>
        )}
        {showSecret && (
          <label>
            {secretLabel}
            <input
              type="password"
              value={secretDraft}
              placeholder={t("profile.secretPlaceholder")}
              onChange={(event) => setSecretDraft(event.currentTarget.value)}
            />
            <small>{t("profile.secretSavedHint")}</small>
          </label>
        )}
      </section>

      <section className="form-section">
        <div className="panel-title">
          <FolderTree size={17} />
          {t("profile.organizeSection")}
        </div>
        <div className="form-grid">
          <label>
            {t("profile.group")}
            <input
              value={draft.groupId ?? ""}
              onChange={(event) =>
                onChange({ ...draft, groupId: event.currentTarget.value })
              }
              placeholder={t("profile.groupPlaceholder")}
            />
          </label>
          <label>
            {t("profile.tags")}
            <input
              value={tagsToText(draft.tags)}
              onChange={(event) =>
                onChange({ ...draft, tags: textToTags(event.currentTarget.value) })
              }
              placeholder={t("profile.tagsPlaceholder")}
            />
          </label>
        </div>
        <label>
          {t("profile.jumpHost")}
          <select
            value={draft.jumpHostId ?? ""}
            onChange={(event) =>
              onChange({ ...draft, jumpHostId: event.currentTarget.value })
            }
          >
            <option value="">{t("profile.noJumpHost")}</option>
            {jumpHostOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.username}@{profile.host}:{profile.port}
              </option>
            ))}
          </select>
          <small>{t("profile.jumpHostHelp")}</small>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) =>
              onChange({ ...draft, favorite: event.currentTarget.checked })
            }
          />
          <span>{t("profile.favorite")}</span>
          <small>{t("profile.favoriteHelp")}</small>
        </label>
      </section>

      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          {t("profile.cancel")}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={isTesting}
          onClick={onTest}
        >
          {isTesting ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          {t("profile.test")}
        </button>
        <button className="primary-button" type="submit">
          <Save size={16} />
          {t("profile.save")}
        </button>
      </div>
    </form>
  );
}
