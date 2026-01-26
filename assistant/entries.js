function normalizeWhitespace(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function buildListItemEntries(lists, listItemsByListId, activeListId, query, showNotesPreview) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  const listMap = new Map();
  for (const list of lists || []) {
    if (list && list.id) {
      listMap.set(list.id, list);
    }
  }

  if (!trimmedQuery) {
    const fallbackListId = activeListId || (lists && lists[0] ? lists[0].id : undefined);
    if (!fallbackListId) return [];
    const list = listMap.get(fallbackListId);
    const listName = list && list.name ? list.name : fallbackListId;
    const items = listItemsByListId.get(fallbackListId) || [];
    return items.map((item) => {
      const description = showNotesPreview && item && typeof item.notes === "string" && item.notes.trim()
        ? normalizeWhitespace(item.notes)
        : undefined;
      return {
        listId: fallbackListId,
        listName,
        item,
        description,
      };
    });
  }

  const entries = [];
  for (const list of lists || []) {
    if (!list || !list.id) continue;
    const listName = list.name || list.id;
    const items = listItemsByListId.get(list.id) || [];
    for (const item of items) {
      let description = listName;
      if (showNotesPreview && item && typeof item.notes === "string" && item.notes.trim()) {
        description = `${listName} - ${normalizeWhitespace(item.notes)}`;
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
