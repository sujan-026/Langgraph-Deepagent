"use client";

import { useMemo, useState } from "react";
import { CopilotSidebar } from "@copilotkit/react-ui";

type EventRecord = {
  type: string;
  threadId?: string;
  runId?: string;
  delta?: string;
  summary?: string;
  toolName?: string;
  result?: string;
  file?: { path: string };
};

type MessageRecord = {
  id: string;
  role: string;
  content: string;
};

export function ChatWorkbench() {
  const [prompt, setPrompt] = useState(
    "Research the latest practical use cases for agentic coding assistants and create a short brief.",
  );
  const [threadId, setThreadId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const currentAssistantMessage = useMemo(
    () => messages.filter((message) => message.role === "assistant").at(-1),
    [messages],
  );

  async function handleRun() {
    setIsRunning(true);
    setEvents([]);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        threadId: threadId || undefined,
        userMessage: prompt,
      }),
    });

    if (!response.body) {
      setIsRunning(false);
      return;
    }

    const nextUserMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    setMessages((current) => [...current, nextUserMessage]);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let draftMessage = "";
    let lastAssistantId = crypto.randomUUID();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame
          .split("\n")
          .find((candidate) => candidate.startsWith("data: "));
        if (!line) {
          continue;
        }
        const event = JSON.parse(line.replace("data: ", "")) as EventRecord;
        setEvents((current) => [...current, event]);

        if (event.threadId && !threadId) {
          setThreadId(event.threadId);
        }

        if (event.type === "message.delta" && event.delta) {
          draftMessage += event.delta;
          setMessages((current) => {
            const existing = current.filter((message) => message.id !== lastAssistantId);
            return [
              ...existing,
              {
                id: lastAssistantId,
                role: "assistant",
                content: draftMessage,
              },
            ];
          });
        }

        if (event.type === "message.final") {
          draftMessage = "";
          lastAssistantId = crypto.randomUUID();
        }
      }
    }

    setIsRunning(false);
  }

  return (
    <div className="shell">
      <section className="hero">
        <span className="pill">Deep agent runtime · Bedrock · CopilotKit-ready</span>
        <h1>Deep Agents in TypeScript, with terminal and web surfaces.</h1>
        <p>
          This app talks to the shared TypeScript deep-agent runtime. The left side
          uses the project&apos;s direct SSE API for transparent event rendering; the
          CopilotKit sidebar is mounted on the same app for agentic chat UI wiring.
        </p>
      </section>

      <section className="workbench">
        <div className="panel">
          <h2>Direct Runtime Workbench</h2>
          <div className="composer">
            <label>
              Thread ID
              <input
                value={threadId}
                onChange={(event) => setThreadId(event.target.value)}
                placeholder="thread_xxx"
                style={{ width: "100%", marginTop: 8, marginBottom: 12, padding: 10 }}
              />
            </label>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <button onClick={handleRun} disabled={isRunning}>
              {isRunning ? "Running..." : "Run Deep Agent"}
            </button>
          </div>

          <div className="messages" style={{ marginTop: 20 }}>
            <h3>Messages</h3>
            {messages.map((message) => (
              <article className="message" key={message.id}>
                <small>{message.role}</small>
                <div>{message.content}</div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Live Trace</h2>
          <div className="state-block">
            <div className="pill">Thread: {threadId || "new thread"}</div>
            <div className="pill">
              Latest assistant chars: {currentAssistantMessage?.content.length ?? 0}
            </div>
          </div>

          <div className="events" style={{ marginTop: 20 }}>
            {events.map((event, index) => (
              <div className="event" key={`${event.type}-${index}`}>
                <small>{event.type}</small>
                <div>
                  {event.summary ??
                    event.result ??
                    event.toolName ??
                    event.file?.path ??
                    event.delta ??
                    ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel copilot-shell">
        <h2>CopilotKit Chat Surface</h2>
        <p>
          The CopilotKit sidebar is mounted below and points at `/api/copilotkit`,
          which proxies the same runtime through an AG-UI compatible endpoint.
        </p>
        <CopilotSidebar />
      </section>
    </div>
  );
}
