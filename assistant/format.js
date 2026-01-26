function normalizeString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function formatFrontmatterValue(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(String(value));
}

function pushFrontmatterLine(lines, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim().length === 0) return;
  lines.push(`${key}: ${formatFrontmatterValue(value)}`);
}

function buildFrontmatter(entries) {
  const lines = ["---"];
  for (const [key, value] of entries) {
    pushFrontmatterLine(lines, key, value);
  }
  lines.push("---");
  return lines.join("\n");
}

function buildListItemExportBlock(item, list, instanceId) {
  if (!item) return null;
  const title = normalizeString(item.title);
  if (!title) return null;

  const lines = [];
  lines.push("plugin: lists");
  if (item.id) {
    lines.push(`itemId: ${item.id}`);
  }
  lines.push(`title: ${title}`);

  const notes = normalizeString(item.notes || "");
  if (notes) {
    lines.push(`notes: ${notes}`);
  }

  const url = normalizeString(item.url || "");
  if (url) {
    lines.push(`url: ${url}`);
  }

  if (list && list.id) {
    lines.push(`listId: ${list.id}`);
  }
  if (list && list.name) {
    const listName = normalizeString(list.name);
    if (listName) {
      lines.push(`listName: ${listName}`);
    }
  }
  if (instanceId) {
    lines.push(`instance_id: ${instanceId}`);
  }

  return lines.join("\n");
}

function buildNoteMetadataBlock(note, instanceId) {
  if (!note) return null;
  const title = normalizeString(note.title);
  if (!title) return null;

  const lines = [];
  lines.push("plugin: notes");
  lines.push(`title: ${title}`);

  if (Array.isArray(note.tags) && note.tags.length > 0) {
    lines.push(`tags: ${note.tags.join(", ")}`);
  }

  const description = normalizeString(note.description || "");
  if (description) {
    lines.push(`description: ${description}`);
  }

  if (instanceId) {
    lines.push(`instance_id: ${instanceId}`);
  }

  return lines.join("\n");
}

function buildListItemContentBlock(item, list, instanceId) {
  if (!item) return null;
  const title = normalizeString(item.title);
  if (!title) return null;

  const tags = Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(", ") : undefined;
  const url = normalizeString(item.url || "");
  const frontmatter = buildFrontmatter([
    ["plugin", "lists"],
    ["itemId", item.id],
    ["title", title],
    ["url", url || undefined],
    ["listId", list && list.id ? list.id : undefined],
    ["listName", list && list.name ? list.name : undefined],
    ["instance_id", instanceId],
    ["tags", tags],
    ["completed", typeof item.completed === "boolean" ? item.completed : undefined],
    ["position", typeof item.position === "number" ? item.position : undefined],
  ]);

  const notes = typeof item.notes === "string" ? item.notes : "";
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) {
    return frontmatter;
  }
  return `${frontmatter}\n\n${notes}`;
}

function buildNoteContentBlock(note, instanceId, content) {
  if (!note) return null;
  const title = normalizeString(note.title);
  if (!title) return null;
  const tags = Array.isArray(note.tags) && note.tags.length > 0 ? note.tags.join(", ") : undefined;
  const description = normalizeString(note.description || "");

  const frontmatter = buildFrontmatter([
    ["plugin", "notes"],
    ["title", title],
    ["tags", tags],
    ["description", description || undefined],
    ["instance_id", instanceId],
  ]);

  if (typeof content !== "string" || content.length === 0) {
    return frontmatter;
  }
  return `${frontmatter}\n\n${content}`;
}

module.exports = {
  buildListItemExportBlock,
  buildListItemContentBlock,
  buildNoteMetadataBlock,
  buildNoteContentBlock,
};
