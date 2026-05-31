import type { BridgeConnection, BridgeMemory } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";

interface MemoriesSectionProps {
  locale: Locale;
  activeConnection: BridgeConnection | undefined;
  memories: BridgeMemory[];
  memoriesFeedback: string | undefined;
  onRefresh: () => void;
  onConfirmMemory: (memoryId: string) => void;
  onRejectMemory: (memoryId: string) => void;
  onDeleteMemory: (memoryId: string) => void;
}

export function MemoriesSection({
  locale,
  activeConnection,
  memories,
  memoriesFeedback,
  onRefresh,
  onConfirmMemory,
  onRejectMemory,
  onDeleteMemory
}: MemoriesSectionProps): JSX.Element {
  return (
    <section className="surf-settings-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="surf-settings-section-title">{t(locale, "memoriesTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t(locale, "memoriesDescription")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={!activeConnection}
        >
          {t(locale, "refresh")}
        </Button>
      </div>

      {!activeConnection ? (
        <p className="text-xs text-muted-foreground">{t(locale, "noConnection")}</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(locale, "memoriesEmpty")}</p>
      ) : (
        <div className="grid gap-2">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              locale={locale}
              memory={memory}
              onConfirmMemory={onConfirmMemory}
              onRejectMemory={onRejectMemory}
              onDeleteMemory={onDeleteMemory}
            />
          ))}
        </div>
      )}

      {memoriesFeedback ? (
        <p className="text-xs text-muted-foreground">{memoriesFeedback}</p>
      ) : null}
    </section>
  );
}

interface MemoryCardProps {
  locale: Locale;
  memory: BridgeMemory;
  onConfirmMemory: (memoryId: string) => void;
  onRejectMemory: (memoryId: string) => void;
  onDeleteMemory: (memoryId: string) => void;
}

function MemoryCard({
  locale,
  memory,
  onConfirmMemory,
  onRejectMemory,
  onDeleteMemory
}: MemoryCardProps): JSX.Element {
  return (
    <article className="surf-memory-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <span className="rounded-[4px] border border-border/70 bg-muted px-1.5 py-0.5">{memory.scope}</span>
          <span className="rounded-[4px] border border-border/70 bg-muted px-1.5 py-0.5">{memory.kind}</span>
          <span className="rounded-[4px] border border-border/70 bg-muted px-1.5 py-0.5">{memory.status}</span>
          <span className="text-muted-foreground">
            {Math.round(memory.confidence * 100)}%
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {new Date(memory.updatedAt).toLocaleString()}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p>
      {memory.scopeKey || memory.sessionId ? (
        <p className="truncate text-xs text-muted-foreground">
          {memory.scopeKey ?? memory.sessionId}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {memory.status === "candidate" ? (
          <>
            <Button type="button" size="sm" onClick={() => onConfirmMemory(memory.id)}>
              {t(locale, "memoryConfirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRejectMemory(memory.id)}
            >
              {t(locale, "memoryReject")}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDeleteMemory(memory.id)}
        >
          {t(locale, "memoryDelete")}
        </Button>
      </div>
    </article>
  );
}
