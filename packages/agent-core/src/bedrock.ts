import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";

import type { RuntimeConfig } from "./config.js";

export interface BedrockToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelTurnResult {
  assistantBlocks: ContentBlock[];
  text: string;
  toolUses: Array<{
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

export function createBedrockClient(config: RuntimeConfig): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: config.region,
  });
}

export async function runModelTurn(args: {
  client: BedrockRuntimeClient;
  modelId: string;
  systemPrompt: string;
  messages: Message[];
  tools?: BedrockToolSpec[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ModelTurnResult> {
  const tools: Tool[] | undefined = args.tools?.map(
    (tool): Tool => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          json: tool.inputSchema as never,
        },
      },
    }),
  );

  const response = await args.client.send(
    new ConverseCommand({
      modelId: args.modelId,
      system: [{ text: args.systemPrompt }],
      messages: args.messages,
      inferenceConfig: {
        temperature: args.temperature ?? 0.1,
        maxTokens: args.maxTokens ?? 1200,
      },
      toolConfig: tools ? { tools } : undefined,
    }),
  );

  const assistantBlocks = response.output?.message?.content ?? [];
  const toolUses = assistantBlocks
    .filter((block) => block.toolUse)
    .map((block) => ({
      toolUseId: block.toolUse!.toolUseId!,
      name: block.toolUse!.name!,
      input: (block.toolUse!.input ?? {}) as Record<string, unknown>,
    }));

  const text = assistantBlocks
    .map((block) => block.text ?? "")
    .filter(Boolean)
    .join("");

  return {
    assistantBlocks,
    text,
    toolUses,
  };
}
