/**
 * Local Manual Approval
 *
 * Shows a TUI confirmation dialog for manual approval.
 * Blocks until the user approves or denies.
 */

import type { ToolCallEvent, ApprovalResponse } from "@pi-extensions/toolwatch-common";

// ExtensionContext type from pi-coding-agent
interface ExtensionContext {
  ui: {
    confirm(title: string, message: string): Promise<boolean>;
  };
  hasUI: boolean;
}

/**
 * Format tool call for display in confirmation dialog.
 */
function formatToolCall(event: ToolCallEvent): string {
  if (!event.params) {
    return `${event.tool}: (no params)`;
  }
  const params = Object.entries(event.params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const valueStr = typeof v === "string" ? v : JSON.stringify(v) ?? "null";
      const truncated = valueStr.length > 100 ? valueStr.slice(0, 100) + "..." : valueStr;
      return `${k}=${truncated}`;
    })
    .join(", ");

  return `${event.tool}: ${params}`;
}

/**
 * Request manual approval via TUI.
 */
export async function manualApproval(
  event: ToolCallEvent,
  ctx: unknown
): Promise<ApprovalResponse> {
  const extCtx = ctx as ExtensionContext | undefined;

  // If no UI context, deny by default
  if (!extCtx || !extCtx.hasUI) {
    return {
      approved: false,
      reason: "Manual approval requires interactive UI",
    };
  }

  const message = formatToolCall(event);

  try {
    const approved = await extCtx.ui.confirm("Manual Approval Required", message);

    return {
      approved,
      reason: approved ? undefined : "Manually denied by user",
    };
  } catch (err) {
    return {
      approved: false,
      reason: `Approval dialog error: ${err}`,
    };
  }
}
