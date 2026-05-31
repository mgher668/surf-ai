import type { BridgeConnection } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../components/ui/select";

interface ConnectionsSectionProps {
  locale: Locale;
  connections: BridgeConnection[];
  activeConnectionId: string | undefined;
  activeConnection: BridgeConnection | undefined;
  newConnName: string;
  newConnUrl: string;
  newConnUserId: string;
  newConnToken: string;
  onActiveConnectionChange: (id: string) => void;
  onNewConnNameChange: (value: string) => void;
  onNewConnUrlChange: (value: string) => void;
  onNewConnUserIdChange: (value: string) => void;
  onNewConnTokenChange: (value: string) => void;
  onAddConnection: () => void;
}

export function ConnectionsSection({
  locale,
  connections,
  activeConnectionId,
  activeConnection,
  newConnName,
  newConnUrl,
  newConnUserId,
  newConnToken,
  onActiveConnectionChange,
  onNewConnNameChange,
  onNewConnUrlChange,
  onNewConnUserIdChange,
  onNewConnTokenChange,
  onAddConnection
}: ConnectionsSectionProps): JSX.Element {
  return (
    <>
      <section className="surf-settings-card">
        <div className="grid gap-1">
          <h2 className="surf-settings-section-title">{t(locale, "settingsSectionConnections")}</h2>
          <p className="text-xs text-muted-foreground">
            {t(locale, "settingsSectionConnectionsDescription")}
          </p>
        </div>

        <div className="grid gap-1">
          <span className="surf-field-label">{t(locale, "currentConnection")}</span>
          <Select
            {...(activeConnectionId ? { value: activeConnectionId } : {})}
            onValueChange={onActiveConnectionChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={t(locale, "noConnection")} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {activeConnection
              ? `${activeConnection.baseUrl} · ${activeConnection.userId ?? "-"}`
              : t(locale, "noConnection")}
          </p>
        </div>
      </section>

      <section className="surf-settings-card">
        <h3 className="surf-settings-section-title">{t(locale, "addConnection")}</h3>
        <div className="grid gap-2">
          <span className="surf-field-label">{t(locale, "connectionName")}</span>
          <Input value={newConnName} onChange={(event) => onNewConnNameChange(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="surf-field-label">{t(locale, "baseUrl")}</span>
          <Input value={newConnUrl} onChange={(event) => onNewConnUrlChange(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="surf-field-label">{t(locale, "connectionUserId")}</span>
          <Input value={newConnUserId} onChange={(event) => onNewConnUserIdChange(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="surf-field-label">{t(locale, "token")}</span>
          <Input value={newConnToken} onChange={(event) => onNewConnTokenChange(event.target.value)} />
        </div>
        <div>
          <Button type="button" onClick={onAddConnection}>
            {t(locale, "addConnection")}
          </Button>
        </div>
      </section>
    </>
  );
}
