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
    @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap");
    :root {
      color-scheme: light;
      --bg: #f3f5f8;
      --bg-gradient: linear-gradient(180deg, #f6f8fb 0%, #eef2f7 100%);
      --panel: #ffffff;
      --panel-soft: #f7f9fc;
      --panel-muted: #f0f3f7;
      --border: #d7dde6;
      --shadow: 0 10px 30px rgba(20, 30, 45, 0.08);
      --text: #1f2a37;
      --text-muted: #667085;
      --text-strong: #0f172a;
      --accent: #274060;
      --accent-soft: #3f5a7a;
      --success: #1f6f43;
      --warning: #9a6a16;
      --error: #9f2d2d;
      --row-hover: #f2f6fb;
      --row-alt: #f8fafc;
      --code-bg: #eef2f6;
    }
    [data-theme="dark"] {
      color-scheme: dark;
      --bg: #0b111b;
      --bg-gradient: linear-gradient(180deg, #0f172a 0%, #0b111b 100%);
      --panel: #121a28;
      --panel-soft: #182235;
      --panel-muted: #1f2b3f;
      --border: #2a364a;
      --shadow: 0 12px 30px rgba(5, 10, 20, 0.45);
      --text: #e2e8f0;
      --text-muted: #97a6ba;
      --text-strong: #f8fafc;
      --accent: #9fb4d4;
      --accent-soft: #b9c8df;
      --success: #7bc89c;
      --warning: #e1b86e;
      --error: #e08a8a;
      --row-hover: #1b2639;
      --row-alt: #151f30;
      --code-bg: #101826;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "IBM Plex Sans", "Source Sans 3", "Helvetica Neue", "Segoe UI", sans-serif;
      background: var(--bg-gradient);
      color: var(--text);
      padding: 0;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 28px 24px 40px;
      animation: fadeUp 220ms ease-out;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    h1 {
      color: var(--text-strong);
      font-size: 24px;
      font-weight: 600;
      letter-spacing: 0.2px;
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 46px;
      border-radius: 999px;
      background: var(--panel-soft);
      border: 1px solid var(--border);
      color: var(--text);
      cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    .theme-toggle:hover { background: var(--panel-muted); }
    .theme-toggle svg { width: 26px; height: 26px; }
    .theme-toggle .icon-sun { display: none; }
    [data-theme="dark"] .theme-toggle .icon-sun { display: block; }
    [data-theme="dark"] .theme-toggle .icon-moon { display: none; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .stat {
      background: var(--panel);
      padding: 16px 18px;
      border-radius: 10px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      animation: fadeUp 240ms ease-out both;
    }
    .stat:nth-child(2) { animation-delay: 40ms; }
    .stat:nth-child(3) { animation-delay: 80ms; }
    .stat:nth-child(4) { animation-delay: 120ms; }
    .stat-value { font-size: 20px; font-weight: 600; color: var(--text-strong); }
    .stat-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-top: 4px;
    }
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      box-shadow: var(--shadow);
      animation: fadeUp 240ms ease-out 120ms both;
    }
    select, input[type="text"] {
      background: var(--panel-soft);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      min-width: 140px;
    }
    input[type="text"]::placeholder { color: var(--text-muted); }
    select:focus, input:focus {
      outline: none;
      border-color: var(--accent-soft);
      box-shadow: 0 0 0 3px rgba(39, 64, 96, 0.12);
    }
    button {
      background: var(--accent);
      color: #f8fafc;
      border: 1px solid transparent;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
    }
    button:hover { background: #324f75; }
    button.secondary {
      background: var(--panel-soft);
      color: var(--text);
      border-color: var(--border);
    }
    button.secondary:hover { background: var(--panel-muted); }
    button.danger { background: #7f2c2c; }
    button.danger:hover { background: #943737; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      animation: fadeUp 240ms ease-out 160ms both;
    }
    th, td {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    th {
      background: var(--panel-muted);
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
    }
    tbody tr:nth-child(even) { background: var(--row-alt); }
    tr:hover { background: var(--row-hover); }
    .tool { color: var(--accent); font-weight: 500; }
    .user { color: var(--text-muted); font-weight: 500; }
    .model { color: #2f5f55; font-weight: 500; }
    .error { color: var(--error); font-weight: 600; }
    .success { color: var(--success); font-weight: 600; }
    .warning { color: var(--warning); font-weight: 600; }
    .has-tooltip {
      text-decoration: underline dotted;
      text-underline-offset: 3px;
      cursor: help;
    }
    .params {
      max-width: 420px;
      overflow: auto;
      max-height: 110px;
    }
    .params code {
      display: inline-block;
      font-size: 12px;
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      background: var(--code-bg);
      padding: 4px 8px;
      border-radius: 6px;
      color: #243447;
      border: 1px solid var(--border);
      white-space: pre;
    }
    [data-theme="dark"] .params code { color: #d7e1ef; }
    .time { color: var(--text-muted); font-size: 12px; }
    .duration { color: var(--text-muted); }
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
      gap: 14px;
      margin-top: 20px;
    }
    .pagination .btn {
      display: inline-block;
      background: var(--panel-soft);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 13px;
      border: 1px solid var(--border);
    }
    .pagination .btn:hover:not(.disabled) { background: var(--panel-muted); }
    .pagination .btn.disabled { opacity: 0.5; cursor: not-allowed; }
    .pagination .page-info { color: var(--text-muted); font-size: 12px; }
    #notifications {
      margin-bottom: 18px;
    }
    .notification {
      background: var(--panel);
      border: 1px solid var(--border);
      border-left: 4px solid var(--warning);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: var(--shadow);
    }
    .notification .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .notification .title {
      font-weight: 600;
      color: var(--text-strong);
    }
    .notification-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
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
      color: var(--text-muted);
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
      color: var(--text-muted);
      margin-left: 12px;
    }
    .ws-status.connected { color: var(--success); }
    .ws-status.disconnected { color: var(--error); }
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
  <div class="page">
    <div class="page-header">
      <h1>toolwatch <span id="wsStatus" class="ws-status disconnected">disconnected</span></h1>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15.5A9 9 0 1 1 12.5 3a7 7 0 0 0 8.5 12.5Z"></path>
        </svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"></path>
        </svg>
      </button>
    </div>

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
      const themeStorageKey = 'toolwatch-theme';
      const themeToggle = document.getElementById('themeToggle');

      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(themeStorageKey, theme);
        themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      }

      function getInitialTheme() {
        const stored = localStorage.getItem(themeStorageKey);
        if (stored === 'light' || stored === 'dark') {
          return stored;
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      const initialTheme = getInitialTheme();
      applyTheme(initialTheme);
      themeToggle.addEventListener('click', () => {
        const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
      });

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
  </div>
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
  const approvalCellClass = approvalTitle ? `${approvalClass} has-tooltip` : approvalClass;

  return `
    <tr class="expandable">
      <td class="time">${esc(time)}</td>
      <td class="user">${esc(call.user)}</td>
      <td class="tool">${esc(call.tool)}</td>
      <td class="model">${esc(call.model)}</td>
      <td class="params"><code title="${esc(paramsFull)}">${esc(paramsDisplay)}</code></td>
      <td class="${approvalCellClass}" title="${esc(approvalTitle)}">${esc(approvalText)}</td>
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
