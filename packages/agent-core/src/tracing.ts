import { randomUUID } from "node:crypto";

import { Client } from "langsmith";

import type { RuntimeConfig } from "./config.js";

type LangSmithRunType = "chain" | "tool" | "llm";

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

type RunPayload = {
  id?: string;
  name: string;
  run_type: LangSmithRunType;
  session_name: string;
  trace_id: string;
  dotted_order?: string;
  execution_order?: number;
  parent_run_id?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  start_time?: string;
  end_time?: string;
  extra?: Record<string, unknown>;
  tags?: string[];
};

export interface TraceRun {
  id: string;
  traceId: string;
  dottedOrder: string;
  executionOrder: number;
  end(outputs?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<void>;
  fail(error: unknown, extra?: Record<string, unknown>): Promise<void>;
  startChild(args: {
    name: string;
    runType: LangSmithRunType;
    inputs?: Record<string, unknown>;
    extra?: Record<string, unknown>;
    tags?: string[];
  }): Promise<TraceRun>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeEndpoint(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

function stripNonAlphanumeric(input: string): string {
  return input.replace(/[-:.]/g, "");
}

function buildDottedOrderSegment(
  timestamp: string,
  runId: string,
  executionOrder = 1,
): string {
  const paddedOrder = executionOrder.toFixed(0).slice(0, 3).padStart(3, "0");
  const microsecondPrecisionTimestamp = `${timestamp.replace(/Z$/u, "")}${paddedOrder}Z`;
  return `${stripNonAlphanumeric(microsecondPrecisionTimestamp)}${runId}`;
}

function serializeValue(value: unknown): Serializable {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        serializeValue(item),
      ]),
    );
  }

  return String(value);
}

function serializeRecord(
  value?: Record<string, unknown>,
): Record<string, Serializable> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeValue(item)]),
  );
}

function mergeExtra(
  extra?: Record<string, unknown>,
  tags?: string[],
): Record<string, Serializable> | undefined {
  const serializedExtra = serializeRecord(extra) ?? {};
  if (tags && tags.length > 0) {
    return {
      ...serializedExtra,
      metadata: {
        ...(typeof serializedExtra.metadata === "object" &&
        serializedExtra.metadata !== null &&
        !Array.isArray(serializedExtra.metadata)
          ? serializedExtra.metadata
          : {}),
        tags,
      },
    };
  }

  return Object.keys(serializedExtra).length > 0 ? serializedExtra : undefined;
}

class NoopTraceRun implements TraceRun {
  id = "noop";
  traceId = "noop";
  dottedOrder = "noop";
  executionOrder = 1;

  async end(): Promise<void> {}

  async fail(): Promise<void> {}

  async startChild(): Promise<TraceRun> {
    return new NoopTraceRun();
  }
}

class LangSmithTraceRun implements TraceRun {
  private childExecutionOrder = 1;

  constructor(
    private readonly client: LangSmithClient,
    public readonly id: string,
    public readonly traceId: string,
    public readonly dottedOrder: string,
    public readonly executionOrder: number,
  ) {}

  async end(
    outputs?: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.client.updateRun(this.id, {
      outputs,
      extra,
      end_time: new Date().toISOString(),
    });
  }

  async fail(error: unknown, extra?: Record<string, unknown>): Promise<void> {
    await this.client.updateRun(this.id, {
      error: toErrorMessage(error),
      extra,
      end_time: new Date().toISOString(),
    });
  }

  async startChild(args: {
    name: string;
    runType: LangSmithRunType;
    inputs?: Record<string, unknown>;
    extra?: Record<string, unknown>;
    tags?: string[];
  }): Promise<TraceRun> {
    const childId = randomUUID();
    const startTime = new Date().toISOString();
    const executionOrder = this.childExecutionOrder;
    this.childExecutionOrder += 1;
    return this.client.createRun({
      id: childId,
      name: args.name,
      run_type: args.runType,
      session_name: this.client.project,
      trace_id: this.traceId,
      dotted_order: `${this.dottedOrder}.${buildDottedOrderSegment(startTime, childId, executionOrder)}`,
      execution_order: executionOrder,
      parent_run_id: this.id,
      inputs: args.inputs,
      extra: args.extra,
      tags: args.tags,
      start_time: startTime,
    });
  }
}

export class LangSmithClient {
  public readonly project: string;
  private readonly apiKey?: string;
  private readonly client: Client;
  private warned = false;

  constructor(config: RuntimeConfig) {
    this.project = config.tracing.project;
    this.apiKey = config.tracing.apiKey;
    this.client = new Client({
      apiKey: config.tracing.apiKey,
      apiUrl: sanitizeEndpoint(config.tracing.endpoint),
    });
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async createRootRun(args: {
    name: string;
    inputs?: Record<string, unknown>;
    extra?: Record<string, unknown>;
    tags?: string[];
  }): Promise<TraceRun> {
    if (!this.enabled) {
      return new NoopTraceRun();
    }

    const traceId = randomUUID();
    const startTime = new Date().toISOString();
    return this.createRun({
      id: traceId,
      name: args.name,
      run_type: "chain",
      session_name: this.project,
      trace_id: traceId,
      dotted_order: buildDottedOrderSegment(startTime, traceId, 1),
      execution_order: 1,
      inputs: args.inputs,
      extra: args.extra,
      tags: args.tags,
      start_time: startTime,
    });
  }

  async createRun(payload: RunPayload): Promise<TraceRun> {
    if (!this.enabled) {
      return new NoopTraceRun();
    }

    const id = payload.id || randomUUID();
    const ok = await this.send(async () => {
      await this.client.createRun({
        id,
        name: payload.name,
        run_type: payload.run_type,
        project_name: this.project,
        trace_id: payload.trace_id,
        dotted_order: payload.dotted_order,
        parent_run_id: payload.parent_run_id,
        inputs: serializeRecord(payload.inputs) ?? {},
        outputs: serializeRecord(payload.outputs),
        extra: mergeExtra(payload.extra, payload.tags),
        error: payload.error,
        start_time: payload.start_time,
        end_time: payload.end_time,
      });
    });

    if (!ok) {
      return new NoopTraceRun();
    }

    return new LangSmithTraceRun(
      this,
      id,
      payload.trace_id,
      payload.dotted_order ??
        buildDottedOrderSegment(
          payload.start_time ?? new Date().toISOString(),
          id,
          payload.execution_order ?? 1,
        ),
      payload.execution_order ?? 1,
    );
  }

  async updateRun(id: string, payload: Partial<RunPayload>): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.send(async () => {
      await this.client.updateRun(id, {
        inputs: serializeRecord(payload.inputs),
        outputs: serializeRecord(payload.outputs),
        extra: mergeExtra(payload.extra, payload.tags),
        error: payload.error,
        start_time: payload.start_time,
        end_time: payload.end_time,
        parent_run_id: payload.parent_run_id,
        trace_id: payload.trace_id,
        dotted_order: payload.dotted_order,
        tags: payload.tags,
      });
    });
  }

  private async send(operation: () => Promise<void>): Promise<boolean> {
    try {
      await operation();
      return true;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[langsmith] ${toErrorMessage(error)}`);
      }
      return false;
    }
  }
}

export function createLangSmithClient(config: RuntimeConfig): LangSmithClient | null {
  if (!config.tracing.enabled || !config.tracing.apiKey) {
    return null;
  }
  return new LangSmithClient(config);
}
