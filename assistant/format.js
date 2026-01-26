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
  const json = JSON.stringify(value);
  if (typeof json === "string") {
    return json;
  }
  return JSON.stringify(String(value));
}

function isRawFrontmatterValue(value) {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "__raw");
}

function pushFrontmatterLine(lines, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim().length === 0) return;
  if (isRawFrontmatterValue(value)) {
    const raw = value.__raw;
    if (typeof raw !== "string" || raw.trim().length === 0) return;
    lines.push(`${key}: ${raw}`);
    return;
  }
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

function normalizeCustomFields(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value : null;
  }
  if (typeof value !== "object") return null;
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function normalizeNotesValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}

function formatCustomFieldValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}

function splitCustomFields(value) {
  const customFields = normalizeCustomFields(value);
  if (!customFields) {
    return { fields: null, agentNotes: "" };
  }
  const fields = {};
  let agentNotes = "";
  for (const [key, entryValue] of Object.entries(customFields)) {
    if (key === "agent_notes") {
      const normalized = normalizeNotesValue(entryValue);
      if (normalized) agentNotes = normalized;
      continue;
    }
    fields[key] = entryValue;
  }
  return {
    fields: Object.keys(fields).length > 0 ? fields : null,
    agentNotes,
  };
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

  const notes = normalizeNotesValue(item.notes);
  if (notes) {
    lines.push("User Notes");
    lines.push(notes);
  }

  const url = normalizeString(item.url || "");
  if (url) {
    lines.push(`url: ${url}`);
  }

  const { fields: customFields, agentNotes } = splitCustomFields(item.customFields);
  if (customFields) {
    for (const [key, value] of Object.entries(customFields)) {
      const formatted = formatCustomFieldValue(value);
      if (formatted.trim().length > 0) {
        lines.push(`${key}: ${formatted}`);
      }
    }
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

  if (agentNotes) {
    lines.push("Agent Notes");
    lines.push(agentNotes);
  }

  return lines.join("\n");
}

function buildListItemContentBlock(item, list, instanceId) {
  if (!item) return null;
  const title = normalizeString(item.title);
  if (!title) return null;

  const tags = Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(", ") : undefined;
  const url = normalizeString(item.url || "");
  const { fields: customFields, agentNotes } = splitCustomFields(item.customFields);
  const customEntries = customFields
    ? Object.entries(customFields).map(([key, value]) => [key, { __raw: formatCustomFieldValue(value) }])
    : [];
  const frontmatter = buildFrontmatter([
    ["plugin", "lists"],
    ["itemId", item.id],
    ["title", title],
    ["url", url || undefined],
    ["listId", list && list.id ? list.id : undefined],
    ["listName", list && list.name ? list.name : undefined],
    ["instance_id", instanceId],
    ["tags", tags],
    ...customEntries,
    ["completed", typeof item.completed === "boolean" ? item.completed : undefined],
    ["position", typeof item.position === "number" ? item.position : undefined],
  ]);

  const notes = normalizeNotesValue(item.notes);
  const sections = [];
  if (notes) {
    sections.push("User Notes");
    sections.push(notes);
  }
  if (agentNotes) {
    sections.push("Agent Notes");
    sections.push(agentNotes);
  }
  if (sections.length === 0) {
    return frontmatter;
  }
  return `${frontmatter}\n\n${sections.join("\n\n")}`;
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

function joinBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.filter((block) => typeof block === "string" && block.length > 0).join("\n\n");
}

module.exports = {
  buildListItemExportBlock,
  buildListItemContentBlock,
  buildNoteMetadataBlock,
  buildNoteContentBlock,
  joinBlocks,
};
