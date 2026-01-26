const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInstancePlan } = require("./instances");

test("buildInstancePlan unions list/note instances and ignores unsupported preferred", () => {
  const plan = buildInstancePlan(
    [{ id: "default" }],
    [{ id: "work" }],
    "scratch"
  );
  assert.deepEqual(plan.instanceIds, ["default", "work"]);
  assert.equal(plan.listInstanceIds.has("default"), true);
  assert.equal(plan.noteInstanceIds.has("work"), true);
  assert.equal(plan.instanceIds.includes("scratch"), false);
});

test("buildInstancePlan prioritizes preferred when present", () => {
  const plan = buildInstancePlan(
    [{ id: "default" }],
    [{ id: "scratch" }],
    "scratch"
  );
  assert.deepEqual(plan.instanceIds, ["scratch", "default"]);
});

test("buildInstancePlan falls back to preferred when no instances", () => {
  const plan = buildInstancePlan([], [], "scratch");
  assert.deepEqual(plan.instanceIds, ["scratch"]);
});
