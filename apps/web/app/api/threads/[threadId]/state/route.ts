import { NextRequest } from "next/server";

import { getRuntime } from "@/lib/runtime";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  const state = await getRuntime().getThreadState(threadId);
  return Response.json(
    state ?? {
      error: "Thread not found",
    },
  );
}
