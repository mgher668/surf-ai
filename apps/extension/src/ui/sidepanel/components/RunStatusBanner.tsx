import type { BridgeSessionRun } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import { formatRunStatus, isRunInFlight } from "../utils/sidepanel-helpers";
import { hintErrorStyle, hintInfoStyle, hintWarnStyle } from "../styles";

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
  return (
    <div
      style={
        activeRun.status === "FAILED"
          ? hintErrorStyle
          : activeRun.status === "CANCELLED"
            ? hintWarnStyle
            : hintInfoStyle
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">
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
        <div style={{ marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
          {activeRun.errorMessage}
        </div>
      ) : null}
      {runStreamError ? (
        <div style={{ marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
          {runStreamError}
        </div>
      ) : null}
    </div>
  );
}

function formatAdapterModel(adapter: string, model: string | undefined): string {
  return `${adapter} / ${model?.trim() || AUTO_MODEL_ID}`;
}
