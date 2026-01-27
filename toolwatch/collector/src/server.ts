import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ToolwatchDB, type ToolCallFilter, type ToolCall } from "./db.js";
import { renderPage } from "./ui.js";
import { evaluateRules } from "./rules.js";
import { loadPlugin, registerPlugin } from "./plugin-loader.js";
import { loadConfig } from "./config.js";
import type { ToolCallEvent, ToolResultEvent, ToolwatchEvent, Config } from "./types.js";

// Import manual plugin and register it so plugin-loader uses the same instance
import manualPlugin, { initManualPlugin, approve, deny, onPendingChange } from "../plugins/manual.js";
registerPlugin("manual", manualPlugin);

// Track WebSocket clients
const wsClients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(message: object) {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function isAuditOnlyRequest(req: http.IncomingMessage): boolean {
  const header = req.headers["x-toolwatch-audit"];
  if (Array.isArray(header)) {
    return header.includes("true");
  }
  return header === "true";
}

export function createServer(db: ToolwatchDB, port: number) {
  const config = loadConfig();

  // Initialize manual plugin with DB reference and broadcast callback
  initManualPlugin(db, (pending: ToolCall[]) => {
    broadcast({ type: "pending", pending });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // CORS headers for API
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Toolwatch-Audit");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    try {
      // POST /events - receive tool call events and evaluate rules
      if (req.method === "POST" && url.pathname === "/events") {
        const body = await readBody(req);
        const event = JSON.parse(body) as ToolwatchEvent;

        const auditOnly = isAuditOnlyRequest(req);

        if (event.type === "tool_call") {
          if (auditOnly) {
            db.insertToolCall({ ...event, approvalStatus: "approved" });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ approved: true }));
            return;
          }

          // Evaluate rules first to determine if we need approval
          const result = await evaluateToolCall(event, config, db);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        } else if (event.type === "tool_result") {
          db.updateToolResult(event);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ approved: true }));
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown event type" }));
        return;
      }

      // POST /approve/:id - approve a pending request
      if (req.method === "POST" && url.pathname.startsWith("/approve/")) {
        const id = url.pathname.slice("/approve/".length);
        const success = approve(id);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // POST /deny/:id - deny a pending request
      if (req.method === "POST" && url.pathname.startsWith("/deny/")) {
        const id = url.pathname.slice("/deny/".length);
        const reason = url.searchParams.get("reason") ?? undefined;
        const success = deny(id, reason);
        res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
        return;
      }

      // GET /api/pending - get pending approvals as JSON
      if (req.method === "GET" && url.pathname === "/api/pending") {
        const pending = db.getPendingApprovals();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pending));
        return;
      }

      // GET /api/calls - query tool calls
      if (req.method === "GET" && url.pathname === "/api/calls") {
        const filter: ToolCallFilter = {
          user: url.searchParams.get("user") || undefined,
          tool: url.searchParams.get("tool") || undefined,
          model: url.searchParams.get("model") || undefined,
          isError: url.searchParams.get("isError")
            ? url.searchParams.get("isError") === "true"
            : undefined,
          approvalStatus: url.searchParams.get("approval") as ToolCallFilter["approvalStatus"] || undefined,
          search: url.searchParams.get("search") || undefined,
          from: url.searchParams.get("from") ? parseInt(url.searchParams.get("from")!) : undefined,
          to: url.searchParams.get("to") ? parseInt(url.searchParams.get("to")!) : undefined,
          limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : 100,
          offset: url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!) : 0,
        };

        const calls = db.query(filter);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(calls));
        return;
      }

      // GET /api/stats - get statistics
      if (req.method === "GET" && url.pathname === "/api/stats") {
        const stats = db.getStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats));
        return;
      }

      // GET /api/filters - get available filter values
      if (req.method === "GET" && url.pathname === "/api/filters") {
        const filters = {
          users: db.getUsers(),
          tools: db.getTools(),
          models: db.getModels(),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(filters));
        return;
      }

      // GET / - UI
      if (req.method === "GET" && url.pathname === "/") {
        const limit = 50;
        const offset = url.searchParams.has("offset") 
          ? parseInt(url.searchParams.get("offset")!) 
          : 0;

        const filter: ToolCallFilter = {
          user: url.searchParams.get("user") || undefined,
          tool: url.searchParams.get("tool") || undefined,
          model: url.searchParams.get("model") || undefined,
          isError: url.searchParams.get("isError")
            ? url.searchParams.get("isError") === "true"
            : undefined,
          approvalStatus: url.searchParams.get("approval") as ToolCallFilter["approvalStatus"] || undefined,
          search: url.searchParams.get("search") || undefined,
          limit: limit + 1,  // fetch one extra to detect if there's more
          offset,
        };

        const calls = db.query(filter);
        const hasMore = calls.length > limit;
        const displayCalls = hasMore ? calls.slice(0, limit) : calls;

        const stats = db.getStats();
        const filters = {
          users: db.getUsers(),
          tools: db.getTools(),
          models: db.getModels(),
        };

        const html = renderPage(displayCalls, stats, filters, filter, { offset, limit, hasMore }, port);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      console.error("Request error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`[ws] Client connected (${wsClients.size} total)`);

    // Send current pending approvals on connect
    const pending = db.getPendingApprovals();
    ws.send(JSON.stringify({ type: "pending", pending }));

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`[ws] Client disconnected (${wsClients.size} total)`);
    });

    ws.on("error", (err) => {
      console.error("[ws] Error:", err);
      wsClients.delete(ws);
    });
  });

  return server;
}

async function evaluateToolCall(
  event: ToolCallEvent,
  config: Config,
  db: ToolwatchDB
): Promise<{ approved: boolean; reason?: string }> {
  const { response, pluginName, requiresManual } = evaluateRules(event, config.rules);

  // Manual approval - use the manual plugin
  if (requiresManual) {
    db.insertToolCall({ ...event, approvalStatus: "pending" });
    console.log(`[rules] ${event.tool}: manual approval required`);
    return manualPlugin.evaluate(event);
  }

  // Plugin required
  if (pluginName) {
    const plugin = await loadPlugin(pluginName, config);
    if (!plugin) {
      console.error(`[rules] Plugin not found: ${pluginName}, denying`);
      db.insertToolCall({ ...event, approvalStatus: "denied" });
      return { approved: false, reason: `Plugin not found: ${pluginName}` };
    }

    db.insertToolCall({ ...event, approvalStatus: "pending" });
    console.log(`[rules] ${event.tool}: invoking plugin "${pluginName}"`);
    return plugin.evaluate(event);
  }

  // Immediate response (allow/deny)
  console.log(`[rules] ${event.tool}: ${response.approved ? "allow" : "deny"} - ${response.reason ?? ""}`);
  db.insertToolCall({
    ...event,
    approvalStatus: response.approved ? "approved" : "denied",
  });
  if (!response.approved && response.reason) {
    db.updateApprovalStatus(event.toolCallId, "denied", response.reason);
  }
  return response;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
