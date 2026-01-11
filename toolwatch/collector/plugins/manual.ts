/**
 * Manual Approval Plugin
 *
 * Waits for approval via the web UI.
 * Pending approvals are stored in the database for cross-instance support.
 */

import type { ToolCallEvent, ApprovalResponse, ApprovalPlugin } from "../src/types.js";
import type { ToolwatchDB, ToolCall } from "../src/db.js";

// Reference to DB, set by server on startup
let db: ToolwatchDB | null = null;

// Callback to notify UI of pending changes
let notifyPendingChange: ((pending: ToolCall[]) => void) | null = null;

// In-memory resolvers for pending promises (keyed by toolCallId)
const resolvers = new Map<string, (response: ApprovalResponse) => void>();

// Polling interval for checking DB changes
const POLL_INTERVAL_MS = 500;

/**
 * Initialize the plugin with database reference
 */
export function initManualPlugin(
  database: ToolwatchDB,
  onPendingChange?: (pending: ToolCall[]) => void
): void {
  db = database;
  notifyPendingChange = onPendingChange ?? null;

  // Start polling for external approvals (from other instances)
  setInterval(pollForApprovals, POLL_INTERVAL_MS);
}

/**
 * Broadcast pending changes to UI
 */
function broadcastPending(): void {
  if (db && notifyPendingChange) {
    const pending = db.getPendingApprovals();
    notifyPendingChange(pending);
  }
}

/**
 * Poll DB for approval status changes made by other instances
 */
function pollForApprovals(): void {
  if (!db) return;

  for (const [toolCallId, resolve] of resolvers.entries()) {
    const status = db.getApprovalStatus(toolCallId);

    if (status && status.status && status.status !== "pending") {
      resolvers.delete(toolCallId);
      resolve({
        approved: status.status === "approved",
        reason: status.reason ?? undefined,
      });
    }
  }
}

/**
 * Approve a pending request (called from UI)
 */
export function approve(toolCallId: string, reason?: string): boolean {
  if (!db) return false;

  const success = db.updateApprovalStatus(toolCallId, "approved", reason);

  // If we have a local resolver, trigger it immediately
  const resolve = resolvers.get(toolCallId);
  if (resolve) {
    resolvers.delete(toolCallId);
    resolve({ approved: true, reason });
  }

  // Notify UI
  broadcastPending();

  return success;
}

/**
 * Deny a pending request (called from UI)
 */
export function deny(toolCallId: string, reason?: string): boolean {
  if (!db) return false;

  const success = db.updateApprovalStatus(toolCallId, "denied", reason ?? "Manually denied by user");

  // If we have a local resolver, trigger it immediately
  const resolve = resolvers.get(toolCallId);
  if (resolve) {
    resolvers.delete(toolCallId);
    resolve({ approved: false, reason: reason ?? "Manually denied by user" });
  }

  // Notify UI
  broadcastPending();

  return success;
}

// Legacy export for compatibility
export { broadcastPending as onPendingChange };

/**
 * Plugin implementation
 */
const plugin: ApprovalPlugin = {
  async evaluate(event: ToolCallEvent): Promise<ApprovalResponse> {
    if (!db) {
      return { approved: false, reason: "Manual plugin not initialized" };
    }

    console.log(`[manual] Waiting for approval: ${event.tool} (${event.toolCallId})`);

    // Notify UI of new pending
    broadcastPending();

    return new Promise((resolve) => {
      // Store resolver for this request
      resolvers.set(event.toolCallId, resolve);
    });
  },
};

export default plugin;
