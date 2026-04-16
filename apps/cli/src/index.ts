#!/usr/bin/env node

import readline from "node:readline/promises";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";

import {
  createDeepAgentRuntime,
  InMemoryThreadStore,
  loadRuntimeConfig,
  loadRepoEnv,
  SqliteThreadStore,
  type AgentEvent,
} from "@deep-agents/agent-core";
import { Command } from "commander";

loadRepoEnv();

const program = new Command();

function createRuntime() {
  const config = loadRuntimeConfig(process.env);
  const store =
    config.storage.driver === "sqlite"
      ? new SqliteThreadStore(config.storage.sqlitePath)
      : new InMemoryThreadStore();

  return createDeepAgentRuntime({
    config,
    store,
  });
}

function renderEvent(event: AgentEvent) {
  switch (event.type) {
    case "message.delta":
      output.write(event.delta);
      break;
    case "message.final":
      output.write("\n");
      break;
    case "tool.call.started":
      output.write(`\n[tool] ${event.toolName} ${event.args}\n`);
      break;
    case "tool.call.completed":
      output.write(`[tool-result] ${event.toolName}: ${event.result}\n`);
      break;
    case "todo.updated":
      output.write(`[todos] ${event.todos.map((todo) => `${todo.status}:${todo.content}`).join(" | ")}\n`);
      break;
    case "file.updated":
      output.write(`[file] ${event.file.path}\n`);
      break;
    case "subagent.started":
      output.write(`[subagent] started ${event.subagentRun.subagentType}: ${event.subagentRun.description}\n`);
      break;
    case "subagent.completed":
      output.write(`[subagent] completed ${event.subagentRun.subagentType}: ${event.subagentRun.summary ?? ""}\n`);
      break;
    case "reasoning.summary":
      output.write(`[reasoning] ${event.summary}\n`);
      break;
    case "run.error":
      output.write(`[error] ${event.error}\n`);
      break;
    default:
      break;
  }
}

async function chatLoop(initialThreadId?: string) {
  const runtime = createRuntime();
  const rl = readline.createInterface({ input, output });
  let threadId = initialThreadId;

  output.write("Deep Agent CLI\n");
  output.write("Type /exit to quit.\n\n");

  while (true) {
    const userMessage = await rl.question(`thread:${threadId ?? "new"} > `);
    if (userMessage.trim() === "/exit") {
      break;
    }

    for await (const event of runtime.stream({
      threadId,
      userMessage,
    })) {
      renderEvent(event);
      threadId = event.threadId;
    }
    output.write(`\n[thread] ${threadId}\n\n`);
  }

  rl.close();
}

program.name("deep-agent");

program
  .command("chat")
  .description("Start an interactive deep-agent terminal session.")
  .action(async () => {
    await chatLoop();
  });

program
  .command("resume")
  .argument("<threadId>", "Thread to resume")
  .description("Resume a prior thread.")
  .action(async (threadId: string) => {
    await chatLoop(threadId);
  });

program.parseAsync(process.argv);
