function normalizeWhitespace(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function buildListItemEntries(lists, listItemsByListId, listScopeId, showNotesPreview, options) {
  const scopeId = typeof listScopeId === "string" && listScopeId.trim().length > 0 ? listScopeId : null;
  const includeListLabel = options && options.includeListLabel === true;
  const instanceLabel = options && typeof options.instanceLabel === "string" && options.instanceLabel.trim().length > 0
    ? options.instanceLabel.trim()
    : "";
  const listMap = new Map();
  for (const list of lists || []) {
    if (list && list.id) {
      listMap.set(list.id, list);
    }
  }

  const entries = [];
  for (const list of lists || []) {
    if (!list || !list.id) continue;
    if (scopeId && list.id !== scopeId) continue;
    const listName = list.name || list.id;
    const items = listItemsByListId.get(list.id) || [];
    for (const item of items) {
      const prefixParts = [];
      if (instanceLabel) {
        prefixParts.push(instanceLabel);
      }
      if (includeListLabel) {
        prefixParts.push(listName);
      }
      const prefix = prefixParts.join(" / ");
      let description = prefix || undefined;
      if (showNotesPreview && item && typeof item.notes === "string" && item.notes.trim()) {
        const notesText = normalizeWhitespace(item.notes);
        description = prefix ? `${prefix} - ${notesText}` : notesText;
      }
      entries.push({
        listId: list.id,
        listName,
        item,
        description,
      });
    }
  }

  return entries;
}

module.exports = {
  buildListItemEntries,
  normalizeWhitespace,
};
