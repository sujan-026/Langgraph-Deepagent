import path from "node:path";
import { z } from "zod";

import { getRepoRoot } from "./env.js";

export interface RuntimeConfig {
  region: string;
  profile?: string;
  modelId: string;
  summarizerModelId: string;
  tavilyApiKey?: string;
  maxIterations: number;
  maxSubagentDepth: number;
  maxParallelSubagents: number;
  storage: {
    driver: "memory" | "sqlite";
    sqlitePath: string;
  };
  tracing: {
    enabled: boolean;
    apiKey?: string;
    project: string;
    endpoint: string;
  };
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const ConfigSchema = z.object({
  AWS_REGION: z.string().default("ap-southeast-1"),
  AWS_PROFILE: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().min(1),
  BEDROCK_SUMMARIZER_MODEL_ID: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  DEEP_AGENT_MAX_ITERATIONS: z.coerce.number().default(8),
  DEEP_AGENT_MAX_SUBAGENT_DEPTH: z.coerce.number().default(1),
  DEEP_AGENT_MAX_PARALLEL_SUBAGENTS: z.coerce.number().default(2),
  DEEP_AGENT_STORAGE_DRIVER: z.enum(["memory", "sqlite"]).default("sqlite"),
  DEEP_AGENT_SQLITE_PATH: z
    .string()
    .default(path.join(getRepoRoot(), ".deep-agent", "threads.sqlite")),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_TRACING: z.preprocess((value) => parseBoolean(value), z.boolean()).default(false),
  LANGSMITH_PROJECT: z.string().default("deep-agents-from-scratch"),
  LANGSMITH_ENDPOINT: z.string().default("https://api.smith.langchain.com"),
});

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const parsed = ConfigSchema.parse(env);
  const repoRoot = getRepoRoot();
  return {
    region: parsed.AWS_REGION,
    profile: parsed.AWS_PROFILE,
    modelId: parsed.BEDROCK_MODEL_ID,
    summarizerModelId:
      parsed.BEDROCK_SUMMARIZER_MODEL_ID ?? parsed.BEDROCK_MODEL_ID,
    tavilyApiKey: parsed.TAVILY_API_KEY,
    maxIterations: parsed.DEEP_AGENT_MAX_ITERATIONS,
    maxSubagentDepth: parsed.DEEP_AGENT_MAX_SUBAGENT_DEPTH,
    maxParallelSubagents: parsed.DEEP_AGENT_MAX_PARALLEL_SUBAGENTS,
    storage: {
      driver: parsed.DEEP_AGENT_STORAGE_DRIVER,
      sqlitePath: path.isAbsolute(parsed.DEEP_AGENT_SQLITE_PATH)
        ? parsed.DEEP_AGENT_SQLITE_PATH
        : path.resolve(repoRoot, parsed.DEEP_AGENT_SQLITE_PATH),
    },
    tracing: {
      enabled: parsed.LANGSMITH_TRACING && Boolean(parsed.LANGSMITH_API_KEY),
      apiKey: parsed.LANGSMITH_API_KEY,
      project: parsed.LANGSMITH_PROJECT,
      endpoint: parsed.LANGSMITH_ENDPOINT,
    },
  };
}
