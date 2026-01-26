export interface ListInfo {
  id?: string;
  name?: string;
}

export interface ListItem {
  id?: string;
  title?: string;
  notes?: string;
  url?: string;
  tags?: string[];
  completed?: boolean;
  position?: number;
  customFields?: Record<string, unknown>;
}

export interface NoteInfo {
  title?: string;
  tags?: string[];
  description?: string;
}

export function buildListItemExportBlock(
  item: ListItem,
  list: ListInfo | null,
  instanceId?: string | null
): string | null;

export function buildListItemContentBlock(
  item: ListItem,
  list: ListInfo | null,
  instanceId?: string | null
): string | null;

export function buildNoteMetadataBlock(
  note: NoteInfo,
  instanceId?: string | null
): string | null;

export function buildNoteContentBlock(
  note: NoteInfo,
  instanceId: string | null | undefined,
  content: string
): string | null;

export function joinBlocks(blocks: Array<string | null | undefined>): string;
