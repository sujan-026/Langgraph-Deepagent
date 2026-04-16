import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const runtime = new CopilotRuntime({
    agents: {
      "deep-agent": new HttpAgent({
        url: `${request.nextUrl.origin}/api/ag-ui`,
      }),
    },
  });
  const serviceAdapter = new ExperimentalEmptyAdapter();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}

export const GET = POST;
