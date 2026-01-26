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
  joinBlocks,
} from "./format";
import { buildInstancePlan } from "./instances";
import { buildListItemEntries, normalizeWhitespace } from "./entries";

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

interface PersistedState {
  includeMode?: IncludeMode;
  mode?: PickerMode;
  instanceId?: string;
  selectedListId?: string;
}

interface PickerEntry {
  instanceId: string;
  key: string;
  kind: "list" | "note";
  title: string;
  description?: string;
  listId?: string;
  listName?: string;
  item?: ListItem;
  note?: NoteSummary;
}

interface MenuEntry {
  id: string;
  label: string;
  description?: string;
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
const ALL_INSTANCES = "__all__";
const ALL_LISTS = "__all__";
const ALL_INSTANCES_LABEL = "All instances";
const ALL_LISTS_LABEL = "All lists";

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

function loadPersistedState(): PersistedState {
  const statePath = path.join(os.homedir(), ".pi", "agent", "extensions", "assistant", "state.json");
  try {
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(content) as PersistedState;
      return parsed && typeof parsed === "object" ? parsed : {};
    }
  } catch {
    // Ignore errors, use defaults
  }
  return {};
}

function persistState(state: AssistantState): void {
  const statePath = path.join(os.homedir(), ".pi", "agent", "extensions", "assistant", "state.json");
  const payload: PersistedState = {
    includeMode: state.includeMode,
    mode: state.mode,
    instanceId: state.instanceId,
    selectedListId: state.selectedListId,
  };
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Ignore persistence errors
  }
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
  private menuMode: "list" | "instance" | "include" | null = null;
  private menuQuery = "";
  private menuFiltered: MenuEntry[] = [];
  private menuSelectedIndex = 0;

  constructor(
    private instances: Map<string, InstanceData>,
    private state: AssistantState,
    private showListNotesPreview: boolean,
    private listInstanceIds: Set<string>,
    private noteInstanceIds: Set<string>,
    private done: (result: PickerResult) => void,
    private onSelectionChange: () => void,
    private onStateChange: () => void
  ) {
    this.instanceIds = Array.from(instances.keys());
    if (this.instanceIds.length === 0) {
      this.instanceIds = [state.instanceId || "default"];
    }
    const existingInstanceIndex = this.instanceIds.findIndex((id) => id === state.instanceId);
    this.instanceIndex = existingInstanceIndex >= 0 ? existingInstanceIndex : 0;
    this.state.instanceId = this.instanceIds[this.instanceIndex] ?? this.state.instanceId;

    this.ensureInstanceForMode();
    if (this.state.instanceId === ALL_INSTANCES) {
      this.state.selectedListId = ALL_LISTS;
    }
    const activeLists = this.getActiveLists();
    if (activeLists.length > 0) {
      const listIndex = activeLists.findIndex((list) => list.id === this.state.selectedListId);
      this.listIndex = listIndex >= 0 ? listIndex : 0;
      this.state.selectedListId = activeLists[this.listIndex]?.id;
    }

    this.updateFilter();
  }

  handleInput(data: string): void {
    if (this.menuMode) {
      this.handleMenuInput(data);
      return;
    }

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
      const entry = this.filtered[this.selectedIndex];
      if (entry && !this.state.selections.has(entry.key)) {
        this.toggleSelection(entry);
      }
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

    if (matchesKey(data, "return")) {
      const option = options[this.selectedOption];
      if (option?.id === "list") {
        this.openMenu("list");
        return;
      }
      if (option?.id === "instance") {
        this.openMenu("instance");
        return;
      }
      if (option?.id === "include") {
        this.openMenu("include");
        return;
      }
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

  private handleMenuInput(data: string): void {
    if (!this.menuMode) return;

    if (matchesKey(data, "escape")) {
      this.closeMenu();
      return;
    }

    if (matchesKey(data, "return")) {
      const entry = this.menuFiltered[this.menuSelectedIndex];
      if (entry) {
        if (this.menuMode === "instance") {
          this.state.instanceId = entry.id;
          if (this.state.instanceId === ALL_INSTANCES) {
            this.listIndex = 0;
            this.state.selectedListId = ALL_LISTS;
          } else {
            this.ensureInstanceForMode();
            const activeLists = this.getActiveLists();
            if (activeLists.length > 0) {
              const existingIndex = this.state.selectedListId
                ? activeLists.findIndex((list) => list.id === this.state.selectedListId)
                : -1;
              if (existingIndex >= 0) {
                this.listIndex = existingIndex;
              } else {
                this.listIndex = 0;
                this.state.selectedListId = activeLists[0]?.id;
              }
            } else {
              this.state.selectedListId = ALL_LISTS;
            }
          }
          this.onStateChange();
        } else if (this.menuMode === "list") {
          this.state.selectedListId = entry.id;
          const lists = this.getActiveLists();
          const index = lists.findIndex((list) => list.id === entry.id);
          this.listIndex = index >= 0 ? index : 0;
          this.onStateChange();
        } else if (this.menuMode === "include") {
          if (entry.id === "metadata" || entry.id === "content") {
            this.state.includeMode = entry.id;
            this.onStateChange();
          }
        }
        this.updateFilter();
      }
      this.closeMenu();
      return;
    }

    if (matchesKey(data, "up")) {
      if (this.menuFiltered.length > 0) {
        this.menuSelectedIndex =
          this.menuSelectedIndex === 0 ? this.menuFiltered.length - 1 : this.menuSelectedIndex - 1;
      }
      return;
    }

    if (matchesKey(data, "down")) {
      if (this.menuFiltered.length > 0) {
        this.menuSelectedIndex =
          this.menuSelectedIndex === this.menuFiltered.length - 1 ? 0 : this.menuSelectedIndex + 1;
      }
      return;
    }

    if (matchesKey(data, "backspace")) {
      if (this.menuQuery.length > 0) {
        this.menuQuery = this.menuQuery.slice(0, -1);
        this.updateMenuFilter();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.menuQuery += data;
      this.updateMenuFilter();
    }
  }

  private openMenu(mode: "list" | "instance" | "include"): void {
    this.menuMode = mode;
    this.menuQuery = "";
    this.updateMenuFilter();
    const currentId = mode === "instance"
      ? this.getActiveInstanceId()
      : mode === "list"
        ? this.state.selectedListId
        : this.state.includeMode;
    const index = currentId
      ? this.menuFiltered.findIndex((entry) => entry.id === currentId)
      : -1;
    this.menuSelectedIndex = index >= 0 ? index : 0;
  }

  private closeMenu(): void {
    this.menuMode = null;
    this.menuQuery = "";
    this.menuSelectedIndex = 0;
    this.menuFiltered = [];
  }

  private getMenuEntries(): MenuEntry[] {
    if (this.menuMode === "instance") {
      const choices = this.getInstanceChoices(false);
      return [
        { id: ALL_INSTANCES, label: ALL_INSTANCES_LABEL },
        ...choices.map((id) => ({ id, label: id })),
      ];
    }

    if (this.menuMode === "list") {
      if (this.state.instanceId === ALL_INSTANCES) {
        return [{ id: ALL_LISTS, label: ALL_LISTS_LABEL }];
      }
      return [
        { id: ALL_LISTS, label: ALL_LISTS_LABEL },
        ...this.getActiveLists().map((list) => ({
          id: list.id,
          label: list.name || list.id,
        })),
      ];
    }

    if (this.menuMode === "include") {
      return [
        { id: "metadata", label: "Metadata" },
        { id: "content", label: "Content" },
      ];
    }

    return [];
  }

  private updateMenuFilter(): void {
    const entries = this.getMenuEntries();
    if (!this.menuQuery.trim()) {
      this.menuFiltered = entries;
      this.menuSelectedIndex = 0;
      return;
    }
    const scored = entries
      .map((entry) => ({
        entry,
        score: fuzzyScore(this.menuQuery, entry.label),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
    this.menuFiltered = scored;
    this.menuSelectedIndex = 0;
  }

  private cycleOption(option: PickerOption, direction: number): void {
    if (option.id === "mode") {
      this.state.mode = this.state.mode === "lists" ? "notes" : "lists";
      this.ensureInstanceForMode();
      this.query = "";
      this.selectedIndex = 0;
      this.selectedOption = 0;
      this.updateFilter();
      this.onStateChange();
      return;
    }

    if (option.id === "include") {
      this.state.includeMode = this.state.includeMode === "metadata" ? "content" : "metadata";
      this.onStateChange();
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
      if (this.state.instanceId === ALL_INSTANCES) {
        this.listIndex = 0;
        this.state.selectedListId = ALL_LISTS;
      } else {
        const activeLists = this.getActiveLists();
        if (activeLists.length > 0) {
          const existingIndex = this.state.selectedListId
            ? activeLists.findIndex((list) => list.id === this.state.selectedListId)
            : -1;
          if (existingIndex >= 0) {
            this.listIndex = existingIndex;
          } else {
            this.listIndex = 0;
            this.state.selectedListId = activeLists[0]?.id;
          }
        } else {
          this.state.selectedListId = ALL_LISTS;
        }
      }
      this.query = "";
      this.selectedIndex = 0;
      this.updateFilter();
      this.onStateChange();
      return;
    }

    if (option.id === "list") {
      const choices = this.getListChoices();
      if (choices.length === 0) return;
      const currentIndex = Math.max(0, choices.findIndex((id) => id === (this.state.selectedListId ?? ALL_LISTS)));
      const nextIndex = currentIndex + direction;
      const wrappedIndex = nextIndex < 0
        ? choices.length - 1
        : nextIndex >= choices.length
          ? 0
          : nextIndex;
      const nextId = choices[wrappedIndex] ?? ALL_LISTS;
      this.state.selectedListId = nextId;
      if (this.state.selectedListId === ALL_LISTS) {
        this.listIndex = 0;
      } else {
        const lists = this.getActiveLists();
        const index = lists.findIndex((list) => list.id === this.state.selectedListId);
        this.listIndex = index >= 0 ? index : 0;
      }
      this.query = "";
      this.selectedIndex = 0;
      this.updateFilter();
      this.onStateChange();
    }
  }

  private getActiveInstanceId(): string {
    return this.state.instanceId || this.instanceIds[this.instanceIndex] || "default";
  }

  private getInstanceChoices(includeAll = true): string[] {
    if (this.state.mode === "lists" && this.listInstanceIds.size > 0) {
      const base = this.instanceIds.filter((id) => this.listInstanceIds.has(id));
      const choices = base.length > 0 ? base : this.instanceIds;
      return includeAll ? [ALL_INSTANCES, ...choices] : choices;
    }
    if (this.state.mode === "notes" && this.noteInstanceIds.size > 0) {
      const base = this.instanceIds.filter((id) => this.noteInstanceIds.has(id));
      const choices = base.length > 0 ? base : this.instanceIds;
      return includeAll ? [ALL_INSTANCES, ...choices] : choices;
    }
    return includeAll ? [ALL_INSTANCES, ...this.instanceIds] : this.instanceIds;
  }

  private ensureInstanceForMode(): void {
    if (this.state.instanceId === ALL_INSTANCES) {
      return;
    }
    const choices = this.getInstanceChoices(false);
    if (choices.length === 0) return;
    if (!choices.includes(this.state.instanceId)) {
      this.state.instanceId = choices[0];
    }
    const index = this.instanceIds.findIndex((id) => id === this.state.instanceId);
    this.instanceIndex = index >= 0 ? index : 0;
  }

  private getInstanceScopeIds(): string[] {
    if (this.state.instanceId === ALL_INSTANCES) {
      const choices = this.getInstanceChoices(false);
      return choices.length > 0 ? choices : this.instanceIds;
    }
    return [this.state.instanceId];
  }

  private getListScopeId(): string | null {
    if (this.state.mode !== "lists") return null;
    if (this.state.instanceId === ALL_INSTANCES) {
      return null;
    }
    if (!this.state.selectedListId || this.state.selectedListId === ALL_LISTS) {
      return null;
    }
    return this.state.selectedListId;
  }

  private getListChoices(): string[] {
    if (this.state.mode !== "lists") return [];
    if (this.state.instanceId === ALL_INSTANCES) {
      return [ALL_LISTS];
    }
    const lists = this.getActiveLists();
    const ids = lists.map((list) => list.id);
    return [ALL_LISTS, ...ids];
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
    if (this.state.instanceId === ALL_INSTANCES) {
      return null;
    }
    const selectedId = this.state.selectedListId;
    if (selectedId && selectedId !== ALL_LISTS) {
      return lists.find((list) => list.id === selectedId) ?? lists[0] ?? null;
    }
    return lists[0] ?? null;
  }

  private getEntries(): PickerEntry[] {
    const queryActive = this.query.trim().length > 0;
    if (this.state.mode === "notes") {
      if (this.state.instanceId === ALL_INSTANCES && !queryActive) {
        return [];
      }

      const instanceIds = this.getInstanceScopeIds();
      const includeInstanceLabel = instanceIds.length > 1 || this.state.instanceId === ALL_INSTANCES;
      const entries: PickerEntry[] = [];

      for (const instanceId of instanceIds) {
        const data = this.instances.get(instanceId);
        const notes = data?.notes ?? [];
        for (const note of notes) {
          const baseDescription = note.description
            ? normalizeWhitespace(note.description)
            : note.tags
              ? note.tags.join(", ")
              : "";
          const description = includeInstanceLabel
            ? baseDescription
              ? `${instanceId} - ${baseDescription}`
              : instanceId
            : baseDescription || undefined;
          const key = noteSelectionKey(instanceId, note.title);
          entries.push({
            instanceId,
            key,
            kind: "note",
            title: note.title,
            ...(description ? { description } : {}),
            note,
          });
        }
      }

      return entries;
    }

    if (!queryActive && this.getListScopeId() === null) {
      return [];
    }

    const listScopeId = this.getListScopeId();
    const instanceIds = this.getInstanceScopeIds();
    const includeInstanceLabel = instanceIds.length > 1 || this.state.instanceId === ALL_INSTANCES;
    const includeListLabel = listScopeId === null;
    const entries: PickerEntry[] = [];

    for (const instanceId of instanceIds) {
      const data = this.instances.get(instanceId);
      if (!data) continue;
      const listEntries = buildListItemEntries(
        data.lists,
        data.listItemsByListId,
        listScopeId,
        this.showListNotesPreview,
        {
          includeListLabel,
          instanceLabel: includeInstanceLabel ? instanceId : undefined,
        }
      );
      for (const entry of listEntries) {
        const itemId = entry.item.id ?? "";
        const key = itemId
          ? listSelectionKey(instanceId, entry.listId, itemId)
          : `list:${instanceId}:${entry.listId}:${entry.item.title}`;
        entries.push({
          instanceId,
          key,
          kind: "list",
          title: entry.item.title,
          ...(entry.description ? { description: entry.description } : {}),
          listId: entry.listId,
          listName: entry.listName,
          item: entry.item,
        });
      }
    }

    return entries;
  }

  private updateFilter(): void {
    const entries = this.getEntries();
    this.filtered = filterEntries(entries, this.query);
    this.selectedIndex = 0;
  }

  private toggleSelection(entry: PickerEntry): void {
    if (entry.kind === "list") {
      const item = entry.item;
      if (!item || !item.id || !entry.listId) return;
      const instanceId = entry.instanceId || this.getActiveInstanceId();
      const key = listSelectionKey(instanceId, entry.listId, item.id);
      if (this.state.selections.has(key)) {
        this.state.selections.delete(key);
        this.state.order = this.state.order.filter((existing) => existing !== key);
      } else {
        this.state.selections.set(key, {
          key,
          kind: "list",
          instanceId,
          listId: entry.listId,
          listName: entry.listName,
          item,
        });
        this.state.order.push(key);
      }
      this.onSelectionChange();
      return;
    }

    if (entry.kind === "note" && entry.note) {
      const note = entry.note;
      const instanceId = entry.instanceId || this.getActiveInstanceId();
      const key = noteSelectionKey(instanceId, note.title);
      if (this.state.selections.has(key)) {
        this.state.selections.delete(key);
        this.state.order = this.state.order.filter((existing) => existing !== key);
      } else {
        this.state.selections.set(key, {
          key,
          kind: "note",
          instanceId,
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
      const listValue = this.state.selectedListId === ALL_LISTS || this.state.instanceId === ALL_INSTANCES || !list
        ? ALL_LISTS_LABEL
        : list.name ?? "None";
      options.push({
        id: "list",
        label: "List",
        value: listValue,
      });
    }

    const instanceChoices = this.getInstanceChoices();
    if (instanceChoices.length > 1) {
      const instanceValue = this.state.instanceId === ALL_INSTANCES
        ? ALL_INSTANCES_LABEL
        : this.getActiveInstanceId();
      options.push({
        id: "instance",
        label: "Instance",
        value: instanceValue,
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

    const isMenu = this.menuMode !== null;
    const queryDisplay = isMenu
      ? this.menuQuery || placeholder(
        `type to ${
          this.menuMode === "list"
            ? "filter lists"
            : this.menuMode === "include"
              ? "filter modes"
              : "filter instances"
        }...`
      )
      : this.query || placeholder("type to filter...");
    const searchLabel = isMenu
      ? this.menuMode === "list"
        ? "Filter lists"
        : this.menuMode === "include"
          ? "Filter mode"
          : "Filter instances"
      : "Search";
    lines.push(row(`${searchLabel}: ${queryDisplay}`));

    lines.push(border("+" + "-".repeat(innerW) + "+"));

    const modeLabel = this.state.mode === "lists" ? "Lists" : "Notes";
    const listLabel = this.state.mode === "lists"
      ? this.state.selectedListId === ALL_LISTS || this.state.instanceId === ALL_INSTANCES
        ? ALL_LISTS_LABEL
        : this.getActiveList()?.name ?? "None"
      : "-";
    const instanceLabel = this.state.instanceId === ALL_INSTANCES
      ? ALL_INSTANCES_LABEL
      : this.getActiveInstanceId();
    const contextLine = `Mode: ${modeLabel} | List: ${listLabel} | Instance: ${instanceLabel}`;
    lines.push(row(truncate(contextLine, innerW - 1)));

    const entries = this.menuMode ? this.menuFiltered : this.filtered;
    const queryActive = this.query.trim().length > 0;
    const cursorIndex = this.menuMode ? this.menuSelectedIndex : this.selectedIndex;
    const maxVisible = 8;
    const startIndex = Math.max(
      0,
      Math.min(cursorIndex - Math.floor(maxVisible / 2), entries.length - maxVisible)
    );
    const endIndex = Math.min(startIndex + maxVisible, entries.length);

    if (entries.length === 0) {
      const emptyLabel = this.menuMode
        ? `No ${this.menuMode === "list" ? "lists" : this.menuMode === "include" ? "modes" : "instances"}`
        : this.state.mode === "lists"
          ? (!queryActive && this.getListScopeId() === null
            ? "Select a list or type to search"
            : "No list items")
          : (!queryActive && this.state.instanceId === ALL_INSTANCES
            ? "Type to search all instances"
            : "No notes");
      lines.push(row(hint(emptyLabel)));
    } else if (this.menuMode) {
      for (let i = startIndex; i < endIndex; i++) {
        const entry = entries[i];
        const isCursor = i === this.menuSelectedIndex;
        const cursor = isCursor ? ">" : " ";
        const label = "label" in entry ? entry.label : entry.title;
        const desc = "description" in entry && entry.description ? ` - ${entry.description}` : "";
        const rawLine = `${cursor} ${label}${desc}`;
        const truncated = truncate(rawLine, innerW - 1);
        const rendered = isCursor ? selected(truncated) : truncated;
        lines.push(row(rendered));
      }
    } else {
      for (let i = startIndex; i < endIndex; i++) {
        const entry = entries[i] as PickerEntry;
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
    const hintLine = this.menuMode
      ? "Enter select  Esc back"
      : "Enter insert  Space toggle  Tab options  Esc close";
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
const persistedState = loadPersistedState();

const state: AssistantState = {
  selections: new Map(),
  order: [],
  includeMode: persistedState.includeMode ?? config.includeMode ?? "metadata",
  mode: persistedState.mode ?? "lists",
  instanceId: persistedState.instanceId ?? config.defaultInstance ?? "default",
  selectedListId: persistedState.selectedListId,
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

      const result = await ctx.ui.custom<PickerResult>(
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
            },
            () => {
              persistState(state);
            }
          ),
        { overlay: true }
      );

      const summary = formatSelectionSummary(state);
      ctx.ui.setStatus("assistant", summary.status);
      ctx.ui.setWidget("assistant", summary.widget);

      if (result.action !== "confirm" || state.selections.size === 0) {
        return;
      }

      const selections: Selection[] = [];
      for (const key of state.order) {
        const selection = state.selections.get(key);
        if (selection) {
          selections.push(selection);
        }
      }

      ctx.ui.setStatus("assistant", "Preparing selection...");
      const blocks = await buildSelectionBlocks(selections, state.includeMode, client, ctx);
      const content = joinBlocks(blocks);
      if (!content) {
        ctx.ui.notify("No content to insert", "warning");
        ctx.ui.setStatus("assistant", summary.status);
        ctx.ui.setWidget("assistant", summary.widget);
        return;
      }

      ctx.ui.setEditorText(content);
      ctx.ui.notify("Assistant context ready - press Enter to send", "info");
      state.selections.clear();
      state.order = [];
      ctx.ui.setStatus("assistant", undefined);
      ctx.ui.setWidget("assistant", undefined);
    },
  });
}
