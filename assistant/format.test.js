const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildListItemExportBlock,
  buildListItemContentBlock,
  buildNoteMetadataBlock,
  buildNoteContentBlock,
  joinBlocks,
} = require("./format");

test("buildListItemExportBlock includes optional fields", () => {
  const block = buildListItemExportBlock(
    {
      id: "item-1",
      title: "Title",
      notes: "Note",
      url: "http://example.com",
      customFields: { priority: "high", score: 3, agent_notes: "Agent detail" },
    },
    { id: "list-1", name: "My List" },
    "default"
  );
  assert.ok(block);
  assert.match(block, /plugin: lists/);
  assert.match(block, /itemId: item-1/);
  assert.match(block, /title: Title/);
  assert.match(block, /User Notes/);
  assert.match(block, /Note/);
  assert.match(block, /url: http:\/\/example.com/);
  assert.match(block, /priority: high/);
  assert.match(block, /score: 3/);
  assert.match(block, /listId: list-1/);
  assert.match(block, /listName: My List/);
  assert.match(block, /instance_id: default/);
  assert.match(block, /Agent Notes/);
  assert.match(block, /Agent detail/);
});

test("buildNoteMetadataBlock formats tags and description", () => {
  const block = buildNoteMetadataBlock(
    { title: "Note", tags: ["a", "b"], description: "Desc" },
    "default"
  );
  assert.ok(block);
  assert.match(block, /plugin: notes/);
  assert.match(block, /title: Note/);
  assert.match(block, /tags: a, b/);
  assert.match(block, /description: Desc/);
  assert.match(block, /instance_id: default/);
});

test("buildListItemContentBlock emits frontmatter and notes body", () => {
  const block = buildListItemContentBlock(
    {
      id: "item-1",
      title: "Title",
      notes: "Body",
      customFields: { foo: "bar", agent_notes: "Agent body" },
    },
    { id: "list-1", name: "My List" },
    "default"
  );
  assert.ok(block);
  assert.match(block, /^---/);
  assert.match(block, /plugin: \"lists\"/);
  assert.match(block, /itemId: \"item-1\"/);
  assert.match(block, /title: \"Title\"/);
  assert.match(block, /listId: \"list-1\"/);
  assert.match(block, /listName: \"My List\"/);
  assert.match(block, /instance_id: \"default\"/);
  assert.match(block, /foo: bar/);
  assert.match(block, /User Notes/);
  assert.match(block, /Body/);
  assert.match(block, /Agent Notes/);
  assert.match(block, /Agent body/);
  assert.doesNotMatch(block, /agent_notes/);
});

test("buildNoteContentBlock combines frontmatter and content", () => {
  const block = buildNoteContentBlock(
    { title: "Note" },
    "default",
    "# Heading\nBody"
  );
  assert.ok(block);
  assert.match(block, /plugin: \"notes\"/);
  assert.match(block, /title: \"Note\"/);
  assert.match(block, /# Heading/);
});

test("joinBlocks concatenates blocks with spacing", () => {
  const joined = joinBlocks(["one", null, "", "two"]);
  assert.equal(joined, "one\n\ntwo");
});
