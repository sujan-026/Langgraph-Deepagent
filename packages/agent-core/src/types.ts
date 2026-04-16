export type MessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "reasoning"
  | "developer";

export interface DeepAgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  createdAt: string;
}

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface VirtualFile {
  path: string;
  content: string;
  updatedAt: string;
}

export interface SubagentRun {
  id: string;
  parentRunId: string;
  subagentType: string;
  description: string;
  status: "running" | "completed" | "failed";
  summary?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ArtifactRecord {
  id: string;
  type: "search-result" | "summary" | "note";
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SessionMetadata {
  provider: "bedrock";
  modelId: string;
  region: string;
  threadTitle?: string;
}

export interface DeepAgentState {
  threadId: string;
  messages: DeepAgentMessage[];
  todos: Todo[];
  files: Record<string, VirtualFile>;
  subagentRuns: SubagentRun[];
  artifacts: ArtifactRecord[];
  sessionMetadata: SessionMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeContext {
  threadId: string;
  runId: string;
  metadata?: Record<string, string>;
}

export interface RuntimeInput {
  threadId?: string;
  userMessage: string;
  metadata?: Record<string, string>;
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
}
