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

type ProcessTone = "approval" | "commentary" | "reasoning" | "terminal" | "tool" | "file" | "error";

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
      <article key={itemId} className="surf-process-card" data-kind="approval">
        <ProcessHeader
          eyebrow={locale === "zh-CN" ? "审批闸口" : "Approval gate"}
          title={approval.title ?? approval.kind}
          meta={renderApprovalStatus(locale, approval.status, approval.decision)}
          timestamp={process.ts}
        />
        <div className="surf-process-body whitespace-pre-wrap">{approval.kind}</div>
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
      </article>
    );
  }

  if (process.kind === "tool_call") {
    return (
      <ProcessDisclosure
        itemId={itemId}
        tone={getToolTone(process)}
        eyebrow={locale === "zh-CN" ? "工具调用" : "Tool call"}
        title={process.toolId ?? "tool"}
        timestamp={process.ts}
        content={formatStructuredContent(process.input)}
        emptyContent={locale === "zh-CN" ? "无输入参数" : "No input payload"}
      />
    );
  }

  if (process.kind === "tool_result") {
    return (
      <ProcessDisclosure
        itemId={itemId}
        tone={getToolTone(process)}
        eyebrow={renderToolResultEyebrow(locale, process)}
        title={process.toolId ?? "tool"}
        timestamp={process.ts}
        content={process.content || formatStructuredContent(process.metadata)}
        emptyContent={locale === "zh-CN" ? "无输出内容" : "No output content"}
      />
    );
  }

  if (process.kind === "tool_failed") {
    return (
      <article key={itemId} className="surf-process-card" data-kind="error">
        <ProcessHeader
          eyebrow={locale === "zh-CN" ? "工具失败" : "Tool failed"}
          title={process.toolId ?? "tool"}
          meta={process.code}
          timestamp={process.ts}
        />
        <div className="surf-process-body whitespace-pre-wrap">{process.message}</div>
      </article>
    );
  }

  if (process.kind === "commentary" && process.content) {
    const commentarySegments =
      process.segments && process.segments.length > 0
        ? process.segments
        : [process.content];
    return (
      <details key={itemId} className="surf-process-details" data-kind="commentary">
        <summary className="surf-process-summary">
          <ProcessSummary
            eyebrow={t(locale, "assistantCommentaryTitle")}
            title={locale === "zh-CN" ? "执行过程" : "Execution notes"}
            timestamp={process.ts}
          />
        </summary>
        <div className="surf-process-markdown">
          {commentarySegments.map((segment, index) => (
            <p key={`${itemId}:commentary:${index}`} className="surf-process-paragraph">
              {segment}
            </p>
          ))}
        </div>
      </details>
    );
  }

  if (process.kind === "reasoning_summary" && process.content) {
    return (
      <ProcessDisclosure
        itemId={itemId}
        tone="reasoning"
        eyebrow={locale === "zh-CN" ? "推理摘要" : "Reasoning summary"}
        title={locale === "zh-CN" ? "模型思路" : "Model trace"}
        timestamp={process.ts}
        content={process.content}
      />
    );
  }

  if (process.kind === "reasoning_text" && process.content) {
    return (
      <ProcessDisclosure
        itemId={itemId}
        tone="reasoning"
        eyebrow={locale === "zh-CN" ? "原始推理" : "Raw reasoning"}
        title={locale === "zh-CN" ? "隐藏轨迹" : "Hidden trace"}
        timestamp={process.ts}
        content={process.content}
      />
    );
  }

  if (process.kind === "command_output" && process.content) {
    return (
      <ProcessDisclosure
        itemId={itemId}
        tone="terminal"
        eyebrow={locale === "zh-CN" ? "终端输出" : "Terminal output"}
        title={locale === "zh-CN" ? "命令日志" : "Command log"}
        timestamp={process.ts}
        content={process.content}
      />
    );
  }

  if (process.kind === "runtime_error" && process.message) {
    return (
      <article key={itemId} className="surf-process-card" data-kind="error">
        <ProcessHeader
          eyebrow={locale === "zh-CN" ? "运行错误" : "Runtime error"}
          title={locale === "zh-CN" ? "请求未完成" : "Run interrupted"}
          timestamp={process.ts}
        />
        <div className="surf-process-body whitespace-pre-wrap">{process.message}</div>
      </article>
    );
  }

  return null;
}

function ProcessDisclosure({
  itemId,
  tone,
  eyebrow,
  title,
  timestamp,
  content,
  emptyContent
}: {
  itemId: string;
  tone: ProcessTone;
  eyebrow: string;
  title: string;
  timestamp: number;
  content?: string;
  emptyContent?: string;
}): JSX.Element {
  return (
    <details key={itemId} className="surf-process-details" data-kind={tone}>
      <summary className="surf-process-summary">
        <ProcessSummary eyebrow={eyebrow} title={title} timestamp={timestamp} />
      </summary>
      <pre className="surf-process-content">{content?.trim() || emptyContent || ""}</pre>
    </details>
  );
}

function ProcessHeader({
  eyebrow,
  title,
  meta,
  timestamp
}: {
  eyebrow: string;
  title: string;
  meta?: string | JSX.Element | undefined;
  timestamp: number;
}): JSX.Element {
  return (
    <div className="surf-process-header">
      <div className="surf-process-heading">
        <span className="surf-process-eyebrow">{eyebrow}</span>
        <strong className="surf-process-title">{title}</strong>
      </div>
      <span className="surf-process-meta">
        {meta ? <span>{meta}</span> : null}
        <time>{formatProcessTime(timestamp)}</time>
      </span>
    </div>
  );
}

function ProcessSummary({
  eyebrow,
  title,
  timestamp
}: {
  eyebrow: string;
  title: string;
  timestamp: number;
}): JSX.Element {
  return (
    <span className="surf-process-summary-grid">
      <span className="surf-process-heading">
        <span className="surf-process-eyebrow">{eyebrow}</span>
        <strong className="surf-process-title">{title}</strong>
      </span>
      <time className="surf-process-meta">{formatProcessTime(timestamp)}</time>
    </span>
  );
}

function getToolTone(process: ProcessTimelineItem): ProcessTone {
  const toolId = process.toolId?.toLowerCase() ?? "";
  const outputKind = process.outputKind?.toLowerCase() ?? "";
  if (
    toolId.includes("exec") ||
    toolId.includes("terminal") ||
    toolId.includes("shell") ||
    toolId.includes("bash") ||
    outputKind.includes("artifact")
  ) {
    return "terminal";
  }
  if (
    toolId.includes("apply_patch") ||
    toolId.includes("edit") ||
    toolId.includes("write") ||
    toolId.includes("file")
  ) {
    return "file";
  }
  return "tool";
}

function renderToolResultEyebrow(locale: Locale, process: ProcessTimelineItem): string {
  const tone = getToolTone(process);
  if (tone === "terminal") {
    return locale === "zh-CN" ? "终端输出" : "Terminal output";
  }
  if (tone === "file") {
    return locale === "zh-CN" ? "文件变更" : "File edit";
  }
  return locale === "zh-CN" ? "工具结果" : "Tool result";
}

function formatStructuredContent(value: unknown): string {
  if (!value) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatProcessTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
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
      <span className="surf-process-status" data-status="approved">
        <Icon icon={isSessionAllow ? checkAllIcon : checkIcon} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已允许" : "Approved"}</span>
      </span>
    );
  }

  if (isDeclined) {
    return (
      <span className="surf-process-status" data-status="denied">
        <Icon icon={alertCircleOutline} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已拒绝" : "Denied"}</span>
      </span>
    );
  }

  return <span>{status}</span>;
}
