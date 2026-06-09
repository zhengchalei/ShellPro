import {
  Button,
  Card,
  Checkbox,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import {
  FileKey2,
  FolderTree,
  Loader2,
  Save,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import type { FormEvent, Key } from "react";
import { tagsToText, textToTags } from "../appState";
import type { ConnectionProfile, ConnectionProfileInput } from "../types";

const noJumpHostKey = "__none";

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
  const authOptions: Array<{
    id: ConnectionProfile["authType"];
    label: string;
  }> = [
    { id: "agent", label: t("profile.authAgent") },
    { id: "privateKey", label: t("profile.authPrivateKey") },
    { id: "password", label: t("profile.authPassword") },
  ];

  function updateAuthType(key: Key | null) {
    const authType = String(key || "agent") as ConnectionProfile["authType"];
    onChange({
      ...draft,
      authType,
      privateKeyPath: authType === "privateKey" ? draft.privateKeyPath : "",
    });
    if (authType === "agent") {
      setSecretDraft("");
    }
  }

  return (
    <form className="profile-editor" onSubmit={onSubmit}>
      <div className="profile-editor-head">
        <div>
          <p className="eyebrow">{t("profile.detail")}</p>
          <h2 id="profile-dialog-title">
            {isEditing ? t("profile.editTitle") : t("profile.createTitle")}
          </h2>
        </div>
        <Button
          className="profile-icon-button"
          isIconOnly
          size="sm"
          type="button"
          variant="ghost"
          aria-label={t("profile.cancel")}
          onPress={onCancel}
        >
          <X size={15} />
        </Button>
      </div>

      <Card className="profile-section" variant="secondary">
        <Card.Header className="profile-section-head">
          <Server size={17} />
          <Card.Title>{t("profile.basicSection")}</Card.Title>
        </Card.Header>
        <Card.Content className="profile-section-content">
          <TextField className="profile-field" fullWidth>
            <Label>{t("profile.name")}</Label>
            <Input
              value={draft.name}
              onChange={(event) =>
                onChange({ ...draft, name: event.currentTarget.value })
              }
              placeholder={t("profile.namePlaceholder")}
            />
          </TextField>
          <div className="form-grid host-grid">
            <TextField className="profile-field" fullWidth>
              <Label>{t("profile.host")}</Label>
              <Input
                value={draft.host}
                onChange={(event) =>
                  onChange({ ...draft, host: event.currentTarget.value })
                }
                placeholder={t("profile.hostPlaceholder")}
              />
            </TextField>
            <TextField className="profile-field" fullWidth>
              <Label>{t("profile.port")}</Label>
              <Input
                type="number"
                min={1}
                max={65535}
                value={String(draft.port)}
                onChange={(event) =>
                  onChange({ ...draft, port: Number(event.currentTarget.value) })
                }
              />
            </TextField>
          </div>
          <TextField className="profile-field" fullWidth>
            <Label>{t("profile.username")}</Label>
            <Input
              value={draft.username}
              onChange={(event) =>
                onChange({ ...draft, username: event.currentTarget.value })
              }
              placeholder={t("profile.usernamePlaceholder")}
            />
          </TextField>
        </Card.Content>
      </Card>

      <Card className="profile-section" variant="secondary">
        <Card.Header className="profile-section-head">
          <FileKey2 size={17} />
          <Card.Title>{t("profile.authSection")}</Card.Title>
        </Card.Header>
        <Card.Content className="profile-section-content">
          <Select
            className="profile-field"
            selectedKey={draft.authType}
            onSelectionChange={updateAuthType}
            fullWidth
          >
            <Label>{t("profile.auth")}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {authOptions.map((option) => (
                  <ListBox.Item key={option.id} id={option.id}>
                    {option.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            <Description>{t("profile.authHelp")}</Description>
          </Select>
        {showPrivateKey && (
          <TextField className="profile-field" fullWidth>
            <Label>{t("profile.privateKeyPath")}</Label>
            <Input
              value={draft.privateKeyPath ?? ""}
              onChange={(event) =>
                onChange({ ...draft, privateKeyPath: event.currentTarget.value })
              }
              placeholder={t("profile.privateKeyPlaceholder")}
            />
          </TextField>
        )}
        {showSecret && (
          <TextField className="profile-field" fullWidth>
            <Label>{secretLabel}</Label>
            <Input
              type="password"
              value={secretDraft}
              placeholder={t("profile.secretPlaceholder")}
              onChange={(event) => setSecretDraft(event.currentTarget.value)}
            />
            <Description>{t("profile.secretSavedHint")}</Description>
          </TextField>
        )}
        </Card.Content>
      </Card>

      <Card className="profile-section" variant="secondary">
        <Card.Header className="profile-section-head">
          <FolderTree size={17} />
          <Card.Title>{t("profile.organizeSection")}</Card.Title>
        </Card.Header>
        <Card.Content className="profile-section-content">
          <div className="form-grid">
            <TextField className="profile-field" fullWidth>
              <Label>{t("profile.group")}</Label>
              <Input
                value={draft.groupId ?? ""}
                onChange={(event) =>
                  onChange({ ...draft, groupId: event.currentTarget.value })
                }
                placeholder={t("profile.groupPlaceholder")}
              />
            </TextField>
            <TextField className="profile-field" fullWidth>
              <Label>{t("profile.tags")}</Label>
              <Input
                value={tagsToText(draft.tags)}
                onChange={(event) =>
                  onChange({ ...draft, tags: textToTags(event.currentTarget.value) })
                }
                placeholder={t("profile.tagsPlaceholder")}
              />
            </TextField>
          </div>
          <Select
            className="profile-field"
            selectedKey={draft.jumpHostId || noJumpHostKey}
            onSelectionChange={(key) =>
              onChange({
                ...draft,
                jumpHostId: key && String(key) !== noJumpHostKey ? String(key) : "",
              })
            }
            fullWidth
          >
            <Label>{t("profile.jumpHost")}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={noJumpHostKey}>
                  {t("profile.noJumpHost")}
                </ListBox.Item>
                {jumpHostOptions.map((profile) => (
                  <ListBox.Item key={profile.id} id={profile.id}>
                    {profile.name} · {profile.username}@{profile.host}:{profile.port}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            <Description>{t("profile.jumpHostHelp")}</Description>
          </Select>
          <Checkbox
            className="profile-checkbox"
            isSelected={draft.favorite}
            onChange={(favorite) => onChange({ ...draft, favorite })}
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Content>
              <span>{t("profile.favorite")}</span>
              <small>{t("profile.favoriteHelp")}</small>
            </Checkbox.Content>
          </Checkbox>
        </Card.Content>
      </Card>

      <div className="form-actions">
        <Button type="button" variant="outline" onPress={onCancel}>
          {t("profile.cancel")}
        </Button>
        <Button
          type="button"
          variant="outline"
          isDisabled={isTesting}
          onPress={onTest}
        >
          {isTesting ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          {t("profile.test")}
        </Button>
        <Button type="submit" variant="primary">
          <Save size={16} />
          {t("profile.save")}
        </Button>
      </div>
    </form>
  );
}
