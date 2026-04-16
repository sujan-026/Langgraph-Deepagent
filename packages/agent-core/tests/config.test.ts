import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config.js";

describe("loadRuntimeConfig", () => {
  it("loads AWS profile driven config", () => {
    const config = loadRuntimeConfig({
      AWS_REGION: "ap-southeast-1",
      AWS_PROFILE: "engineering-sso",
      BEDROCK_MODEL_ID: "profile-arn",
      TAVILY_API_KEY: "tvly-key",
    });

    expect(config.region).toBe("ap-southeast-1");
    expect(config.profile).toBe("engineering-sso");
    expect(config.modelId).toBe("profile-arn");
    expect(config.tavilyApiKey).toBe("tvly-key");
  });
});
