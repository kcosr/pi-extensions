import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export interface ToolCall {
  id: number;
  toolCallId: string;
  ts: number;
  user: string;
  hostname: string;
  session: string | null;
  cwd: string;
  model: string;
  tool: string;
  params: string; // JSON
  isError: boolean | null;
  durationMs: number | null;
  exitCode: number | null;
  resultTs: number | null;
  approvalStatus: "pending" | "approved" | "denied" | null;
  approvalReason: string | null;
}

export interface ToolCallFilter {
  user?: string;
  tool?: string;
  model?: string;
  isError?: boolean;
  approvalStatus?: "pending" | "approved" | "denied";
  search?: string; // search in params
  from?: number; // timestamp
  to?: number;
  limit?: number;
  offset?: number;
}

export class ToolwatchDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_call_id TEXT UNIQUE NOT NULL,
        ts INTEGER NOT NULL,
        user TEXT NOT NULL,
        hostname TEXT NOT NULL,
        session TEXT,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL,
        is_error INTEGER,
        duration_ms INTEGER,
        exit_code INTEGER,
        result_ts INTEGER,
        approval_status TEXT,
        approval_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_user ON tool_calls(user);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(ts);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_approval ON tool_calls(approval_status);
    `);
  }

  insertToolCall(event: {
    toolCallId: string;
    ts: number;
    user: string;
    hostname: string;
    session: string | null;
    cwd: string;
    model: string;
    tool: string;
    params: Record<string, unknown>;
    approvalStatus?: "pending" | "approved" | "denied" | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO tool_calls (tool_call_id, ts, user, hostname, session, cwd, model, tool, params, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.toolCallId,
      event.ts,
      event.user,
      event.hostname,
      event.session,
      event.cwd,
      event.model,
      event.tool,
      JSON.stringify(event.params),
      event.approvalStatus ?? null
    );
  }

  updateToolResult(event: {
    toolCallId: string;
    ts: number;
    isError: boolean;
    durationMs: number;
    exitCode?: number;
  }) {
    const stmt = this.db.prepare(`
      UPDATE tool_calls
      SET is_error = ?, duration_ms = ?, exit_code = ?, result_ts = ?
      WHERE tool_call_id = ?
    `);

    stmt.run(
      event.isError ? 1 : 0,
      event.durationMs,
      event.exitCode ?? null,
      event.ts,
      event.toolCallId
    );
  }

  query(filter: ToolCallFilter = {}): ToolCall[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.user) {
      conditions.push("user = ?");
      params.push(filter.user);
    }
    if (filter.tool) {
      conditions.push("tool = ?");
      params.push(filter.tool);
    }
    if (filter.model) {
      conditions.push("model = ?");
      params.push(filter.model);
    }
    if (filter.isError !== undefined) {
      conditions.push("is_error = ?");
      params.push(filter.isError ? 1 : 0);
    }
    if (filter.approvalStatus) {
      conditions.push("approval_status = ?");
      params.push(filter.approvalStatus);
    }
    if (filter.search) {
      conditions.push("params LIKE ?");
      params.push(`%${filter.search}%`);
    }
    if (filter.from) {
      conditions.push("ts >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push("ts <= ?");
      params.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const stmt = this.db.prepare(`
      SELECT
        id,
        tool_call_id as toolCallId,
        ts,
        user,
        hostname,
        session,
        cwd,
        model,
        tool,
        params,
        is_error as isError,
        duration_ms as durationMs,
        exit_code as exitCode,
        result_ts as resultTs,
        approval_status as approvalStatus,
        approval_reason as approvalReason
      FROM tool_calls
      ${where}
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(...params, limit, offset) as ToolCall[];
  }

  getUsers(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT user FROM tool_calls ORDER BY user");
    return stmt.all().map((row: { user: string }) => row.user);
  }

  getTools(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT tool FROM tool_calls ORDER BY tool");
    return stmt.all().map((row: { tool: string }) => row.tool);
  }

  getModels(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT model FROM tool_calls ORDER BY model");
    return stmt.all().map((row: { model: string }) => row.model);
  }

  getStats(): { total: number; users: number; tools: number; errors: number } {
    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT user) as users,
        COUNT(DISTINCT tool) as tools,
        SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as errors
      FROM tool_calls
    `
      )
      .get() as { total: number; users: number; tools: number; errors: number };

    return stats;
  }

  // Approval methods

  getPendingApprovals(): ToolCall[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        tool_call_id as toolCallId,
        ts,
        user,
        hostname,
        session,
        cwd,
        model,
        tool,
        params,
        is_error as isError,
        duration_ms as durationMs,
        exit_code as exitCode,
        result_ts as resultTs,
        approval_status as approvalStatus,
        approval_reason as approvalReason
      FROM tool_calls
      WHERE approval_status = 'pending'
      ORDER BY ts ASC
    `);
    return stmt.all() as ToolCall[];
  }

  getApprovalStatus(toolCallId: string): { status: string | null; reason: string | null } | null {
    const stmt = this.db.prepare(`
      SELECT approval_status as status, approval_reason as reason
      FROM tool_calls
      WHERE tool_call_id = ?
    `);
    return stmt.get(toolCallId) as { status: string | null; reason: string | null } | null;
  }

  updateApprovalStatus(toolCallId: string, status: "approved" | "denied", reason?: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE tool_calls
      SET approval_status = ?, approval_reason = ?
      WHERE tool_call_id = ? AND approval_status = 'pending'
    `);
    const result = stmt.run(status, reason ?? null, toolCallId);
    return result.changes > 0;
  }

  close() {
    this.db.close();
  }
}
