import { Icon } from "@iconify/react/dist/offline";
import checkIcon from "@iconify-icons/mdi/check";
import checkAllIcon from "@iconify-icons/mdi/check-all";
import alertCircleOutline from "@iconify-icons/mdi/alert-circle-outline";
import type { BridgeRunApproval } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import { stableDecisionKey, type ProcessTimelineItem } from "../utils/sidepanel-helpers";

interface ProcessTimelineEntryProps {
  itemId: string;
  process: ProcessTimelineItem;
  locale: Locale;
  submitApprovalDecision: (approval: BridgeRunApproval, decision: unknown) => void | Promise<void>;
}

export function ProcessTimelineEntry({
  itemId,
  process,
  locale,
  submitApprovalDecision
}: ProcessTimelineEntryProps): JSX.Element | null {
  if (process.kind === "approval" && process.approval) {
    const approval = process.approval;
    const pendingApproval = approval.status === "PENDING";
    return (
      <div key={itemId} className="surf-process-card" data-kind="approval">
        <div className="surf-process-header">
          <strong className="surf-process-title">{approval.title ?? approval.kind}</strong>
          <span className="surf-process-meta">
            {renderApprovalStatus(locale, approval.status, approval.decision)}
          </span>
        </div>
        <div className="surf-process-body whitespace-pre-wrap">
          {approval.kind}
        </div>
        {pendingApproval ? (
          <div className="surf-process-actions">
            {approval.availableDecisions.map((decision) => (
              <Button
                key={stableDecisionKey(decision)}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void submitApprovalDecision(approval, decision)}
              >
                {renderDecisionLabel(locale, decision)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (process.kind === "commentary" && process.content) {
    const commentarySegments =
      process.segments && process.segments.length > 0
        ? process.segments
        : [process.content];
    return (
      <details key={itemId} className="surf-process-details">
        <summary className="surf-process-summary">
          {t(locale, "assistantCommentaryTitle")}
        </summary>
        <div className="surf-process-markdown">
          {commentarySegments.map((segment, index) => (
            <p
              key={`${itemId}:commentary:${index}`}
              className="surf-process-paragraph"
            >
              {segment}
            </p>
          ))}
        </div>
      </details>
    );
  }

  if (process.kind === "reasoning_summary" && process.content) {
    return (
      <details key={itemId} className="surf-process-details">
        <summary className="surf-process-summary">Reasoning Summary</summary>
        <pre className="surf-process-content">{process.content}</pre>
      </details>
    );
  }

  if (process.kind === "reasoning_text" && process.content) {
    return (
      <details key={itemId} className="surf-process-details">
        <summary className="surf-process-summary">Reasoning (Raw)</summary>
        <pre className="surf-process-content">{process.content}</pre>
      </details>
    );
  }

  if (process.kind === "command_output" && process.content) {
    return (
      <details key={itemId} className="surf-process-details">
        <summary className="surf-process-summary">Tool / Command Output</summary>
        <pre className="surf-process-content">{process.content}</pre>
      </details>
    );
  }

  if (process.kind === "runtime_error" && process.message) {
    return (
      <div key={itemId} className="surf-process-card" data-kind="runtime_error">
        <div className="surf-process-header">
          <strong className="surf-process-title">Runtime error</strong>
        </div>
        <div className="surf-process-body whitespace-pre-wrap">{process.message}</div>
      </div>
    );
  }

  return null;
}

function renderDecisionLabel(locale: Locale, decision: unknown): string {
  if (decision === "accept") {
    return locale === "zh-CN" ? "允许本次" : "Allow once";
  }
  if (decision === "acceptForSession") {
    return locale === "zh-CN" ? "允许会话内" : "Allow for session";
  }
  if (decision === "decline") {
    return locale === "zh-CN" ? "拒绝" : "Decline";
  }
  if (decision === "cancel") {
    return locale === "zh-CN" ? "取消" : "Cancel";
  }

  if (decision && typeof decision === "object" && !Array.isArray(decision)) {
    const key = Object.keys(decision)[0];
    if (key === "acceptWithExecpolicyAmendment") {
      return locale === "zh-CN" ? "允许并记住规则" : "Allow + remember rule";
    }
    if (key === "applyNetworkPolicyAmendment") {
      return locale === "zh-CN" ? "允许并更新网络规则" : "Allow + network rule";
    }
    return key ?? String(decision);
  }

  return String(decision);
}

function renderApprovalStatus(
  locale: Locale,
  status: BridgeRunApproval["status"],
  decision: unknown
): JSX.Element {
  if (status === "PENDING") {
    return <span>{locale === "zh-CN" ? "待处理" : "Pending"}</span>;
  }

  const isSessionAllow = decision === "acceptForSession";
  const isAccepted = status === "APPROVED";
  const isDeclined = status === "DENIED" || status === "CANCELLED" || status === "TIMEOUT" || status === "FAILED";

  if (isAccepted) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--hint-info-text)" }}>
        <Icon icon={isSessionAllow ? checkAllIcon : checkIcon} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已允许" : "Approved"}</span>
      </span>
    );
  }

  if (isDeclined) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--hint-error-text)" }}>
        <Icon icon={alertCircleOutline} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已拒绝" : "Denied"}</span>
      </span>
    );
  }

  return <span>{status}</span>;
}
