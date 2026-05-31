import type { BridgeSessionRun } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import { formatRunStatus, isRunInFlight } from "../utils/sidepanel-helpers";

const AUTO_MODEL_ID = "auto";

interface RunStatusBannerProps {
  activeRun: BridgeSessionRun;
  runStreamError: string | undefined;
  locale: Locale;
  onCancelActiveRun: () => void | Promise<void>;
}

export function RunStatusBanner({
  activeRun,
  runStreamError,
  locale,
  onCancelActiveRun
}: RunStatusBannerProps): JSX.Element {
  const statusTone =
    activeRun.status === "FAILED"
      ? "failed"
      : activeRun.status === "CANCELLED"
        ? "cancelled"
        : "running";

  return (
    <div className="surf-run-status" data-status={statusTone}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px]">
          {t(locale, "runStatusLabel")} {formatRunStatus(locale, activeRun.status)} ·{" "}
          {formatAdapterModel(activeRun.adapter, activeRun.model)}
        </span>
        {isRunInFlight(activeRun.status) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => void onCancelActiveRun()}
            disabled={activeRun.status === "CANCELLING"}
          >
            {activeRun.status === "CANCELLING" ? t(locale, "stopping") : t(locale, "stopRun")}
          </Button>
        ) : null}
      </div>
      {activeRun.errorMessage &&
      (activeRun.status === "FAILED" || activeRun.status === "CANCELLED") ? (
        <div className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
          {activeRun.errorMessage}
        </div>
      ) : null}
      {runStreamError ? (
        <div className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
          {runStreamError}
        </div>
      ) : null}
    </div>
  );
}

function formatAdapterModel(adapter: string, model: string | undefined): string {
  return `${adapter} / ${model?.trim() || AUTO_MODEL_ID}`;
}
