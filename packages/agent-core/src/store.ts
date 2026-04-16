import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type { AgentEvent } from "./events.js";
import type { DeepAgentState } from "./types.js";

export interface ThreadStore {
  getThread(threadId: string): Promise<DeepAgentState | null>;
  saveThread(state: DeepAgentState): Promise<void>;
  appendEvents(threadId: string, events: AgentEvent[]): Promise<void>;
  listEvents(threadId: string): Promise<AgentEvent[]>;
}

export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, DeepAgentState>();
  private readonly events = new Map<string, AgentEvent[]>();

  async getThread(threadId: string): Promise<DeepAgentState | null> {
    return this.threads.get(threadId) ?? null;
  }

  async saveThread(state: DeepAgentState): Promise<void> {
    this.threads.set(state.threadId, state);
  }

  async appendEvents(threadId: string, events: AgentEvent[]): Promise<void> {
    const existing = this.events.get(threadId) ?? [];
    existing.push(...events);
    this.events.set(threadId, existing);
  }

  async listEvents(threadId: string): Promise<AgentEvent[]> {
    return this.events.get(threadId) ?? [];
  }
}

export class SqliteThreadStore implements ThreadStore {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `);
  }

  async getThread(threadId: string): Promise<DeepAgentState | null> {
    const row = this.db
      .prepare("SELECT state_json FROM threads WHERE thread_id = ?")
      .get(threadId) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as DeepAgentState) : null;
  }

  async saveThread(state: DeepAgentState): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO threads(thread_id, state_json) VALUES(?, ?) ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json",
      )
      .run(state.threadId, JSON.stringify(state));
  }

  async appendEvents(threadId: string, events: AgentEvent[]): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT INTO thread_events(thread_id, event_json) VALUES(?, ?)",
    );
    const transaction = this.db.transaction((items: AgentEvent[]) => {
      for (const event of items) {
        stmt.run(threadId, JSON.stringify(event));
      }
    });
    transaction(events);
  }

  async listEvents(threadId: string): Promise<AgentEvent[]> {
    const rows = this.db
      .prepare(
        "SELECT event_json FROM thread_events WHERE thread_id = ? ORDER BY id ASC",
      )
      .all(threadId) as Array<{ event_json: string }>;
    return rows.map((row) => JSON.parse(row.event_json) as AgentEvent);
  }
}
