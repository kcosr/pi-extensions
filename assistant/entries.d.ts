export interface ListSummary {
  id: string;
  name?: string;
}

export interface ListItem {
  id?: string;
  title: string;
  notes?: string;
  url?: string;
  tags?: string[];
  completed?: boolean;
  position?: number;
  customFields?: Record<string, unknown>;
}

export interface ListItemEntry {
  listId: string;
  listName: string;
  item: ListItem;
  description?: string;
}

export function normalizeWhitespace(value: string): string;

export function buildListItemEntries(
  lists: ListSummary[],
  listItemsByListId: Map<string, ListItem[]>,
  listScopeId: string | null | undefined,
  showNotesPreview: boolean,
  options?: {
    includeListLabel?: boolean;
    instanceLabel?: string;
  }
): ListItemEntry[];
