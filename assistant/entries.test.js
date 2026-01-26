const test = require("node:test");
const assert = require("node:assert/strict");
const { buildListItemEntries } = require("./entries");

test("buildListItemEntries uses active list when query is empty", () => {
  const lists = [
    { id: "a", name: "List A" },
    { id: "b", name: "List B" },
  ];
  const listItemsByListId = new Map([
    ["a", [{ title: "Item A" }]],
    ["b", [{ title: "Item B" }]],
  ]);

  const entries = buildListItemEntries(lists, listItemsByListId, "b", "", true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].listId, "b");
  assert.equal(entries[0].listName, "List B");
});

test("buildListItemEntries returns all lists when query is non-empty", () => {
  const lists = [
    { id: "a", name: "List A" },
    { id: "b", name: "List B" },
  ];
  const listItemsByListId = new Map([
    ["a", [{ title: "Item A" }]],
    ["b", [{ title: "Item B" }]],
  ]);

  const entries = buildListItemEntries(lists, listItemsByListId, "a", "foo", false);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].listName.startsWith("List"), true);
});
