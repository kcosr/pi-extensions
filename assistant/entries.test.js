const test = require("node:test");
const assert = require("node:assert/strict");
const { buildListItemEntries } = require("./entries");

test("buildListItemEntries scopes to a specific list when provided", () => {
  const lists = [
    { id: "a", name: "List A" },
    { id: "b", name: "List B" },
  ];
  const listItemsByListId = new Map([
    ["a", [{ title: "Item A" }]],
    ["b", [{ title: "Item B" }]],
  ]);

  const entries = buildListItemEntries(lists, listItemsByListId, "b", true, {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].listId, "b");
  assert.equal(entries[0].listName, "List B");
});

test("buildListItemEntries returns all lists when no list scope is provided", () => {
  const lists = [
    { id: "a", name: "List A" },
    { id: "b", name: "List B" },
  ];
  const listItemsByListId = new Map([
    ["a", [{ title: "Item A" }]],
    ["b", [{ title: "Item B" }]],
  ]);

  const entries = buildListItemEntries(lists, listItemsByListId, null, false, {
    includeListLabel: true,
    instanceLabel: "default",
  });
  assert.equal(entries.length, 2);
  assert.ok(entries[0].description.includes("default"));
});
