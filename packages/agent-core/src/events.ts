import type { DeepAgentMessage, SubagentRun, Todo, VirtualFile } from "./types.js";

interface BaseAgentEvent {
  timestamp: string;
  threadId: string;
  runId: string;
}

export interface MessageDeltaEvent extends BaseAgentEvent {
  type: "message.delta";
  messageId: string;
  delta: string;
}

export interface MessageFinalEvent extends BaseAgentEvent {
  type: "message.final";
  message: DeepAgentMessage;
}

export interface ToolCallStartedEvent extends BaseAgentEvent {
  type: "tool.call.started";
  toolCallId: string;
  toolName: string;
  args: string;
}

export interface ToolCallCompletedEvent extends BaseAgentEvent {
  type: "tool.call.completed";
  toolCallId: string;
  toolName: string;
  result: string;
}

export interface TodoUpdatedEvent extends BaseAgentEvent {
  type: "todo.updated";
  todos: Todo[];
}

export interface FileUpdatedEvent extends BaseAgentEvent {
  type: "file.updated";
  file: VirtualFile;
}

export interface SubagentStartedEvent extends BaseAgentEvent {
  type: "subagent.started";
  subagentRun: SubagentRun;
}

export interface SubagentCompletedEvent extends BaseAgentEvent {
  type: "subagent.completed";
  subagentRun: SubagentRun;
}

export interface ReasoningSummaryEvent extends BaseAgentEvent {
  type: "reasoning.summary";
  summary: string;
}

export interface RunCompletedEvent extends BaseAgentEvent {
  type: "run.completed";
}

export interface RunErrorEvent extends BaseAgentEvent {
  type: "run.error";
  error: string;
}

export type AgentEvent =
  | MessageDeltaEvent
  | MessageFinalEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | TodoUpdatedEvent
  | FileUpdatedEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent
  | ReasoningSummaryEvent
  | RunCompletedEvent
  | RunErrorEvent;
