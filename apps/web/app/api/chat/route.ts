import { encodeSseEvent } from "@deep-agents/agent-core";
import { NextRequest } from "next/server";

import { getRuntime } from "@/lib/runtime";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    threadId?: string;
    userMessage: string;
  };

  const runtime = getRuntime();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const event of runtime.stream({
        threadId: body.threadId,
        userMessage: body.userMessage,
      })) {
        controller.enqueue(encodeSseEvent(event));
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
