import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  BridgeChatRequest,
  BridgeConnection,
  ChatMessage,
  ChatSession,
  ExtensionToUiMessage,
  BridgeTtsResponse,
  QuickAction
} from "@surf-ai/shared";
import { listMessagesBySession, saveMessage } from "../../lib/db";
import {
  getActiveConnectionId,
  getConnections,
  getSessions,
  onStorageChanged,
  setActiveConnectionId,
  setConnections,
  setSessions
} from "../../lib/storage";
import { resolveLocale, t } from "../common/i18n";

const ACTION_PROMPT_PREFIX: Record<QuickAction, string> = {
  summarize: "Please summarize this content:",
  translate: "Please translate this content into Chinese and English:",
  read_aloud: "Please prepare this content for read-aloud:",
  ask: "Please help answer based on this content:"
};

export function App(): JSX.Element {
  const locale = resolveLocale(navigator.language);

  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
  const [sessions, setSessionsState] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [adapter, setAdapter] = useState<BridgeChatRequest["adapter"]>("mock");
  const [pending, setPending] = useState(false);

  const [newConnName, setNewConnName] = useState("");
  const [newConnUrl, setNewConnUrl] = useState("http://127.0.0.1:43127");
  const [newConnToken, setNewConnToken] = useState("");

  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );

  useEffect(() => {
    void bootstrap();

    const removeStorageListener = onStorageChanged(() => {
      void bootstrapConnectionsAndSessions();
    });

    const messageListener = (message: ExtensionToUiMessage) => {
      if (message?.type !== "selection_payload") return;
      const text = `${ACTION_PROMPT_PREFIX[message.payload.action]}\n\n${message.payload.text}`;
      setInput(text);
      if (message.payload.action === "read_aloud") {
        void requestTts(message.payload.text);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      removeStorageListener();
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    void listMessagesBySession(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  async function bootstrap(): Promise<void> {
    await bootstrapConnectionsAndSessions();
  }

  async function bootstrapConnectionsAndSessions(): Promise<void> {
    const [storedConnections, storedActiveConnectionId, storedSessions] = await Promise.all([
      getConnections(),
      getActiveConnectionId(),
      getSessions()
    ]);

    setConnectionsState(storedConnections);
    setActiveConnectionIdState(storedActiveConnectionId ?? storedConnections[0]?.id);

    if (storedSessions.length === 0) {
      const first = createSession("New chat");
      await setSessions([first]);
      setSessionsState([first]);
      setActiveSessionId(first.id);
      return;
    }

    setSessionsState(storedSessions);
    setActiveSessionId((current) => current ?? storedSessions[0]?.id);
  }

  async function addConnection(): Promise<void> {
    if (!newConnName.trim() || !newConnUrl.trim()) return;

    const now = Date.now();
    const connection: BridgeConnection = {
      id: crypto.randomUUID(),
      name: newConnName.trim(),
      baseUrl: newConnUrl.trim().replace(/\/$/, ""),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...(newConnToken.trim() ? { token: newConnToken.trim() } : {})
    };

    const next = [connection, ...connections];
    await setConnections(next);
    await setActiveConnectionId(connection.id);
    setConnectionsState(next);
    setActiveConnectionIdState(connection.id);

    setNewConnName("");
    setNewConnUrl("http://127.0.0.1:43127");
    setNewConnToken("");
  }

  async function createNewSession(): Promise<void> {
    const session = createSession(`Chat ${sessions.length + 1}`);
    const next = [session, ...sessions];
    await setSessions(next);
    setSessionsState(next);
    setActiveSessionId(session.id);
  }

  async function toggleStarSession(id: string): Promise<void> {
    const next = sessions.map((item) => (item.id === id ? { ...item, starred: !item.starred, updatedAt: Date.now() } : item));
    await setSessions(next);
    setSessionsState(next);
  }

  async function send(): Promise<void> {
    if (!input.trim() || !activeSessionId || !activeConnection) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: "user",
      content: input.trim(),
      createdAt: Date.now()
    };

    await saveMessage(userMessage);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPending(true);

    try {
      const response = await fetch(`${activeConnection.baseUrl}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(activeConnection.token ? { "x-surf-token": activeConnection.token } : {})
        },
        body: JSON.stringify({
          adapter,
          sessionId: activeSessionId,
          messages: [...messages, userMessage].map((item) => ({
            role: item.role,
            content: item.content
          }))
        } satisfies BridgeChatRequest)
      });

      if (!response.ok) {
        const failedText = await response.text();
        throw new Error(`Bridge request failed: ${response.status} ${failedText}`);
      }

      const result = (await response.json()) as { output: string };

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        content: result.output,
        createdAt: Date.now()
      };

      await saveMessage(assistantMessage);
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      await saveMessage(errMessage);
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
    }
  }

  async function requestTts(text: string): Promise<void> {
    if (!activeConnection) return;

    try {
      const response = await fetch(`${activeConnection.baseUrl}/tts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(activeConnection.token ? { "x-surf-token": activeConnection.token } : {})
        },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as BridgeTtsResponse;
      const playbackUrl =
        payload.audioUrl ??
        (payload.base64Audio
          ? `data:${payload.mimeType ?? "audio/mpeg"};base64,${payload.base64Audio}`
          : undefined);

      if (!playbackUrl) {
        return;
      }

      const audio = new Audio(playbackUrl);
      void audio.play();
    } catch {
      // Keep silent for skeleton: chat flow should continue even if TTS is unavailable.
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100vh" }}>
      <aside style={{ borderRight: "1px solid var(--line)", background: "var(--panel)", padding: 12, overflow: "auto" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{t(locale, "sessions")}</h2>
        <button
          type="button"
          onClick={() => void createNewSession()}
          style={solidButtonStyle}
        >
          {t(locale, "newSession")}
        </button>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveSessionId(session.id)}
              style={{
                ...rowButtonStyle,
                background: activeSessionId === session.id ? "#e8f8ff" : "#fff"
              }}
            >
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.title}
              </span>
              <span
                role="button"
                aria-label={t(locale, "favorite")}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleStarSession(session.id);
                }}
              >
                {session.starred ? "★" : "☆"}
              </span>
            </button>
          ))}
        </div>

        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid var(--line)" }} />

        <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{t(locale, "connection")}</h3>
        <select
          value={activeConnectionId}
          onChange={(event) => {
            const id = event.target.value;
            setActiveConnectionIdState(id);
            void setActiveConnectionId(id);
          }}
          style={inputStyle}
        >
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id}>
              {conn.name}
            </option>
          ))}
        </select>

        <label style={labelStyle}>{t(locale, "connectionName")}</label>
        <input value={newConnName} onChange={(e) => setNewConnName(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>{t(locale, "baseUrl")}</label>
        <input value={newConnUrl} onChange={(e) => setNewConnUrl(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>{t(locale, "token")}</label>
        <input value={newConnToken} onChange={(e) => setNewConnToken(e.target.value)} style={inputStyle} />

        <button type="button" onClick={() => void addConnection()} style={{ ...solidButtonStyle, marginTop: 8 }}>
          {t(locale, "addConnection")}
        </button>
      </aside>

      <main style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--line)",
            background: "rgba(255, 255, 255, 0.84)",
            backdropFilter: "blur(4px)"
          }}
        >
          <strong style={{ flex: 1 }}>{t(locale, "appTitle")}</strong>
          <label>{t(locale, "adapter")}</label>
          <select value={adapter} onChange={(e) => setAdapter(e.target.value as BridgeChatRequest["adapter"])} style={{ ...inputStyle, width: 150 }}>
            <option value="mock">mock</option>
            <option value="codex">codex</option>
            <option value="claude">claude</option>
            <option value="openai-compatible">openai-compatible</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
          </select>
        </header>

        <section style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start" }}>
          {messages.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t(locale, "empty")}</div>
          ) : (
            messages.map((msg) => (
              <article
                key={msg.id}
                style={{
                  maxWidth: "85%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  lineHeight: 1.45,
                  border: "1px solid var(--line)",
                  background: msg.role === "user" ? "#dff4ff" : "#fff",
                  marginLeft: msg.role === "user" ? "auto" : 0
                }}
              >
                {msg.content}
              </article>
            ))
          )}
        </section>

        <footer style={{ padding: 12, borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
          <textarea
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(locale, "placeholder")}
            style={{ ...inputStyle, resize: "vertical", minHeight: 76 }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => void send()}
            style={{ ...solidButtonStyle, opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "..." : t(locale, "send")}
          </button>
        </footer>
      </main>
    </div>
  );
}

function createSession(title: string): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    starred: false,
    createdAt: now,
    updatedAt: now
  };
}

const solidButtonStyle: CSSProperties = {
  border: "1px solid var(--brand)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "linear-gradient(180deg, #11a4a6 0%, #0f7a8a 100%)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer"
};

const rowButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  color: "var(--ink)",
  cursor: "pointer"
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  color: "var(--ink)"
};

const labelStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 4,
  fontSize: 12,
  color: "var(--muted)",
  display: "block"
};
