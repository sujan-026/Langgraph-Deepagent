import type { ConversationRole, Message } from "@aws-sdk/client-bedrock-runtime";

import { createBedrockClient, runModelTurn, type BedrockToolSpec } from "./bedrock.js";
import type { RuntimeConfig } from "./config.js";
import type {
  AgentEvent,
  FileUpdatedEvent,
  ReasoningSummaryEvent,
  RunCompletedEvent,
  RunErrorEvent,
  SubagentCompletedEvent,
  SubagentStartedEvent,
  TodoUpdatedEvent,
  ToolCallCompletedEvent,
  ToolCallStartedEvent,
} from "./events.js";
import { MAIN_SYSTEM_PROMPT, RESEARCH_SUBAGENT_PROMPT, SUMMARY_PROMPT } from "./prompts.js";
import type { ThreadStore } from "./store.js";
import { createLangSmithClient, type TraceRun } from "./tracing.js";
import type {
  ArtifactRecord,
  DeepAgentMessage,
  DeepAgentState,
  RuntimeInput,
  SearchResultItem,
  SessionMetadata,
  SubagentRun,
  Todo,
  VirtualFile,
} from "./types.js";
import { chunkText, makeId, nowIso } from "./utils.js";

type ToolExecutionResult = {
  content: string;
  todos?: Todo[];
  files?: VirtualFile[];
  reasoningSummary?: string;
};

export interface DeepAgentRuntime {
  run(input: RuntimeInput): Promise<DeepAgentState>;
  stream(input: RuntimeInput): AsyncGenerator<AgentEvent>;
  getThreadState(threadId: string): Promise<DeepAgentState | null>;
}

export function createDeepAgentRuntime(args: {
  config: RuntimeConfig;
  store: ThreadStore;
}): DeepAgentRuntime {
  const client = createBedrockClient(args.config);
  const tracer = createLangSmithClient(args.config);

  async function tracedModelTurn(
    traceRun: TraceRun | null | undefined,
    name: string,
    turnArgs: Parameters<typeof runModelTurn>[0],
  ) {
    const modelTrace = await traceRun?.startChild({
      name,
      runType: "llm",
      inputs: {
        modelId: turnArgs.modelId,
        systemPrompt: turnArgs.systemPrompt,
        messageCount: turnArgs.messages.length,
        toolNames: turnArgs.tools?.map((tool) => tool.name) ?? [],
      },
      tags: ["bedrock"],
    });

    try {
      const result = await runModelTurn(turnArgs);
      await modelTrace?.end({
        text: result.text,
        toolUseCount: result.toolUses.length,
        toolNames: result.toolUses.map((toolUse) => toolUse.name),
      });
      return result;
    } catch (error) {
      await modelTrace?.fail(error);
      throw error;
    }
  }

  async function getOrCreateState(threadId: string): Promise<DeepAgentState> {
    const existing = await args.store.getThread(threadId);
    if (existing) {
      return existing;
    }
    const metadata: SessionMetadata = {
      provider: "bedrock",
      modelId: args.config.modelId,
      region: args.config.region,
    };
    return {
      threadId,
      messages: [],
      todos: [],
      files: {},
      subagentRuns: [],
      artifacts: [],
      sessionMetadata: metadata,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  async function summarizeContent(
    content: string,
    traceRun?: TraceRun | null,
  ): Promise<{
    filename: string;
    summary: string;
  }> {
    const summaryResult = await tracedModelTurn(traceRun, "bedrock.summarize", {
      client,
      modelId: args.config.summarizerModelId,
      systemPrompt:
        "Return valid JSON only. Do not wrap the response in markdown fences.",
      messages: [
        {
          role: "user",
          content: [
            {
              text: SUMMARY_PROMPT.replace("{{content}}", content.slice(0, 12000)),
            },
          ],
        },
      ],
      temperature: 0.0,
      maxTokens: 600,
    });

    try {
      const parsed = JSON.parse(summaryResult.text);
      return {
        filename: String(parsed.filename ?? "search-result.md"),
        summary: String(parsed.summary ?? content.slice(0, 300)),
      };
    } catch {
      return {
        filename: "search-result.md",
        summary: content.slice(0, 300),
      };
    }
  }

  async function webSearch(query: string): Promise<SearchResultItem[]> {
    if (!args.config.tavilyApiKey) {
      return [
        {
          title: "Search unavailable",
          url: "about:blank",
          content:
            "TAVILY_API_KEY is not configured. Web search is unavailable in this environment.",
        },
      ];
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: args.config.tavilyApiKey,
        query,
        max_results: 3,
        include_raw_content: true,
      }),
    });

    if (!response.ok) {
      return [
        {
          title: "Search error",
          url: "about:blank",
          content: `Tavily returned ${response.status} ${response.statusText}`,
        },
      ];
    }

    const payload = (await response.json()) as {
      results?: Array<{
        title: string;
        url: string;
        content?: string;
        raw_content?: string;
      }>;
    };

    return (payload.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content ?? "",
      rawContent: result.raw_content,
    }));
  }

  function seedBedrockMessages(state: DeepAgentState): Message[] {
    return state.messages
      .filter((message) => message.role === "assistant" || message.role === "user")
      .map((message): Message => ({
        role: message.role as ConversationRole,
        content: [{ text: message.content }],
      }));
  }

  async function executeTool(argsForTool: {
    name: string;
    input: Record<string, unknown>;
    state: DeepAgentState;
    runId: string;
    currentDepth: number;
    events: AgentEvent[];
    traceRun?: TraceRun | null;
  }): Promise<ToolExecutionResult> {
    const { name, input, state, runId, currentDepth, events, traceRun } = argsForTool;

    if (name === "writeTodos") {
      const todos = Array.isArray(input.todos) ? (input.todos as Todo[]) : [];
      state.todos = todos.map((todo, index) => ({
        id: todo.id ?? `todo-${index + 1}`,
        content: todo.content,
        status: todo.status,
      }));
      const event: TodoUpdatedEvent = {
        type: "todo.updated",
        timestamp: nowIso(),
        threadId: state.threadId,
        runId,
        todos: state.todos,
      };
      events.push(event);
      return {
        content: JSON.stringify(state.todos),
        todos: state.todos,
      };
    }

    if (name === "readTodos") {
      return {
        content: JSON.stringify(state.todos),
      };
    }

    if (name === "ls") {
      return {
        content: JSON.stringify(Object.keys(state.files)),
      };
    }

    if (name === "readFile") {
      const path = String(input.path ?? "");
      const offset = Number(input.offset ?? 0);
      const limit = Number(input.limit ?? 2000);
      const file = state.files[path];
      if (!file) {
        return {
          content: `File not found: ${path}`,
        };
      }
      const lines = file.content.split("\n").slice(offset, offset + limit);
      return {
        content: lines.join("\n"),
      };
    }

    if (name === "writeFile") {
      const path = String(input.path ?? "notes.md");
      const content = String(input.content ?? "");
      const file: VirtualFile = {
        path,
        content,
        updatedAt: nowIso(),
      };
      state.files[path] = file;
      const event: FileUpdatedEvent = {
        type: "file.updated",
        timestamp: nowIso(),
        threadId: state.threadId,
        runId,
        file,
      };
      events.push(event);
      return {
        content: `Updated ${path}`,
        files: [file],
      };
    }

    if (name === "webSearch") {
      const query = String(input.query ?? "");
      const results = await webSearch(query);
      const writtenFiles: VirtualFile[] = [];
      const artifacts: ArtifactRecord[] = [];

      for (const result of results) {
        const sourceText = result.rawContent ?? result.content ?? "";
        const summary = await summarizeContent(sourceText, traceRun);
        const filename = summary.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
        const file: VirtualFile = {
          path: filename,
          content: [
            `# ${result.title}`,
            "",
            `URL: ${result.url}`,
            "",
            `## Summary`,
            summary.summary,
            "",
            `## Raw Content`,
            sourceText,
          ].join("\n"),
          updatedAt: nowIso(),
        };
        state.files[file.path] = file;
        writtenFiles.push(file);
        artifacts.push({
          id: makeId("artifact"),
          type: "search-result",
          title: result.title,
          payload: {
            query,
            url: result.url,
            summary: summary.summary,
            filePath: file.path,
          },
          createdAt: nowIso(),
        });
      }

      state.artifacts.push(...artifacts);

      for (const file of writtenFiles) {
        events.push({
          type: "file.updated",
          timestamp: nowIso(),
          threadId: state.threadId,
          runId,
          file,
        });
      }

      return {
        content: JSON.stringify(
          writtenFiles.map((file) => ({
            path: file.path,
          })),
        ),
        files: writtenFiles,
      };
    }

    if (name === "think") {
      const summary = String(input.reflection ?? "");
      const event: ReasoningSummaryEvent = {
        type: "reasoning.summary",
        timestamp: nowIso(),
        threadId: state.threadId,
        runId,
        summary,
      };
      events.push(event);
      return {
        content: "Recorded reasoning summary.",
        reasoningSummary: summary,
      };
    }

    if (name === "task") {
      if (currentDepth >= args.config.maxSubagentDepth) {
        return {
          content: "Sub-agent depth limit reached.",
        };
      }

      const description = String(input.description ?? "");
      const subagentType = String(input.subagentType ?? "research-agent");
      const subagentRun: SubagentRun = {
        id: makeId("subagent"),
        parentRunId: runId,
        description,
        subagentType,
        status: "running",
        startedAt: nowIso(),
      };
      state.subagentRuns.push(subagentRun);
      const startedEvent: SubagentStartedEvent = {
        type: "subagent.started",
        timestamp: nowIso(),
        threadId: state.threadId,
        runId,
        subagentRun,
      };
      events.push(startedEvent);

      const subState = await runIsolatedSubagent({
        description,
        parentState: state,
        subagentRun,
        currentDepth: currentDepth + 1,
        parentTraceRun: traceRun,
      });

      subagentRun.status = "completed";
      subagentRun.completedAt = nowIso();
      subagentRun.summary =
        subState.messages[subState.messages.length - 1]?.content ?? "Completed";

      Object.assign(state.files, subState.files);
      state.artifacts.push(...subState.artifacts);

      const completedEvent: SubagentCompletedEvent = {
        type: "subagent.completed",
        timestamp: nowIso(),
        threadId: state.threadId,
        runId,
        subagentRun,
      };
      events.push(completedEvent);

      return {
        content: subagentRun.summary,
      };
    }

    return {
      content: `Unknown tool: ${name}`,
    };
  }

  async function runIsolatedSubagent(argsForSubagent: {
    description: string;
    parentState: DeepAgentState;
    subagentRun: SubagentRun;
    currentDepth: number;
    parentTraceRun?: TraceRun | null;
  }): Promise<DeepAgentState> {
    const subagentTrace = await argsForSubagent.parentTraceRun?.startChild({
      name: `subagent:${argsForSubagent.subagentRun.subagentType}`,
      runType: "chain",
      inputs: {
        description: argsForSubagent.description,
        currentDepth: argsForSubagent.currentDepth,
      },
      tags: ["subagent"],
    });

    const subState: DeepAgentState = {
      threadId: argsForSubagent.parentState.threadId,
      messages: [
        {
          id: makeId("msg"),
          role: "user",
          content: argsForSubagent.description,
          createdAt: nowIso(),
        },
      ],
      todos: [],
      files: {},
      subagentRuns: [],
      artifacts: [],
      sessionMetadata: argsForSubagent.parentState.sessionMetadata,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const subagentTools = [toolSpecs.webSearch, toolSpecs.think];
    const bedrockMessages = seedBedrockMessages(subState);

    try {
      for (let iteration = 0; iteration < Math.min(4, args.config.maxIterations); iteration += 1) {
        const turn = await tracedModelTurn(subagentTrace, "bedrock.subagent", {
          client,
          modelId: args.config.modelId,
          systemPrompt: RESEARCH_SUBAGENT_PROMPT,
          messages: bedrockMessages,
          tools: subagentTools,
          temperature: 0.1,
        });

        subState.messages.push({
          id: makeId("msg"),
          role: "assistant",
          content: turn.text || "[tool invocation]",
          createdAt: nowIso(),
        });

        if (turn.toolUses.length === 0) {
          bedrockMessages.push({
            role: "assistant",
            content: [{ text: turn.text || "" }],
          });
          break;
        }

        bedrockMessages.push({
          role: "assistant",
          content: turn.assistantBlocks,
        });

        for (const toolUse of turn.toolUses) {
          const toolTrace = await subagentTrace?.startChild({
            name: `tool:${toolUse.name}`,
            runType: "tool",
            inputs: toolUse.input,
            tags: ["subagent"],
          });

          try {
            const result = await executeTool({
              name: toolUse.name,
              input: toolUse.input,
              state: subState,
              runId: argsForSubagent.subagentRun.id,
              currentDepth: argsForSubagent.currentDepth,
              events: [],
              traceRun: toolTrace,
            });
            await toolTrace?.end({
              content: result.content,
            });
            subState.messages.push({
              id: makeId("msg"),
              role: "tool",
              content: result.content,
              toolCallId: toolUse.toolUseId,
              createdAt: nowIso(),
            });
            bedrockMessages.push({
              role: "user",
              content: [
                {
                  toolResult: {
                    toolUseId: toolUse.toolUseId,
                    content: [{ json: { result: result.content } }],
                    status: "success",
                  },
                },
              ],
            });
          } catch (error) {
            await toolTrace?.fail(error);
            throw error;
          }
        }
      }

      await subagentTrace?.end({
        finalMessage: subState.messages[subState.messages.length - 1]?.content ?? "",
      });
      return subState;
    } catch (error) {
      await subagentTrace?.fail(error);
      throw error;
    }
  }

  const toolSpecs: Record<string, BedrockToolSpec> = {
    writeTodos: {
      name: "writeTodos",
      description: "Create or replace the current todo list.",
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
    readTodos: {
      name: "readTodos",
      description: "Read the current todo list.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    ls: {
      name: "ls",
      description: "List files in the virtual file system.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    readFile: {
      name: "readFile",
      description: "Read content from a virtual file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["path"],
      },
    },
    writeFile: {
      name: "writeFile",
      description: "Write content to a virtual file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    webSearch: {
      name: "webSearch",
      description: "Search the web and write summarized results to files.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    think: {
      name: "think",
      description:
        "Record a concise reasoning summary about what was learned or what happens next.",
      inputSchema: {
        type: "object",
        properties: {
          reflection: { type: "string" },
        },
        required: ["reflection"],
      },
    },
    task: {
      name: "task",
      description: "Delegate a task to the research sub-agent.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string" },
          subagentType: { type: "string" },
        },
        required: ["description", "subagentType"],
      },
    },
  };

  async function* stream(input: RuntimeInput): AsyncGenerator<AgentEvent> {
    const threadId = input.threadId ?? makeId("thread");
    const runId = makeId("run");
    const state = await getOrCreateState(threadId);
    const emittedEvents: AgentEvent[] = [];
    const bedrockMessages = seedBedrockMessages(state);
    let finalAssistantMessage = "";

    const userMessage: DeepAgentMessage = {
      id: makeId("msg"),
      role: "user",
      content: input.userMessage,
      createdAt: nowIso(),
    };
    state.messages.push(userMessage);
    state.updatedAt = nowIso();
    await args.store.saveThread(state);

    const rootTrace = await tracer?.createRootRun({
      name: "deep-agent.run",
      inputs: {
        threadId,
        runId,
        userMessage: input.userMessage,
      },
      extra: {
        modelId: args.config.modelId,
        storageDriver: args.config.storage.driver,
      },
      tags: ["deep-agent"],
    });

    try {
      const availableTools = Object.values(toolSpecs);

      for (let iteration = 0; iteration < args.config.maxIterations; iteration += 1) {
        const turn = await tracedModelTurn(rootTrace, "bedrock.main", {
          client,
          modelId: args.config.modelId,
          systemPrompt: MAIN_SYSTEM_PROMPT,
          messages: bedrockMessages,
          tools: availableTools,
          temperature: 0.1,
        });

        const assistantContent = turn.text || "[tool invocation]";
        finalAssistantMessage = assistantContent;
        const assistantMessage: DeepAgentMessage = {
          id: makeId("msg"),
          role: "assistant",
          content: assistantContent,
          createdAt: nowIso(),
        };
        state.messages.push(assistantMessage);

        if (turn.toolUses.length === 0) {
          bedrockMessages.push({
            role: "assistant",
            content: [{ text: assistantContent }],
          });
          for await (const delta of chunkText(assistantContent, 28)) {
            const event: AgentEvent = {
              type: "message.delta",
              timestamp: nowIso(),
              threadId,
              runId,
              messageId: assistantMessage.id,
              delta,
            };
            emittedEvents.push(event);
            yield event;
          }

          const finalEvent: AgentEvent = {
            type: "message.final",
            timestamp: nowIso(),
            threadId,
            runId,
            message: assistantMessage,
          };
          emittedEvents.push(finalEvent);
          yield finalEvent;
          break;
        }

        bedrockMessages.push({
          role: "assistant",
          content: turn.assistantBlocks,
        });

        for (const toolUse of turn.toolUses) {
          const toolTrace = await rootTrace?.startChild({
            name: `tool:${toolUse.name}`,
            runType: "tool",
            inputs: toolUse.input,
            tags: ["deep-agent"],
          });
          const startedEvent: ToolCallStartedEvent = {
            type: "tool.call.started",
            timestamp: nowIso(),
            threadId,
            runId,
            toolCallId: toolUse.toolUseId,
            toolName: toolUse.name,
            args: JSON.stringify(toolUse.input),
          };
          emittedEvents.push(startedEvent);
          yield startedEvent;

          const toolSideEvents: AgentEvent[] = [];
          const result = await executeTool({
            name: toolUse.name,
            input: toolUse.input,
            state,
            runId,
            currentDepth: 0,
            events: toolSideEvents,
            traceRun: toolTrace,
          });
          await toolTrace?.end({
            content: result.content,
          });

          const completedEvent: ToolCallCompletedEvent = {
            type: "tool.call.completed",
            timestamp: nowIso(),
            threadId,
            runId,
            toolCallId: toolUse.toolUseId,
            toolName: toolUse.name,
            result: result.content,
          };
          emittedEvents.push(...toolSideEvents);
          emittedEvents.push(completedEvent);
          yield completedEvent;

          for (const event of toolSideEvents) {
            yield event;
          }

          state.messages.push({
            id: makeId("msg"),
            role: "tool",
            content: result.content,
            toolCallId: toolUse.toolUseId,
            createdAt: nowIso(),
          });
          bedrockMessages.push({
            role: "user",
            content: [
              {
                toolResult: {
                  toolUseId: toolUse.toolUseId,
                  content: [{ json: { result: result.content } }],
                  status: "success",
                },
              },
            ],
          });
        }
      }

      state.updatedAt = nowIso();
      await args.store.saveThread(state);
      await args.store.appendEvents(threadId, emittedEvents);
      await rootTrace?.end({
        threadId,
        runId,
        finalAssistantMessage,
        messageCount: state.messages.length,
        todoCount: state.todos.length,
        fileCount: Object.keys(state.files).length,
      });

      const completed: RunCompletedEvent = {
        type: "run.completed",
        timestamp: nowIso(),
        threadId,
        runId,
      };
      yield completed;
    } catch (error) {
      await rootTrace?.fail(error, {
        threadId,
        runId,
      });
      const event: RunErrorEvent = {
        type: "run.error",
        timestamp: nowIso(),
        threadId,
        runId,
        error: error instanceof Error ? error.message : String(error),
      };
      yield event;
    }
  }

  return {
    async run(input: RuntimeInput): Promise<DeepAgentState> {
      let resolvedThreadId = input.threadId;
      for await (const _event of stream(input)) {
        resolvedThreadId = _event.threadId;
      }
      if (!resolvedThreadId) {
        throw new Error("Runtime did not resolve a thread id.");
      }
      return (await getOrCreateState(resolvedThreadId))!;
    },
    stream,
    getThreadState(threadId: string) {
      return args.store.getThread(threadId);
    },
  };
}
