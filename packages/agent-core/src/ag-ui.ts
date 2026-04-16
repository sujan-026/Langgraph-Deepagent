import type { AgentEvent } from "./events.js";

function baseChunk(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function encodeSseEvent(event: unknown): Uint8Array {
  return baseChunk(event);
}

export function mapAgentEventToAgUi(event: AgentEvent, runId: string): unknown[] {
  switch (event.type) {
    case "message.delta":
      return [
        {
          type: "TEXT_MESSAGE_CHUNK",
          messageId: event.messageId,
          delta: event.delta,
        },
      ];
    case "message.final":
      return [];
    case "tool.call.started":
      return [
        {
          type: "TOOL_CALL_START",
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: event.toolCallId,
          delta: event.args,
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: event.toolCallId,
        },
      ];
    case "tool.call.completed":
      return [
        {
          type: "TOOL_CALL_RESULT",
          messageId: `${runId}_${event.toolCallId}`,
          toolCallId: event.toolCallId,
          role: "tool",
          content: event.result,
        },
      ];
    case "reasoning.summary":
      return [
        {
          type: "TEXT_MESSAGE_CHUNK",
          messageId: `${runId}_reasoning`,
          delta: `\n[Reasoning] ${event.summary}\n`,
        },
      ];
    case "run.error":
      return [
        {
          type: "RUN_ERROR",
          message: event.error,
        },
      ];
    default:
      return [];
  }
}
