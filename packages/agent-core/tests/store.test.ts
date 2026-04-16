import { describe, expect, it } from "vitest";

import { InMemoryThreadStore } from "../src/store.js";
import type { DeepAgentState } from "../src/types.js";

describe("InMemoryThreadStore", () => {
  it("saves and loads thread state", async () => {
    const store = new InMemoryThreadStore();
    const state: DeepAgentState = {
      threadId: "thread_1",
      messages: [],
      todos: [],
      files: {},
      subagentRuns: [],
      artifacts: [],
      sessionMetadata: {
        provider: "bedrock",
        modelId: "model",
        region: "ap-southeast-1",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.saveThread(state);
    const loaded = await store.getThread("thread_1");

    expect(loaded?.threadId).toBe("thread_1");
    expect(loaded?.sessionMetadata.region).toBe("ap-southeast-1");
  });
});
