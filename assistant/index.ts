/**
 * assistant
 *
 * Browse Assistant lists and notes, select items, and inject them into the
 * next agent prompt. Modeled after skill-picker with fuzzy search and
 * multi-select.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildListItemContentBlock,
  buildListItemExportBlock,
  buildNoteContentBlock,
  buildNoteMetadataBlock,
} from "./format";
import { buildInstancePlan } from "./instances";

type IncludeMode = "metadata" | "content";
type PickerMode = "lists" | "notes";

interface AssistantConfig {
  assistantUrl?: string;
  defaultInstance?: string;
  includeMode?: IncludeMode;
  showListNotesPreview?: boolean;
}

interface PickerTheme {
  border: string;
  title: string;
  selected: string;
  selectedText: string;
  placeholder: string;
  hint: string;
  option: string;
  optionSelected: string;
}

interface ListSummary {
  id: string;
  name: string;
  tags?: string[];
}

interface ListItem {
  id?: string;
  title: string;
  notes?: string;
  url?: string;
  tags?: string[];
  completed?: boolean;
  position?: number;
  customFields?: Record<string, unknown>;
}

interface NoteSummary {
  title: string;
  tags?: string[];
  description?: string;
}

interface NoteContent extends NoteSummary {
  content: string;
}

interface InstanceDefinition {
  id: string;
  name?: string;
}

interface InstanceData {
  lists: ListSummary[];
  notes: NoteSummary[];
  listItemsByListId: Map<string, ListItem[]>;
}

type Selection =
  | {
      key: string;
      kind: "list";
      instanceId: string;
      listId: string;
      listName?: string;
      item: ListItem;
    }
  | {
      key: string;
      kind: "note";
      instanceId: string;
      note: NoteSummary;
    };

interface AssistantState {
  selections: Map<string, Selection>;
  order: string[];
  includeMode: IncludeMode;
  mode: PickerMode;
  instanceId: string;
  selectedListId?: string;
}

interface PickerEntry {
  key: string;
  kind: "list" | "note";
  title: string;
  description?: string;
  listId?: string;
  item?: ListItem;
  note?: NoteSummary;
}

interface PickerResult {
  action: "confirm" | "cancel";
}

interface PickerOption {
  id: "mode" | "include" | "instance" | "list";
  label: string;
  value: string;
}

const DEFAULT_CONFIG: AssistantConfig = {
  assistantUrl: "http://localhost:3000",
  defaultInstance: "default",
  includeMode: "metadata",
  showListNotesPreview: true,
};

const DEFAULT_THEME: PickerTheme = {
  border: "2",
  title: "2",
  selected: "36",
  selectedText: "36",
  placeholder: "2",
  hint: "2",
  option: "2",
  optionSelected: "36",
};

const LIST_ITEMS_LIMIT = 200;

function loadConfig(): AssistantConfig {
  const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "assistant", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const custom = JSON.parse(content) as Partial<AssistantConfig>;
      return { ...DEFAULT_CONFIG, ...custom };
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_CONFIG;
}

function resolveAssistantUrl(config: AssistantConfig): string | null {
  const envUrl = typeof process.env.ASSISTANT_URL === "string" ? process.env.ASSISTANT_URL.trim() : "";
  if (envUrl) {
    return envUrl;
  }
  const configUrl = typeof config.assistantUrl === "string" ? config.assistantUrl.trim() : "";
  return configUrl || null;
}

function loadTheme(): PickerTheme {
  const themePath = path.join(os.homedir(), ".pi", "agent", "extensions", "assistant", "theme.json");
  try {
    if (fs.existsSync(themePath)) {
      const content = fs.readFileSync(themePath, "utf-8");
      const custom = JSON.parse(content) as Partial<PickerTheme>;
      return { ...DEFAULT_THEME, ...custom };
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_THEME;
}

function fg(code: string, text: string): string {
  if (!code) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

const pickerTheme = loadTheme();

function fuzzyScore(query: string, text: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerText.includes(lowerQuery)) {
    return 100 + (lowerQuery.length / Math.max(1, lowerText.length)) * 50;
  }

  let score = 0;
  let queryIndex = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 10 + consecutiveBonus;
      consecutiveBonus += 5;
      queryIndex++;
    } else {
      consecutiveBonus = 0;
    }
  }

  return queryIndex === lowerQuery.length ? score : 0;
}

function filterEntries(entries: PickerEntry[], query: string): PickerEntry[] {
  if (!query.trim()) return entries;

  const scored = entries
    .map((entry) => {
      const titleScore = fuzzyScore(query, entry.title);
      const descScore = entry.description ? fuzzyScore(query, entry.description) * 0.8 : 0;
      return {
        entry,
        score: Math.max(titleScore, descScore),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.entry);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry) => typeof entry === "string" && entry.trim().length > 0) as string[];
  return out.length > 0 ? out : undefined;
}

function parseListSummaries(raw: unknown): ListSummary[] {
  if (!Array.isArray(raw)) return [];
  const lists: ListSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!id) continue;
    lists.push({
      id,
      name: name || id,
      ...(parseStringArray(obj.tags) ? { tags: parseStringArray(obj.tags) } : {}),
    });
  }
  return lists;
}

function parseListItems(raw: unknown): ListItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ListItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const titleRaw = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!titleRaw) continue;
    const id = typeof obj.id === "string" ? obj.id.trim() : undefined;
    const notes = typeof obj.notes === "string" ? obj.notes : undefined;
    const url = typeof obj.url === "string" ? obj.url : undefined;
    const tags = parseStringArray(obj.tags);
    const completed = typeof obj.completed === "boolean" ? obj.completed : undefined;
    const position = typeof obj.position === "number" ? obj.position : undefined;
    const customFields = obj.customFields && typeof obj.customFields === "object"
      ? (obj.customFields as Record<string, unknown>)
      : undefined;
    items.push({
      title: titleRaw,
      ...(id ? { id } : {}),
      ...(notes ? { notes } : {}),
      ...(url ? { url } : {}),
      ...(tags ? { tags } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(customFields ? { customFields } : {}),
    });
  }
  return items;
}

function parseNotes(raw: unknown): NoteSummary[] {
  if (!Array.isArray(raw)) return [];
  const notes: NoteSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    const tags = parseStringArray(obj.tags);
    const description = typeof obj.description === "string" ? obj.description : undefined;
    notes.push({
      title,
      ...(tags ? { tags } : {}),
      ...(description ? { description } : {}),
    });
  }
  return notes;
}

function parseNoteContent(raw: unknown): NoteContent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const content = typeof obj.content === "string" ? obj.content : "";
  if (!title) return null;
  const tags = parseStringArray(obj.tags);
  const description = typeof obj.description === "string" ? obj.description : undefined;
  return {
    title,
    content,
    ...(tags ? { tags } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function listSelectionKey(instanceId: string, listId: string, itemId: string): string {
  return `list:${instanceId}:${listId}:${itemId}`;
}

function noteSelectionKey(instanceId: string, title: string): string {
  return `note:${instanceId}:${title}`;
}

function formatSelectionSummary(state: AssistantState): { status?: string; widget?: string[] } {
  const count = state.selections.size;
  if (count === 0) return {};
  const names: string[] = [];
  for (const key of state.order) {
    const selection = state.selections.get(key);
    if (!selection) continue;
    if (selection.kind === "list") {
      names.push(selection.item.title);
    } else {
      names.push(selection.note.title);
    }
  }
  const preview = names.slice(0, 3).join(", ") + (names.length > 3 ? ", ..." : "");
  return {
    status: `assistant: ${count}`,
    widget: [`Assistant context queued: ${preview}`],
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

class AssistantClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = trimTrailingSlash(baseUrl);
  }

  private async callOperation<T>(pluginId: string, operation: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/operations/${operation}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "")
        : `Request failed (${response.status})`;
      throw new Error(message || `Request failed (${response.status})`);
    }

    if (payload && typeof payload === "object" && "error" in payload) {
      const message = String((payload as { error?: unknown }).error ?? "Request failed");
      throw new Error(message);
    }

    if (payload && typeof payload === "object" && "result" in payload) {
      return (payload as { result: T }).result;
    }

    return payload as T;
  }

  async listInstances(pluginId: "lists" | "notes"): Promise<InstanceDefinition[]> {
    const raw = await this.callOperation<unknown>(pluginId, "instance_list", {});
    if (!Array.isArray(raw)) return [];
    const instances: InstanceDefinition[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      if (!id) continue;
      const name = typeof obj.name === "string" ? obj.name : undefined;
      instances.push({ id, ...(name ? { name } : {}) });
    }
    return instances;
  }

  async listLists(instanceId: string): Promise<ListSummary[]> {
    const raw = await this.callOperation<unknown>("lists", "list", { instance_id: instanceId });
    return parseListSummaries(raw);
  }

  async listNotes(instanceId: string): Promise<NoteSummary[]> {
    const raw = await this.callOperation<unknown>("notes", "list", { instance_id: instanceId });
    return parseNotes(raw);
  }

  async listItems(instanceId: string, listId: string): Promise<ListItem[]> {
    const raw = await this.callOperation<unknown>("lists", "items-list", {
      instance_id: instanceId,
      listId,
      limit: LIST_ITEMS_LIMIT,
      sort: "position",
    });
    return parseListItems(raw);
  }

  async getListItem(instanceId: string, listId: string, itemId: string): Promise<ListItem | null> {
    const raw = await this.callOperation<unknown>("lists", "item-get", {
      instance_id: instanceId,
      listId,
      id: itemId,
    });
    const items = parseListItems([raw]);
    return items[0] ?? null;
  }

  async readNote(instanceId: string, title: string): Promise<NoteContent | null> {
    const raw = await this.callOperation<unknown>("notes", "read", {
      instance_id: instanceId,
      title,
    });
    return parseNoteContent(raw);
  }
}

class AssistantPickerComponent {
  readonly width = 0;
  private query = "";
  private filtered: PickerEntry[] = [];
  private selectedIndex = 0;
  private focusOnOptions = false;
  private selectedOption = 0;
  private instanceIds: string[];
  private instanceIndex = 0;
  private listIndex = 0;

  constructor(
    private instances: Map<string, InstanceData>,
    private state: AssistantState,
    private showListNotesPreview: boolean,
    private listInstanceIds: Set<string>,
    private noteInstanceIds: Set<string>,
    private done: (result: PickerResult) => void,
    private onSelectionChange: () => void
  ) {
    this.instanceIds = Array.from(instances.keys());
    if (this.instanceIds.length === 0) {
      this.instanceIds = [state.instanceId || "default"];
    }
    const existingInstanceIndex = this.instanceIds.findIndex((id) => id === state.instanceId);
    this.instanceIndex = existingInstanceIndex >= 0 ? existingInstanceIndex : 0;
    this.state.instanceId = this.instanceIds[this.instanceIndex] ?? this.state.instanceId;

    this.ensureInstanceForMode();
    const activeLists = this.getActiveLists();
    if (activeLists.length > 0) {
      const listIndex = activeLists.findIndex((list) => list.id === this.state.selectedListId);
      this.listIndex = listIndex >= 0 ? listIndex : 0;
      this.state.selectedListId = activeLists[this.listIndex]?.id;
    }

    this.updateFilter();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "tab")) {
      if (this.getOptions().length > 0) {
        this.focusOnOptions = !this.focusOnOptions;
        if (this.focusOnOptions) {
          this.selectedOption = 0;
        }
      }
      return;
    }

    if (this.focusOnOptions) {
      this.handleOptionsInput(data);
      return;
    }

    if (matchesKey(data, "escape")) {
      this.done({ action: "cancel" });
      return;
    }

    if (matchesKey(data, "return")) {
      this.done({ action: "confirm" });
      return;
    }

    if (data === " ") {
      const entry = this.filtered[this.selectedIndex];
      if (entry) {
        this.toggleSelection(entry);
      }
      return;
    }

    if (matchesKey(data, "up")) {
      if (this.filtered.length > 0) {
        this.selectedIndex = this.selectedIndex === 0 ? this.filtered.length - 1 : this.selectedIndex - 1;
      }
      return;
    }

    if (matchesKey(data, "down")) {
      if (this.filtered.length > 0) {
        this.selectedIndex = this.selectedIndex === this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
      }
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.updateFilter();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.query += data;
      this.updateFilter();
    }
  }

  private handleOptionsInput(data: string): void {
    const options = this.getOptions();
    if (options.length === 0) {
      this.focusOnOptions = false;
      return;
    }

    if (matchesKey(data, "escape")) {
      this.focusOnOptions = false;
      return;
    }

    if (matchesKey(data, "up")) {
      this.selectedOption = this.selectedOption === 0 ? options.length - 1 : this.selectedOption - 1;
      return;
    }

    if (matchesKey(data, "down")) {
      this.selectedOption = this.selectedOption === options.length - 1 ? 0 : this.selectedOption + 1;
      return;
    }

    if (matchesKey(data, "left") || matchesKey(data, "right") || data === " ") {
      const direction = matchesKey(data, "left") ? -1 : 1;
      const option = options[this.selectedOption];
      if (option) {
        this.cycleOption(option, direction);
      }
    }
  }

  private cycleOption(option: PickerOption, direction: number): void {
    if (option.id === "mode") {
      this.state.mode = this.state.mode === "lists" ? "notes" : "lists";
      this.ensureInstanceForMode();
      this.query = "";
      this.selectedIndex = 0;
      this.selectedOption = 0;
      this.updateFilter();
      return;
    }

    if (option.id === "include") {
      this.state.includeMode = this.state.includeMode === "metadata" ? "content" : "metadata";
      return;
    }

    if (option.id === "instance") {
      const choices = this.getInstanceChoices();
      if (choices.length === 0) return;
      const currentIndex = Math.max(0, choices.findIndex((id) => id === this.state.instanceId));
      const nextIndex = currentIndex + direction;
      const wrappedIndex = nextIndex < 0
        ? choices.length - 1
        : nextIndex >= choices.length
          ? 0
          : nextIndex;
      this.state.instanceId = choices[wrappedIndex] ?? this.state.instanceId;
      this.instanceIndex = Math.max(0, this.instanceIds.findIndex((id) => id === this.state.instanceId));
      const activeLists = this.getActiveLists();
      if (activeLists.length > 0) {
        this.listIndex = 0;
        this.state.selectedListId = activeLists[0]?.id;
      } else {
        this.state.selectedListId = undefined;
      }
      this.query = "";
      this.selectedIndex = 0;
      this.updateFilter();
      return;
    }

    if (option.id === "list") {
      const lists = this.getActiveLists();
      if (lists.length === 0) return;
      const nextIndex = this.listIndex + direction;
      const wrappedIndex = nextIndex < 0
        ? lists.length - 1
        : nextIndex >= lists.length
          ? 0
          : nextIndex;
      this.listIndex = wrappedIndex;
      this.state.selectedListId = lists[this.listIndex]?.id;
      this.query = "";
      this.selectedIndex = 0;
      this.updateFilter();
    }
  }

  private getActiveInstanceId(): string {
    return this.state.instanceId || this.instanceIds[this.instanceIndex] || "default";
  }

  private getInstanceChoices(): string[] {
    if (this.state.mode === "lists" && this.listInstanceIds.size > 0) {
      const choices = this.instanceIds.filter((id) => this.listInstanceIds.has(id));
      return choices.length > 0 ? choices : this.instanceIds;
    }
    if (this.state.mode === "notes" && this.noteInstanceIds.size > 0) {
      const choices = this.instanceIds.filter((id) => this.noteInstanceIds.has(id));
      return choices.length > 0 ? choices : this.instanceIds;
    }
    return this.instanceIds;
  }

  private ensureInstanceForMode(): void {
    const choices = this.getInstanceChoices();
    if (choices.length === 0) return;
    if (!choices.includes(this.state.instanceId)) {
      this.state.instanceId = choices[0];
    }
    const index = this.instanceIds.findIndex((id) => id === this.state.instanceId);
    this.instanceIndex = index >= 0 ? index : 0;
  }

  private getActiveData(): InstanceData {
    const instanceId = this.getActiveInstanceId();
    return this.instances.get(instanceId) ?? { lists: [], notes: [], listItemsByListId: new Map() };
  }

  private getActiveLists(): ListSummary[] {
    return this.getActiveData().lists;
  }

  private getActiveNotes(): NoteSummary[] {
    return this.getActiveData().notes;
  }

  private getActiveList(): ListSummary | null {
    const lists = this.getActiveLists();
    if (lists.length === 0) return null;
    const selectedId = this.state.selectedListId;
    if (selectedId) {
      return lists.find((list) => list.id === selectedId) ?? lists[0] ?? null;
    }
    return lists[0] ?? null;
  }

  private getEntries(): PickerEntry[] {
    if (this.state.mode === "notes") {
      return this.getActiveNotes().map((note) => {
        const description = note.description
          ? normalizeWhitespace(note.description)
          : note.tags
            ? note.tags.join(", ")
            : undefined;
        const key = noteSelectionKey(this.getActiveInstanceId(), note.title);
        return {
          key,
          kind: "note",
          title: note.title,
          ...(description ? { description } : {}),
          note,
        };
      });
    }

    const list = this.getActiveList();
    if (!list) return [];
    const items = this.getActiveData().listItemsByListId.get(list.id) ?? [];
    return items.map((item) => {
      const description = this.showListNotesPreview && item.notes
        ? normalizeWhitespace(item.notes)
        : undefined;
      const itemId = item.id ?? "";
      const key = itemId ? listSelectionKey(this.getActiveInstanceId(), list.id, itemId) : `list:${list.id}:${item.title}`;
      return {
        key,
        kind: "list",
        title: item.title,
        ...(description ? { description } : {}),
        listId: list.id,
        item,
      };
    });
  }

  private updateFilter(): void {
    const entries = this.getEntries();
    this.filtered = filterEntries(entries, this.query);
    this.selectedIndex = 0;
  }

  private toggleSelection(entry: PickerEntry): void {
    if (entry.kind === "list") {
      const list = this.getActiveList();
      const item = entry.item;
      if (!list || !item || !item.id) return;
      const key = listSelectionKey(this.getActiveInstanceId(), list.id, item.id);
      if (this.state.selections.has(key)) {
        this.state.selections.delete(key);
        this.state.order = this.state.order.filter((existing) => existing !== key);
      } else {
        this.state.selections.set(key, {
          key,
          kind: "list",
          instanceId: this.getActiveInstanceId(),
          listId: list.id,
          listName: list.name,
          item,
        });
        this.state.order.push(key);
      }
      this.onSelectionChange();
      return;
    }

    if (entry.kind === "note" && entry.note) {
      const note = entry.note;
      const key = noteSelectionKey(this.getActiveInstanceId(), note.title);
      if (this.state.selections.has(key)) {
        this.state.selections.delete(key);
        this.state.order = this.state.order.filter((existing) => existing !== key);
      } else {
        this.state.selections.set(key, {
          key,
          kind: "note",
          instanceId: this.getActiveInstanceId(),
          note,
        });
        this.state.order.push(key);
      }
      this.onSelectionChange();
    }
  }

  private getOptions(): PickerOption[] {
    const options: PickerOption[] = [];

    options.push({
      id: "mode",
      label: "Mode",
      value: this.state.mode === "lists" ? "Lists" : "Notes",
    });

    if (this.state.mode === "lists") {
      const list = this.getActiveList();
      options.push({
        id: "list",
        label: "List",
        value: list ? list.name : "None",
      });
    }

    const instanceChoices = this.getInstanceChoices();
    if (instanceChoices.length > 1) {
      options.push({
        id: "instance",
        label: "Instance",
        value: this.getActiveInstanceId(),
      });
    }

    options.push({
      id: "include",
      label: "Include",
      value: this.state.includeMode === "metadata" ? "Metadata" : "Content",
    });

    return options;
  }

  render(width: number): string[] {
    const theme = pickerTheme;
    const w = this.width > 0 ? Math.min(this.width, width) : width;
    const innerW = Math.max(0, w - 2);
    const lines: string[] = [];

    const border = (s: string) => fg(theme.border, s);
    const title = (s: string) => fg(theme.title, s);
    const selected = (s: string) => fg(theme.selected, s);
    const placeholder = (s: string) => fg(theme.placeholder, s);
    const hint = (s: string) => fg(theme.hint, s);
    const option = (s: string) => fg(theme.option, s);
    const optionSelected = (s: string) => fg(theme.optionSelected, s);

    const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
    const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visLen(s)));
    const truncate = (s: string, maxLen: number) => {
      if (s.length <= maxLen) return s;
      if (maxLen <= 3) return s.slice(0, maxLen);
      return s.slice(0, maxLen - 3) + "...";
    };

    const row = (content: string) => border("|") + pad(" " + content, innerW) + border("|");

    const titleText = " Assistant ";
    const borderLen = Math.max(0, innerW - visLen(titleText));
    const leftBorder = Math.floor(borderLen / 2);
    const rightBorder = borderLen - leftBorder;
    lines.push(border("+" + "-".repeat(leftBorder)) + title(titleText) + border("-".repeat(rightBorder) + "+"));

    const queryDisplay = this.query || placeholder("type to filter...");
    lines.push(row(`Search: ${queryDisplay}`));

    lines.push(border("+" + "-".repeat(innerW) + "+"));

    const modeLabel = this.state.mode === "lists" ? "Lists" : "Notes";
    const listLabel = this.state.mode === "lists" ? (this.getActiveList()?.name ?? "None") : "-";
    const contextLine = `Mode: ${modeLabel} | List: ${listLabel} | Instance: ${this.getActiveInstanceId()}`;
    lines.push(row(truncate(contextLine, innerW - 1)));

    const entries = this.filtered;
    const maxVisible = 8;
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(maxVisible / 2), entries.length - maxVisible)
    );
    const endIndex = Math.min(startIndex + maxVisible, entries.length);

    if (entries.length === 0) {
      const emptyLabel = this.state.mode === "lists" ? "No list items" : "No notes";
      lines.push(row(hint(emptyLabel)));
    } else {
      for (let i = startIndex; i < endIndex; i++) {
        const entry = entries[i];
        const isCursor = i === this.selectedIndex;
        const isSelected = this.state.selections.has(entry.key);
        const marker = isSelected ? "[x]" : "[ ]";
        const cursor = isCursor ? ">" : " ";
        const desc = entry.description ? ` - ${entry.description}` : "";
        const rawLine = `${cursor} ${marker} ${entry.title}${desc}`;
        const truncated = truncate(rawLine, innerW - 1);
        const rendered = isCursor ? selected(truncated) : truncated;
        lines.push(row(rendered));
      }
    }

    lines.push(border("+" + "-".repeat(innerW) + "+"));

    const options = this.getOptions();
    if (options.length === 0) {
      lines.push(row(hint("No options")));
    } else {
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = this.focusOnOptions && i === this.selectedOption;
        const prefix = isSelected ? ">" : " ";
        const label = truncate(`${opt.label}: ${opt.value}`, innerW - 3);
        const styled = isSelected ? optionSelected(label) : option(label);
        lines.push(row(`${prefix} ${styled}`));
      }
    }

    lines.push(border("+" + "-".repeat(innerW) + "+"));
    const hintLine = "Enter confirm  Space toggle  Tab options  Esc close";
    lines.push(row(hint(truncate(hintLine, innerW - 1))));
    lines.push(border("+" + "-".repeat(innerW) + "+"));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

async function loadInstanceDataSafe(
  client: AssistantClient,
  instanceId: string,
  listInstanceIds: Set<string>,
  noteInstanceIds: Set<string>
): Promise<InstanceData> {
  let lists: ListSummary[] = [];
  let notes: NoteSummary[] = [];

  const shouldLoadLists = listInstanceIds.size === 0 || listInstanceIds.has(instanceId);
  const shouldLoadNotes = noteInstanceIds.size === 0 || noteInstanceIds.has(instanceId);

  if (shouldLoadLists) {
    try {
      lists = await client.listLists(instanceId);
    } catch {
      lists = [];
    }
  }

  if (shouldLoadNotes) {
    try {
      notes = await client.listNotes(instanceId);
    } catch {
      notes = [];
    }
  }

  const listItemsByListId = new Map<string, ListItem[]>();
  for (const list of lists) {
    try {
      const items = await client.listItems(instanceId, list.id);
      listItemsByListId.set(list.id, items);
    } catch {
      listItemsByListId.set(list.id, []);
    }
  }

  return { lists, notes, listItemsByListId };
}

async function loadAllInstances(
  client: AssistantClient,
  preferredInstance: string
): Promise<{
  instances: Map<string, InstanceData>;
  instanceIds: string[];
  listInstanceIds: Set<string>;
  noteInstanceIds: Set<string>;
}> {
  let listInstances: InstanceDefinition[] = [];
  let noteInstances: InstanceDefinition[] = [];

  try {
    listInstances = await client.listInstances("lists");
  } catch {
    listInstances = [];
  }

  try {
    noteInstances = await client.listInstances("notes");
  } catch {
    noteInstances = [];
  }

  const plan = buildInstancePlan(listInstances, noteInstances, preferredInstance);
  const instances = new Map<string, InstanceData>();

  for (const instanceId of plan.instanceIds) {
    const data = await loadInstanceDataSafe(
      client,
      instanceId,
      plan.listInstanceIds,
      plan.noteInstanceIds
    );
    instances.set(instanceId, data);
  }

  return {
    instances,
    instanceIds: plan.instanceIds,
    listInstanceIds: plan.listInstanceIds,
    noteInstanceIds: plan.noteInstanceIds,
  };
}

async function buildSelectionBlocks(
  selections: Selection[],
  includeMode: IncludeMode,
  client: AssistantClient | null,
  ctx?: ExtensionContext
): Promise<string[]> {
  const blocks: string[] = [];

  for (const selection of selections) {
    if (selection.kind === "list") {
      const listInfo = { id: selection.listId, name: selection.listName };
      if (includeMode === "content" && client && selection.item.id) {
        let item = selection.item;
        try {
          const fetched = await client.getListItem(selection.instanceId, selection.listId, selection.item.id);
          if (fetched) {
            item = fetched;
          }
        } catch {
          // fall back to preview item
        }
        const block = buildListItemContentBlock(item, listInfo, selection.instanceId);
        if (block) blocks.push(block);
      } else {
        const block = buildListItemExportBlock(selection.item, listInfo, selection.instanceId);
        if (block) blocks.push(block);
      }
      continue;
    }

    if (selection.kind === "note") {
      const note = selection.note;
      if (includeMode === "content" && client) {
        let content = "";
        try {
          const fetched = await client.readNote(selection.instanceId, note.title);
          if (fetched) {
            content = fetched.content;
          }
        } catch {
          // fall back to metadata-only
        }
        const block = buildNoteContentBlock(note, selection.instanceId, content);
        if (block) blocks.push(block);
      } else {
        const block = buildNoteMetadataBlock(note, selection.instanceId);
        if (block) blocks.push(block);
      }
      continue;
    }
  }

  if (includeMode === "content" && !client) {
    ctx?.ui?.notify("assistantUrl not configured; using metadata mode", "warning");
  }

  return blocks;
}

const config = loadConfig();
const resolvedUrl = resolveAssistantUrl(config);

const state: AssistantState = {
  selections: new Map(),
  order: [],
  includeMode: config.includeMode ?? "metadata",
  mode: "lists",
  instanceId: config.defaultInstance ?? "default",
  selectedListId: undefined,
};

export default function assistantExtension(pi: ExtensionAPI): void {
  pi.registerCommand("assistant", {
    description: "Open Assistant picker to select lists and notes for the next message",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!resolvedUrl) {
        ctx.ui.setStatus("assistant", "ASSISTANT_URL not set");
        setTimeout(() => ctx.ui.setStatus("assistant", undefined), 3000);
        return;
      }

      const client = new AssistantClient(resolvedUrl);
      ctx.ui.setStatus("assistant", "Loading lists and notes...");

      let instances: Map<string, InstanceData>;
      let listInstanceIds: Set<string> = new Set();
      let noteInstanceIds: Set<string> = new Set();
      try {
        const loadResult = await loadAllInstances(client, state.instanceId);
        instances = loadResult.instances;
        listInstanceIds = loadResult.listInstanceIds;
        noteInstanceIds = loadResult.noteInstanceIds;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load Assistant data";
        ctx.ui.notify(message, "error");
        ctx.ui.setStatus("assistant", undefined);
        return;
      }

      ctx.ui.setStatus("assistant", undefined);

      await ctx.ui.custom<PickerResult>(
        (_tui, _theme, _keybindings, done) =>
          new AssistantPickerComponent(
            instances,
            state,
            config.showListNotesPreview ?? true,
            listInstanceIds,
            noteInstanceIds,
            done,
            () => {
              const summary = formatSelectionSummary(state);
              ctx.ui.setStatus("assistant", summary.status);
              ctx.ui.setWidget("assistant", summary.widget);
            }
          ),
        { overlay: true }
      );

      const summary = formatSelectionSummary(state);
      ctx.ui.setStatus("assistant", summary.status);
      ctx.ui.setWidget("assistant", summary.widget);
    },
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (state.selections.size === 0) {
      return {};
    }

    const selections: Selection[] = [];
    for (const key of state.order) {
      const selection = state.selections.get(key);
      if (selection) {
        selections.push(selection);
      }
    }

    state.selections.clear();
    state.order = [];

    ctx.ui?.setStatus("assistant", undefined);
    ctx.ui?.setWidget("assistant", undefined);

    const client = resolvedUrl ? new AssistantClient(resolvedUrl) : null;
    const blocks = await buildSelectionBlocks(selections, state.includeMode, client, ctx);

    if (blocks.length === 0) {
      return {};
    }

    return {
      message: {
        customType: "assistant",
        content: blocks.join("\n\n"),
        display: true,
      },
    };
  });
}
