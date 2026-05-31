import { useState, type CSSProperties } from "react";
import { Icon } from "@iconify/react/dist/offline";
import dotsVertical from "@iconify-icons/mdi/dots-vertical";
import starIcon from "@iconify-icons/mdi/star";
import starOutlineIcon from "@iconify-icons/mdi/star-outline";
import pencilOutline from "@iconify-icons/mdi/pencil-outline";
import deleteOutline from "@iconify-icons/mdi/delete-outline";
import type { BridgeConnection, ChatSession } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";
import { Separator } from "../../components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";

interface SessionSidebarProps {
  locale: Locale;
  sessions: ChatSession[];
  activeSessionId: string | undefined;
  activeConnection: BridgeConnection | undefined;
  onCreateSession: () => void | Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onOpenSettings: () => void | Promise<void>;
  onToggleStarSession: (sessionId: string) => void | Promise<void>;
  onOpenRenameDialog: (session: ChatSession) => void;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  onDropdownOpenChange: (open: boolean) => void;
}

export function SessionSidebar({
  locale,
  sessions,
  activeSessionId,
  activeConnection,
  onCreateSession,
  onSelectSession,
  onOpenSettings,
  onToggleStarSession,
  onOpenRenameDialog,
  onDeleteSession,
  onDropdownOpenChange
}: SessionSidebarProps): JSX.Element {
  const [hoverSessionId, setHoverSessionId] = useState<string | undefined>();
  const [truncatedTitleSessionId, setTruncatedTitleSessionId] = useState<string | undefined>();

  return (
    <div className="surf-session-sidebar">
      <h2 className="surf-session-title">{t(locale, "sessions")}</h2>
      <Button type="button" onClick={() => void onCreateSession()} className="w-full justify-between">
        {t(locale, "newSession")}
      </Button>

      <TooltipProvider delayDuration={240}>
        <div className="surf-session-list">
          {sessions.map((session) => (
            <Tooltip
              key={session.id}
              open={hoverSessionId === session.id && truncatedTitleSessionId === session.id}
            >
              <TooltipTrigger asChild>
                <div
                  onClick={() => onSelectSession(session.id)}
                  className="surf-session-row"
                  data-active={activeSessionId === session.id ? "true" : "false"}
                  onMouseEnter={(event) => {
                    setHoverSessionId(session.id);
                    const titleElement = event.currentTarget.querySelector(
                      "[data-session-title='true']"
                    ) as HTMLElement | null;

                    if (!titleElement || titleElement.scrollWidth <= titleElement.clientWidth) {
                      setTruncatedTitleSessionId((previous) =>
                        previous === session.id ? undefined : previous
                      );
                      return;
                    }

                    setTruncatedTitleSessionId(session.id);
                  }}
                  onMouseLeave={() => {
                    setHoverSessionId((previous) =>
                      previous === session.id ? undefined : previous
                    );
                    setTruncatedTitleSessionId((previous) =>
                      previous === session.id ? undefined : previous
                    );
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    style={sessionTitleButtonStyle}
                  >
                    {session.status === "RUNNING" ? (
                      <span
                        aria-hidden="true"
                        className="surf-session-status-dot"
                        data-status="RUNNING"
                      />
                    ) : session.status === "ERROR" ? (
                      <span
                        aria-hidden="true"
                        className="surf-session-status-dot"
                        data-status="ERROR"
                      />
                    ) : null}
                    <span
                      data-session-title="true"
                      style={{
                        display: "block",
                        width: "100%",
                        minWidth: 0,
                        textAlign: "left",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {session.title}
                    </span>
                  </button>

                  <DropdownMenu onOpenChange={onDropdownOpenChange}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        aria-label={t(locale, "moreActions")}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 rounded-lg p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <Icon icon={dotsVertical} width={16} height={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[150px]">
                      <DropdownMenuItem onSelect={() => void onToggleStarSession(session.id)}>
                        <Icon
                          icon={session.starred ? starOutlineIcon : starIcon}
                          width={16}
                          height={16}
                        />
                        <span>{session.starred ? t(locale, "unfavorite") : t(locale, "favorite")}</span>
                      </DropdownMenuItem>

                      <DropdownMenuItem onSelect={() => onOpenRenameDialog(session)}>
                        <Icon icon={pencilOutline} width={16} height={16} />
                        <span>{t(locale, "renameSession")}</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onSelect={() => void onDeleteSession(session.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Icon icon={deleteOutline} width={16} height={16} />
                        <span>{t(locale, "deleteSession")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={8}
                className="max-w-[280px] whitespace-normal break-words"
              >
                {session.title}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <Separator className="my-3" />
      <div className="surf-connection-card">
        <span className="surf-field-label">{t(locale, "currentConnection")}</span>
        <span className="truncate text-sm font-semibold">
          {activeConnection?.name ?? t(locale, "noConnection")}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void onOpenSettings()}>
          {t(locale, "openSettings")}
        </Button>
      </div>
    </div>
  );
}

const sessionTitleButtonStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: "2px 0",
  display: "inline-flex",
  alignItems: "center",
  overflow: "hidden"
};
