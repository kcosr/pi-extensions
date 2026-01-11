import type { ToolCall, ToolCallFilter } from "./db.js";

interface Stats {
  total: number;
  users: number;
  tools: number;
  errors: number;
}

interface Filters {
  users: string[];
  tools: string[];
  models: string[];
}

const baseStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
    }
    h1 { color: #58a6ff; margin-bottom: 20px; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
    }
    .stat {
      background: #161b22;
      padding: 15px 20px;
      border-radius: 6px;
      border: 1px solid #30363d;
    }
    .stat-value { font-size: 24px; font-weight: bold; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; }
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    select, input[type="text"] {
      background: #161b22;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
    }
    select:focus, input:focus { outline: none; border-color: #58a6ff; }
    button {
      background: #238636;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { background: #2ea043; }
    button.secondary { background: #30363d; }
    button.secondary:hover { background: #484f58; }
    button.danger { background: #da3633; }
    button.danger:hover { background: #f85149; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #161b22;
      border-radius: 6px;
      overflow: hidden;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #30363d;
    }
    th { background: #21262d; color: #8b949e; font-weight: 500; }
    tr:hover { background: #1f2428; }
    .tool { color: #f0883e; }
    .user { color: #a371f7; }
    .model { color: #7ee787; }
    .error { color: #f85149; }
    .success { color: #3fb950; }
    .warning { color: #d29922; }
    .params {
      max-width: 400px;
      overflow: auto;
      max-height: 100px;
    }
    .params code {
      display: inline-block;
      font-size: 12px;
      font-family: monospace;
      background: #0d1117;
      padding: 4px 8px;
      border-radius: 4px;
      color: #c9d1d9;
      white-space: pre;
    }
    .time { color: #8b949e; font-size: 12px; }
    .duration { color: #8b949e; }
    .expandable { cursor: pointer; }
    .expanded .params {
      white-space: pre-wrap;
      max-width: none;
    }
    .actions { display: flex; gap: 8px; }
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 16px;
      margin-top: 20px;
    }
    .pagination .btn {
      display: inline-block;
      background: #30363d;
      color: #c9d1d9;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
    }
    .pagination .btn:hover:not(.disabled) { background: #484f58; }
    .pagination .btn.disabled { opacity: 0.5; cursor: not-allowed; }
    .pagination .page-info { color: #8b949e; }
    #notifications {
      margin-bottom: 20px;
    }
    .notification {
      background: #161b22;
      border: 2px solid #d29922;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .notification .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .notification .title {
      font-weight: bold;
      color: #d29922;
    }
    .notification-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #8b949e;
    }
    .notification-nav button {
      padding: 4px 8px;
      font-size: 12px;
    }
    .notification-nav button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .notification .meta {
      color: #8b949e;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .notification .params {
      max-width: none;
      max-height: 150px;
      margin-bottom: 12px;
    }
    .ws-status {
      font-size: 12px;
      color: #8b949e;
      margin-left: 12px;
    }
    .ws-status.connected { color: #3fb950; }
    .ws-status.disconnected { color: #f85149; }
`;

export function renderPage(
  calls: ToolCall[],
  stats: Stats,
  filters: Filters,
  currentFilter: ToolCallFilter,
  pagination: { offset: number; limit: number; hasMore: boolean },
  wsPort: number
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>toolwatch</title>
  <style>${baseStyles}</style>
</head>
<body>
  <h1>toolwatch <span id="wsStatus" class="ws-status disconnected">disconnected</span></h1>

  <div id="notifications"></div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total Calls</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.users}</div>
      <div class="stat-label">Users</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.tools}</div>
      <div class="stat-label">Tools</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.errors}</div>
      <div class="stat-label">Errors</div>
    </div>
  </div>

  <form class="filters" method="GET">
    <select name="user">
      <option value="">All Users</option>
      ${filters.users.map((u) => `<option value="${esc(u)}" ${currentFilter.user === u ? "selected" : ""}>${esc(u)}</option>`).join("")}
    </select>
    <select name="tool">
      <option value="">All Tools</option>
      ${filters.tools.map((t) => `<option value="${esc(t)}" ${currentFilter.tool === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
    </select>
    <select name="model">
      <option value="">All Models</option>
      ${filters.models.map((m) => `<option value="${esc(m)}" ${currentFilter.model === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
    </select>
    <select name="isError">
      <option value="">All Results</option>
      <option value="true" ${currentFilter.isError === true ? "selected" : ""}>Errors Only</option>
      <option value="false" ${currentFilter.isError === false ? "selected" : ""}>Success Only</option>
    </select>
    <select name="approval">
      <option value="">All Approvals</option>
      <option value="approved" ${currentFilter.approvalStatus === "approved" ? "selected" : ""}>Approved</option>
      <option value="denied" ${currentFilter.approvalStatus === "denied" ? "selected" : ""}>Denied</option>
      <option value="pending" ${currentFilter.approvalStatus === "pending" ? "selected" : ""}>Pending</option>
    </select>
    <input type="text" name="search" placeholder="Search params..." value="${esc(currentFilter.search ?? "")}" />
    <button type="submit">Filter</button>
    <a href="/"><button type="button" class="secondary">Clear</button></a>
  </form>

  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>User</th>
        <th>Tool</th>
        <th>Model</th>
        <th>Params</th>
        <th>Approval</th>
        <th>Result</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>
      ${calls.map((call) => renderRow(call)).join("")}
    </tbody>
  </table>

  ${renderPagination(pagination, currentFilter)}

  <script>
    // Expand rows on click
    document.querySelectorAll('.expandable').forEach(row => {
      row.addEventListener('click', () => row.classList.toggle('expanded'));
    });

    // Format params for display
    function formatParams(tool, params) {
      try {
        const p = typeof params === 'string' ? JSON.parse(params) : params;
        switch (tool) {
          case 'bash': return p.command || '';
          case 'read':
          case 'write':
          case 'edit':
          case 'ls': return p.path || '';
          case 'grep': return p.pattern ? '/' + p.pattern + '/ ' + (p.path || '') : p.path || '';
          case 'find': return p.pattern ? (p.path || '') + ' -name ' + p.pattern : p.path || '';
          default: return JSON.stringify(p);
        }
      } catch {
        return String(params);
      }
    }

    // Escape HTML
    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Pending state
    let pendingList = [];
    let pendingIndex = 0;

    // Render pending notification with navigation
    function renderNotification(call, index, total) {
      const time = new Date(call.ts).toLocaleString();
      const waiting = Math.round((Date.now() - call.ts) / 1000);
      const params = formatParams(call.tool, call.params);
      const fullParams = typeof call.params === 'string' ? call.params : JSON.stringify(call.params, null, 2);

      const nav = total > 1 
        ? '<div class="notification-nav">' +
            '<button class="secondary" onclick="prevPending()"' + (index === 0 ? ' disabled' : '') + '>&lt;</button>' +
            '<span>' + (index + 1) + ' of ' + total + '</span>' +
            '<button class="secondary" onclick="nextPending()"' + (index === total - 1 ? ' disabled' : '') + '>&gt;</button>' +
          '</div>'
        : '';

      return '<div class="notification" data-id="' + esc(call.toolCallId) + '">' +
        '<div class="header">' +
          '<span class="title">Pending: ' + esc(call.tool) + '</span>' +
          nav +
        '</div>' +
        '<div class="meta">' +
          'User: <span class="user">' + esc(call.user) + '</span> | ' +
          'Model: <span class="model">' + esc(call.model) + '</span> | ' +
          'Time: ' + esc(time) + ' | ' +
          'Waiting: ' + waiting + 's' +
        '</div>' +
        '<div class="params"><code title="' + esc(fullParams) + '">' + esc(params) + '</code></div>' +
        '<div class="actions">' +
          '<button onclick="approveCall(\\'' + esc(call.toolCallId) + '\\')">Approve</button>' +
          '<button class="danger" onclick="denyCall(\\'' + esc(call.toolCallId) + '\\')">Deny</button>' +
        '</div>' +
      '</div>';
    }

    // Navigation functions
    function prevPending() {
      if (pendingIndex > 0) {
        pendingIndex--;
        renderCurrentPending();
      }
    }

    function nextPending() {
      if (pendingIndex < pendingList.length - 1) {
        pendingIndex++;
        renderCurrentPending();
      }
    }

    function renderCurrentPending() {
      const container = document.getElementById('notifications');
      if (pendingList.length === 0) {
        container.innerHTML = '';
      } else {
        container.innerHTML = renderNotification(pendingList[pendingIndex], pendingIndex, pendingList.length);
      }
    }

    // Update notifications
    function updateNotifications(pending) {
      pendingList = pending;
      // Keep index in bounds, or reset to 0
      if (pendingIndex >= pending.length) {
        pendingIndex = Math.max(0, pending.length - 1);
      }
      renderCurrentPending();
    }

    // Approve action
    async function approveCall(id) {
      await fetch('/approve/' + id, { method: 'POST' });
    }

    // Deny action
    async function denyCall(id) {
      await fetch('/deny/' + id + '?reason=' + encodeURIComponent('Manually denied by user'), { method: 'POST' });
    }

    // WebSocket connection
    const wsStatus = document.getElementById('wsStatus');
    let ws;
    let reconnectTimer;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.onopen = () => {
        wsStatus.textContent = 'connected';
        wsStatus.className = 'ws-status connected';
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      ws.onclose = () => {
        wsStatus.textContent = 'disconnected';
        wsStatus.className = 'ws-status disconnected';
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pending') {
          updateNotifications(msg.pending);
        }
      };
    }

    connect();
  </script>
</body>
</html>`;
}

function buildQueryString(filter: ToolCallFilter, offset: number): string {
  const params = new URLSearchParams();
  if (filter.user) params.set("user", filter.user);
  if (filter.tool) params.set("tool", filter.tool);
  if (filter.model) params.set("model", filter.model);
  if (filter.isError !== undefined) params.set("isError", String(filter.isError));
  if (filter.approvalStatus) params.set("approval", filter.approvalStatus);
  if (filter.search) params.set("search", filter.search);
  if (offset > 0) params.set("offset", String(offset));
  const str = params.toString();
  return str ? `?${str}` : "";
}

function renderPagination(
  pagination: { offset: number; limit: number; hasMore: boolean },
  filter: ToolCallFilter
): string {
  const { offset, limit, hasMore } = pagination;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const page = Math.floor(offset / limit) + 1;

  return `
    <div class="pagination">
      ${offset > 0 
        ? `<a href="${buildQueryString(filter, prevOffset)}" class="btn secondary">Previous</a>` 
        : `<span class="btn secondary disabled">Previous</span>`}
      <span class="page-info">Page ${page}</span>
      ${hasMore 
        ? `<a href="${buildQueryString(filter, nextOffset)}" class="btn secondary">Next</a>`
        : `<span class="btn secondary disabled">Next</span>`}
    </div>
  `;
}

function formatParams(tool: string, paramsJson: string): { display: string; full: string } {
  try {
    const params = JSON.parse(paramsJson);
    let display = "";
    
    switch (tool) {
      case "bash":
        display = params.command ?? "";
        break;
      case "read":
      case "write":
      case "edit":
      case "ls":
        display = params.path ?? "";
        break;
      case "grep":
        display = params.pattern ? `/${params.pattern}/ ${params.path ?? ""}` : params.path ?? "";
        break;
      case "find":
        display = params.pattern ? `${params.path ?? ""} -name ${params.pattern}` : params.path ?? "";
        break;
      default:
        display = paramsJson;
    }
    
    return { display, full: JSON.stringify(params, null, 2) };
  } catch {
    return { display: paramsJson, full: paramsJson };
  }
}

function renderRow(call: ToolCall): string {
  const time = new Date(call.ts).toLocaleString();
  const resultClass = call.isError === null ? "" : call.isError ? "error" : "success";
  const resultText = call.isError === null ? "-" : call.isError ? "Error" : "OK";
  const duration = call.durationMs !== null ? formatDuration(call.durationMs) : "-";
  const { display: paramsDisplay, full: paramsFull } = formatParams(call.tool, call.params);
  
  let approvalClass = "";
  let approvalText = "-";
  let approvalTitle = "";
  if (call.approvalStatus === "approved") {
    approvalClass = "success";
    approvalText = "Approved";
  } else if (call.approvalStatus === "denied") {
    approvalClass = "error";
    approvalText = "Denied";
    approvalTitle = call.approvalReason ?? "";
  } else if (call.approvalStatus === "pending") {
    approvalClass = "warning";
    approvalText = "Pending";
  }

  return `
    <tr class="expandable">
      <td class="time">${esc(time)}</td>
      <td class="user">${esc(call.user)}</td>
      <td class="tool">${esc(call.tool)}</td>
      <td class="model">${esc(call.model)}</td>
      <td class="params"><code title="${esc(paramsFull)}">${esc(paramsDisplay)}</code></td>
      <td class="${approvalClass}" title="${esc(approvalTitle)}">${esc(approvalText)}</td>
      <td class="${resultClass}">${resultText}</td>
      <td class="duration">${duration}</td>
    </tr>
  `;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
