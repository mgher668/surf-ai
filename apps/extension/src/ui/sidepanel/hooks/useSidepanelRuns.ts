import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  BridgeConnection,
  BridgeRunApproval,
  BridgeRunStreamEvent,
  BridgeSessionRun,
  BridgeSessionRunApprovalDecisionRequest,
  BridgeSessionRunApprovalDecisionResponse,
  BridgeSessionRunCancelResponse,
  ChatMessage,
  ChatSession
} from "@surf-ai/shared";
import { openBridgeRunStream, type BridgeRunStreamHandle } from "../../../lib/bridge-sse";
import { type Locale, t } from "../../common/i18n";
import {
  fetchLatestSessionRun,
  fetchRunApprovalsFromBackend,
  fetchRunEventsFromBackend,
  fetchSessionRunsFromBackend
} from "../api/bridgeApi";
import {
  fetchSessionsFromBackend,
  loadMessagesFromBackend
} from "../api/sessionApi";
import {
  areMessageListsEqual,
  areSessionListsEqual,
  buildBridgeHeaders,
  buildRunArtifacts,
  createEmptyStreamAssistantByPhase,
  isRunInFlight,
  mergeAssistantCompletedContent,
  mergeSessionsWithLocalAdapters,
  normalizeAssistantStreamPhase,
  upsertApproval,
  type SessionRunProcessState,
  type StreamAssistantByPhase
} from "../utils/sidepanel-helpers";

type SessionMode = "backend" | "local";

type RuntimeAlertReporter = (
  code: "backend_unreachable" | "auth_failed" | "rate_limited" | "bridge_request_failed",
  level: "warn" | "error",
  message: string,
  statusCode?: number
) => void;

interface UseSidepanelRunsOptions {
  sessionMode: SessionMode;
  activeConnectionId: string | undefined;
  activeConnection: BridgeConnection | undefined;
  activeSessionId: string | undefined;
  isBackendDraftActive: boolean;
  locale: Locale;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLoadedMessagesSessionId: Dispatch<SetStateAction<string | undefined>>;
  setPending: Dispatch<SetStateAction<boolean>>;
  setSessionsState: Dispatch<SetStateAction<ChatSession[]>>;
  persistSessions: (sessions: ChatSession[]) => Promise<void>;
  pendingAutoScrollSessionIdRef: MutableRefObject<string | undefined>;
  reportRuntimeAlert: RuntimeAlertReporter;
  clearRuntimeAlert: () => void;
}

interface UseSidepanelRunsResult {
  activeRun: BridgeSessionRun | undefined;
  setActiveRun: Dispatch<SetStateAction<BridgeSessionRun | undefined>>;
  sessionRunProcesses: Record<string, SessionRunProcessState>;
  streamAssistantByPhase: StreamAssistantByPhase;
  runStreamError: string | undefined;
  resetRunState: () => void;
  handleRunCreated: (run: BridgeSessionRun) => void;
  cancelActiveRunOnBackend: () => Promise<void>;
  submitApprovalDecision: (approval: BridgeRunApproval, decision: unknown) => Promise<void>;
}

export function useSidepanelRuns({
  sessionMode,
  activeConnectionId,
  activeConnection,
  activeSessionId,
  isBackendDraftActive,
  locale,
  setMessages,
  setLoadedMessagesSessionId,
  setPending,
  setSessionsState,
  persistSessions,
  pendingAutoScrollSessionIdRef,
  reportRuntimeAlert,
  clearRuntimeAlert
}: UseSidepanelRunsOptions): UseSidepanelRunsResult {
  const [activeRun, setActiveRun] = useState<BridgeSessionRun | undefined>();
  const [, setRunApprovals] = useState<BridgeRunApproval[]>([]);
  const [, setRunEvents] = useState<BridgeRunStreamEvent[]>([]);
  const [sessionRunProcesses, setSessionRunProcesses] = useState<
    Record<string, SessionRunProcessState>
  >({});
  const [streamAssistantByPhase, setStreamAssistantByPhase] = useState<StreamAssistantByPhase>(
    createEmptyStreamAssistantByPhase()
  );
  const [, setRunReasoningSummary] = useState("");
  const [, setRunReasoningText] = useState("");
  const [, setRunCommandOutput] = useState("");
  const [runStreamError, setRunStreamError] = useState<string | undefined>();
  const runStreamRef = useRef<BridgeRunStreamHandle | null>(null);

  useEffect(() => {
    if (!activeSessionId || sessionMode !== "backend" || !activeConnection || isBackendDraftActive) {
      setActiveRun(undefined);
      return;
    }

    let cancelled = false;
    setActiveRun(undefined);

    const load = async (): Promise<void> => {
      const latestRun = await fetchLatestSessionRun(activeConnection, activeSessionId);
      if (cancelled) {
        return;
      }
      setActiveRun(latestRun ?? undefined);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.baseUrl, activeSessionId, sessionMode, isBackendDraftActive]);

  useEffect(() => {
    if (
      sessionMode !== "backend" ||
      !activeConnection ||
      !activeSessionId ||
      isBackendDraftActive
    ) {
      setSessionRunProcesses({});
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;

    const load = async (): Promise<void> => {
      const runs = await fetchSessionRunsFromBackend(activeConnection, sessionId, 50);
      if (cancelled || !runs) {
        return;
      }

      const entries = await Promise.all(
        runs.map(async (run) => {
          const [approvals, events] = await Promise.all([
            fetchRunApprovalsFromBackend(activeConnection, sessionId, run.id, "all"),
            fetchRunEventsFromBackend(activeConnection, sessionId, run.id, 5000)
          ]);
          return [
            run.id,
            {
              approvals: approvals ?? [],
              events: events ?? []
            } satisfies SessionRunProcessState
          ] as const;
        })
      );

      if (cancelled) {
        return;
      }
      setSessionRunProcesses(Object.fromEntries(entries));
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeConnection?.userId,
    activeConnection?.token,
    activeSessionId,
    isBackendDraftActive
  ]);

  useEffect(() => {
    if (
      sessionMode !== "backend" ||
      !activeConnection ||
      !activeSessionId ||
      isBackendDraftActive ||
      !activeRun ||
      activeRun.sessionId !== activeSessionId
    ) {
      clearRunArtifacts();
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;
    const runId = activeRun.id;

    const load = async (): Promise<void> => {
      const [approvals, events] = await Promise.all([
        fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all"),
        fetchRunEventsFromBackend(activeConnection, sessionId, runId, 5000)
      ]);
      if (cancelled) {
        return;
      }

      if (approvals) {
        setRunApprovals(approvals);
      }

      if (events) {
        setRunEvents(events);
        const artifacts = buildRunArtifacts(events);
        setStreamAssistantByPhase(artifacts.assistantByPhase);
        setRunReasoningSummary(artifacts.reasoningSummary);
        setRunReasoningText(artifacts.reasoningText);
        setRunCommandOutput(artifacts.commandOutput);
        setRunStreamError(artifacts.errorMessage);
      }

      if (approvals || events) {
        setSessionRunProcesses((prev) => ({
          ...prev,
          [runId]: {
            approvals: approvals ?? prev[runId]?.approvals ?? [],
            events: events ?? prev[runId]?.events ?? []
          }
        }));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeSessionId,
    isBackendDraftActive,
    activeRun?.id
  ]);

  useEffect(() => {
    if (
      sessionMode !== "backend" ||
      !activeConnection ||
      !activeSessionId ||
      isBackendDraftActive ||
      !activeRun ||
      activeRun.sessionId !== activeSessionId ||
      !isRunInFlight(activeRun.status)
    ) {
      runStreamRef.current?.close();
      runStreamRef.current = null;
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;
    const runId = activeRun.id;

    clearRunArtifacts();
    setSessionRunProcesses((prev) => ({
      ...prev,
      [runId]: {
        approvals: prev[runId]?.approvals ?? [],
        events: []
      }
    }));

    const applyTerminalSync = async (nextRun: BridgeSessionRun): Promise<void> => {
      const loadedMessages = await loadMessagesFromBackend(
        activeConnection,
        sessionId,
        getBackendRuntimeHandlers()
      );
      if (cancelled) {
        return;
      }
      setMessages((prev) => {
        if (areMessageListsEqual(prev, loadedMessages)) {
          return prev;
        }
        const lastMessage = loadedMessages[loadedMessages.length - 1];
        if (lastMessage?.sessionId === sessionId) {
          pendingAutoScrollSessionIdRef.current = sessionId;
        }
        return loadedMessages;
      });
      setLoadedMessagesSessionId(sessionId);
      setActiveRun(nextRun);
      setPending(false);
      const approvals = await fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all");
      if (!cancelled && approvals) {
        setRunApprovals(approvals);
      }
      const events = await fetchRunEventsFromBackend(activeConnection, sessionId, runId, 5000);
      if (!cancelled && events) {
        setRunEvents(events);
      }
      if (!cancelled && (approvals || events)) {
        setSessionRunProcesses((prev) => ({
          ...prev,
          [runId]: {
            approvals: approvals ?? prev[runId]?.approvals ?? [],
            events: events ?? prev[runId]?.events ?? []
          }
        }));
      }

      const backendSessions = await fetchSessionsFromBackend(
        activeConnection,
        getBackendRuntimeHandlers()
      );
      if (!cancelled && backendSessions) {
        setSessionsState((prev) => {
          const mergedSessions = mergeSessionsWithLocalAdapters(prev, backendSessions);
          if (areSessionListsEqual(prev, mergedSessions)) {
            return prev;
          }
          void persistSessions(mergedSessions);
          return mergedSessions;
        });
      }
    };

    const onEvent = (event: BridgeRunStreamEvent): void => {
      if (cancelled) {
        return;
      }
      if (event.sessionId !== sessionId || event.runId !== runId) {
        return;
      }
      if (event.type !== "heartbeat") {
        setRunEvents((prev) => {
          if (prev.some((item) => item.eventId === event.eventId)) {
            return prev;
          }
          return [...prev, event];
        });

        setSessionRunProcesses((prev) => {
          const current = prev[runId] ?? { approvals: [], events: [] };
          const hasEvent = current.events.some((item) => item.eventId === event.eventId);
          const nextEvents = hasEvent ? current.events : [...current.events, event];
          const nextApprovals =
            event.type === "approval.requested" || event.type === "approval.updated"
              ? upsertApproval(current.approvals, event.data.approval)
              : current.approvals;

          if (nextEvents === current.events && nextApprovals === current.approvals) {
            return prev;
          }

          return {
            ...prev,
            [runId]: {
              approvals: nextApprovals,
              events: nextEvents
            }
          };
        });
      }

      if (event.type === "assistant.delta") {
        const phase = normalizeAssistantStreamPhase(event.data.phase);
        setStreamAssistantByPhase((prev) => ({
          ...prev,
          [phase]: `${prev[phase]}${event.data.delta}`
        }));
        return;
      }

      if (event.type === "assistant.completed") {
        if (typeof event.data.content === "string") {
          const completedContent = event.data.content;
          const phase = normalizeAssistantStreamPhase(event.data.phase);
          setStreamAssistantByPhase((prev) => ({
            ...prev,
            [phase]: mergeAssistantCompletedContent(phase, prev[phase] ?? "", completedContent)
          }));
        }
        return;
      }

      if (event.type === "reasoning.summary.delta") {
        setRunReasoningSummary((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "reasoning.text.delta") {
        setRunReasoningText((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "command.output.delta") {
        setRunCommandOutput((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "approval.requested" || event.type === "approval.updated") {
        setRunApprovals((prev) => upsertApproval(prev, event.data.approval));
        return;
      }

      if (event.type === "error") {
        setRunStreamError(event.data.message);
        return;
      }

      if (event.type === "run.status") {
        const nextRun = event.data.run;
        if (!isRunInFlight(nextRun.status)) {
          void applyTerminalSync(nextRun);
          return;
        }
        setActiveRun(nextRun);
      }
    };

    const onError = (error: Error): void => {
      if (cancelled) {
        return;
      }
      setRunStreamError(error.message);
    };

    runStreamRef.current?.close();
    const streamHandle = openBridgeRunStream({
      connection: activeConnection,
      sessionId,
      runId,
      onEvent,
      onError
    });
    runStreamRef.current = streamHandle;

    void fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all").then((approvals) => {
      if (!approvals || cancelled) {
        return;
      }
      setRunApprovals(approvals);
      setSessionRunProcesses((prev) => ({
        ...prev,
        [runId]: {
          approvals,
          events: prev[runId]?.events ?? []
        }
      }));
    });

    return () => {
      cancelled = true;
      streamHandle.close();
      if (runStreamRef.current === streamHandle) {
        runStreamRef.current = null;
      }
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeSessionId,
    isBackendDraftActive,
    activeRun?.id,
    activeRun?.status
  ]);

  function resetRunState(): void {
    runStreamRef.current?.close();
    runStreamRef.current = null;
    setActiveRun(undefined);
    setSessionRunProcesses({});
    clearRunArtifacts();
  }

  function handleRunCreated(run: BridgeSessionRun): void {
    clearRunArtifacts();
    setSessionRunProcesses((prev) => ({
      ...prev,
      [run.id]: {
        approvals: [],
        events: []
      }
    }));
    setActiveRun(run);
  }

  async function cancelActiveRunOnBackend(): Promise<void> {
    if (!activeConnection || !activeRun) {
      return;
    }

    try {
      const response = await fetch(`${activeConnection.baseUrl}/runs/${activeRun.id}/cancel`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true)
      });
      if (!response.ok) {
        reportBridgeStatus(response.status);
        return;
      }

      const payload = (await response.json()) as BridgeSessionRunCancelResponse;
      setActiveRun(payload.run);
      clearRuntimeAlert();
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
    }
  }

  async function submitApprovalDecision(
    approval: BridgeRunApproval,
    decision: unknown
  ): Promise<void> {
    if (!activeConnection || !activeSessionId || !activeRun) {
      return;
    }

    try {
      const payload: BridgeSessionRunApprovalDecisionRequest = { decision };
      const response = await fetch(
        `${activeConnection.baseUrl}/sessions/${activeSessionId}/runs/${activeRun.id}/approvals/${approval.approvalRequestId}/decision`,
        {
          method: "POST",
          headers: buildBridgeHeaders(activeConnection, true),
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        reportBridgeStatus(response.status);
        return;
      }

      const result = (await response.json()) as BridgeSessionRunApprovalDecisionResponse;
      setRunApprovals((prev) => upsertApproval(prev, result.approval));
      setSessionRunProcesses((prev) => {
        const current = prev[activeRun.id] ?? { approvals: [], events: [] };
        return {
          ...prev,
          [activeRun.id]: {
            approvals: upsertApproval(current.approvals, result.approval),
            events: current.events
          }
        };
      });
      clearRuntimeAlert();
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
    }
  }

  function clearRunArtifacts(): void {
    setRunApprovals([]);
    setRunEvents([]);
    setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
    setRunReasoningSummary("");
    setRunReasoningText("");
    setRunCommandOutput("");
    setRunStreamError(undefined);
  }

  function getBackendRuntimeHandlers() {
    return {
      locale,
      reportRuntimeAlert,
      clearRuntimeAlert
    };
  }

  function reportBridgeStatus(status: number): void {
    if (status === 401 || status === 403) {
      reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), status);
      return;
    }
    if (status === 429) {
      reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), status);
      return;
    }
    reportRuntimeAlert(
      "bridge_request_failed",
      "warn",
      `${t(locale, "alertBridgeRequestFailed")} (${status})`,
      status
    );
  }

  return {
    activeRun,
    setActiveRun,
    sessionRunProcesses,
    streamAssistantByPhase,
    runStreamError,
    resetRunState,
    handleRunCreated,
    cancelActiveRunOnBackend,
    submitApprovalDecision
  };
}
