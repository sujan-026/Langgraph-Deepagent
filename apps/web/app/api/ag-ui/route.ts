import { encodeSseEvent, mapAgentEventToAgUi } from "@deep-agents/agent-core";
import { NextRequest } from "next/server";

import { getRuntime } from "@/lib/runtime";

type AgUiInput = {
  threadId?: string;
  runId?: string;
  messages?: Array<{
    id?: string;
    role: string;
    content?: unknown;
    toolCalls?: Array<{
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
    toolCallId?: string;
  }>;
  state?: unknown;
  tools?: Array<{
    name: string;
    description: string;
    metadata?: Record<string, unknown>;
    parameters?: unknown;
  }>;
  context?: Array<{
    value: string;
    description: string;
  }>;
};

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }

  return "";
}

function normalizeAgUiMessages(messages: AgUiInput["messages"] = []) {
  return messages
    .filter((message) =>
      ["user", "assistant", "system", "developer", "tool"].includes(message.role),
    )
    .map((message) => ({
      id: message.id ?? crypto.randomUUID(),
      role: message.role,
      content: normalizeMessageContent(message.content),
      toolCalls: message.toolCalls
        ?.filter((toolCall) => toolCall.type === "function" && toolCall.function?.name)
        .map((toolCall) => ({
          id: toolCall.id ?? crypto.randomUUID(),
          type: "function" as const,
          function: {
            name: String(toolCall.function?.name),
            arguments: String(toolCall.function?.arguments ?? ""),
          },
        })),
      toolCallId: message.toolCallId,
    }));
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as AgUiInput;
  const threadId = body.threadId ?? crypto.randomUUID();
  const runId = body.runId ?? crypto.randomUUID();
  const normalizedMessages = normalizeAgUiMessages(body.messages);
  const latestUserMessage =
    normalizedMessages.filter((message) => message.role === "user").at(-1)?.content ?? "";

  const runtime = getRuntime();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (!latestUserMessage) {
        controller.enqueue(
          encodeSseEvent({
            type: "RUN_STARTED",
            threadId,
            runId,
            input: {
              threadId,
              runId,
              state: body.state ?? {},
              messages: normalizedMessages,
              tools: body.tools ?? [],
              context: body.context ?? [],
            },
          }),
        );
        controller.enqueue(
          encodeSseEvent({
            type: "RUN_FINISHED",
            threadId,
            runId,
          }),
        );
        controller.close();
        return;
      }

      controller.enqueue(
        encodeSseEvent({
          type: "RUN_STARTED",
          threadId,
          runId,
          input: {
            threadId,
            runId,
            state: body.state ?? {},
            messages: normalizedMessages,
            tools: body.tools ?? [],
            context: body.context ?? [],
          },
        }),
      );

      for await (const event of runtime.stream({
        threadId,
        userMessage: latestUserMessage,
      })) {
        for (const agUiEvent of mapAgentEventToAgUi(event, runId)) {
          controller.enqueue(encodeSseEvent(agUiEvent));
        }
        if (event.type === "run.completed") {
          controller.enqueue(
            encodeSseEvent({
              type: "RUN_FINISHED",
              threadId: event.threadId,
              runId,
            }),
          );
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
