#!/usr/bin/env node
/**
 * Database management tool for toolwatch
 *
 * Usage:
 *   node scripts/db-tool.mjs <db-path> export [options]
 *   node scripts/db-tool.mjs <db-path> delete [options] [--dry-run]
 *
 * Options:
 *   --user <name>       Filter by user
 *   --tool <name>       Filter by tool
 *   --model <name>      Filter by model
 *   --approval <status> Filter by approval status (pending|approved|denied)
 *   --error             Filter to errors only
 *   --success           Filter to successes only
 *   --before <date>     Filter to before date (ISO format or timestamp)
 *   --after <date>      Filter to after date (ISO format or timestamp)
 *   --search <text>     Search in params
 *   --limit <n>         Limit results (export only)
 *   --output <file>     Output file (export only, default: stdout)
 *   --dry-run           Show what would be deleted without deleting
 *
 * Examples:
 *   node scripts/db-tool.mjs ./toolwatch.db export --user alice --output export.json
 *   node scripts/db-tool.mjs ./toolwatch.db export --before 2026-01-01 --tool bash
 *   node scripts/db-tool.mjs ./toolwatch.db delete --approval pending --dry-run
 *   node scripts/db-tool.mjs ./toolwatch.db delete --before 2026-01-01
 */

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage:
  node scripts/db-tool.mjs <db-path> export [options]
  node scripts/db-tool.mjs <db-path> delete [options] [--dry-run]

Options:
  --user <name>       Filter by user
  --tool <name>       Filter by tool
  --model <name>      Filter by model
  --approval <status> Filter by approval status (pending|approved|denied)
  --error             Filter to errors only
  --success           Filter to successes only
  --before <date>     Filter to before date (ISO format or timestamp)
  --after <date>      Filter to after date (ISO format or timestamp)
  --search <text>     Search in params
  --limit <n>         Limit results (export only)
  --output <file>     Output file (export only, default: stdout)
  --dry-run           Show what would be deleted without deleting

Examples:
  node scripts/db-tool.mjs ./toolwatch.db export --user alice --output export.json
  node scripts/db-tool.mjs ./toolwatch.db delete --before 2026-01-01 --dry-run`);
  process.exit(1);
}

function parseArgs(args) {
  const opts = {
    dbPath: null,
    command: null,
    user: null,
    tool: null,
    model: null,
    approval: null,
    isError: null,
    before: null,
    after: null,
    search: null,
    limit: null,
    output: null,
    dryRun: false,
  };

  let i = 0;

  // First arg: db path
  if (args.length < 2) usage();
  opts.dbPath = args[i++];

  // Second arg: command
  opts.command = args[i++];
  if (!["export", "delete"].includes(opts.command)) {
    console.error(`Unknown command: ${opts.command}`);
    usage();
  }

  // Parse options
  while (i < args.length) {
    const arg = args[i++];
    switch (arg) {
      case "--user":
        opts.user = args[i++];
        break;
      case "--tool":
        opts.tool = args[i++];
        break;
      case "--model":
        opts.model = args[i++];
        break;
      case "--approval":
        opts.approval = args[i++];
        break;
      case "--error":
        opts.isError = true;
        break;
      case "--success":
        opts.isError = false;
        break;
      case "--before":
        opts.before = parseDate(args[i++]);
        break;
      case "--after":
        opts.after = parseDate(args[i++]);
        break;
      case "--search":
        opts.search = args[i++];
        break;
      case "--limit":
        opts.limit = parseInt(args[i++], 10);
        break;
      case "--output":
        opts.output = args[i++];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        usage();
    }
  }

  return opts;
}

function parseDate(value) {
  if (!value) return null;
  // If it's a number, treat as timestamp
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  // Otherwise parse as date
  const ts = new Date(value).getTime();
  if (isNaN(ts)) {
    console.error(`Invalid date: ${value}`);
    process.exit(1);
  }
  return ts;
}

function buildWhereClause(opts) {
  const conditions = [];
  const params = [];

  if (opts.user) {
    conditions.push("user = ?");
    params.push(opts.user);
  }
  if (opts.tool) {
    conditions.push("tool = ?");
    params.push(opts.tool);
  }
  if (opts.model) {
    conditions.push("model = ?");
    params.push(opts.model);
  }
  if (opts.approval) {
    conditions.push("approval_status = ?");
    params.push(opts.approval);
  }
  if (opts.isError !== null) {
    conditions.push("is_error = ?");
    params.push(opts.isError ? 1 : 0);
  }
  if (opts.before) {
    conditions.push("ts < ?");
    params.push(opts.before);
  }
  if (opts.after) {
    conditions.push("ts >= ?");
    params.push(opts.after);
  }
  if (opts.search) {
    conditions.push("params LIKE ?");
    params.push(`%${opts.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

function exportData(db, opts) {
  const { where, params } = buildWhereClause(opts);
  const limitClause = opts.limit ? `LIMIT ${opts.limit}` : "";

  const query = `
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
    ${limitClause}
  `;

  const rows = db.prepare(query).all(...params);

  // Parse params JSON
  const data = rows.map((row) => ({
    ...row,
    params: JSON.parse(row.params),
    isError: row.isError === null ? null : Boolean(row.isError),
  }));

  const json = JSON.stringify(data, null, 2);

  if (opts.output) {
    writeFileSync(opts.output, json);
    console.error(`Exported ${data.length} records to ${opts.output}`);
  } else {
    console.log(json);
  }
}

function deleteData(db, opts) {
  const { where, params } = buildWhereClause(opts);

  if (!where) {
    console.error("Error: Delete requires at least one filter to prevent accidental deletion of all data.");
    console.error("Use --before, --after, --user, --tool, --approval, etc.");
    process.exit(1);
  }

  // Count first
  const countQuery = `SELECT COUNT(*) as count FROM tool_calls ${where}`;
  const { count } = db.prepare(countQuery).get(...params);

  if (opts.dryRun) {
    console.log(`Dry run: would delete ${count} records`);

    // Show sample of what would be deleted
    const sampleQuery = `
      SELECT tool_call_id, ts, user, tool, approval_status
      FROM tool_calls ${where}
      ORDER BY ts DESC
      LIMIT 10
    `;
    const samples = db.prepare(sampleQuery).all(...params);

    if (samples.length > 0) {
      console.log("\nSample records that would be deleted:");
      for (const s of samples) {
        const date = new Date(s.ts).toISOString();
        console.log(`  ${date} | ${s.user} | ${s.tool} | ${s.approval_status ?? "-"}`);
      }
      if (count > 10) {
        console.log(`  ... and ${count - 10} more`);
      }
    }
    return;
  }

  // Confirm
  console.error(`About to delete ${count} records.`);

  const deleteQuery = `DELETE FROM tool_calls ${where}`;
  const result = db.prepare(deleteQuery).run(...params);

  console.log(`Deleted ${result.changes} records`);
}

// Main
const opts = parseArgs(args);

const db = new Database(opts.dbPath, { readonly: opts.command === "export" });

try {
  if (opts.command === "export") {
    exportData(db, opts);
  } else if (opts.command === "delete") {
    deleteData(db, opts);
  }
} finally {
  db.close();
}
