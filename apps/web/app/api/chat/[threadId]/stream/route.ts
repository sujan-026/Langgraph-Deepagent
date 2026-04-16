import { encodeSseEvent } from "@deep-agents/agent-core";
import { NextRequest } from "next/server";

import { getRuntime } from "@/lib/runtime";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  const state = await getRuntime().getThreadState(threadId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (state) {
        for (const message of state.messages) {
          controller.enqueue(
            encodeSseEvent({
              type: "message.final",
              threadId,
              runId: "historical",
              timestamp: new Date().toISOString(),
              message,
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
