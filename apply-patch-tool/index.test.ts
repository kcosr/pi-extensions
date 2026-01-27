import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildToolOutput } from "./tool-output.ts";
import { applyPatch } from "./patch.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-tool-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("buildToolOutput appends unified diff for single file", () => {
  withTempDir((dir) => {
    const targetPath = path.join(dir, "test.txt");
    const initial = [
      "line1",
      "line2",
      "line3",
      "line4",
      "line5",
      "line6",
      "line7",
      "line8",
      "line9",
      "line10",
    ].join("\n");
    fs.writeFileSync(targetPath, `${initial}\n`);

    const patch =
      "*** Begin Patch\n*** Update File: test.txt\n@@\n-line3\n+line3 updated\n*** End Patch";
    const result = applyPatch(patch, dir);

    const output = buildToolOutput(result);
    const expectedSummary = "Success. Updated the following files:\nM test.txt\n";
    assert.equal(
      output,
      `${expectedSummary}\n` +
        "diff --git a/test.txt b/test.txt\n" +
        "--- a/test.txt\n" +
        "+++ b/test.txt\n" +
        "@@ -2,3 +2,3 @@\n" +
        " line2\n" +
        "-line3\n" +
        "+line3 updated\n" +
        " line4\n",
    );
  });
});

test("buildToolOutput appends unified diff for multi-file changes", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "bravo\n");

    const patch =
      "*** Begin Patch\n*** Update File: a.txt\n@@\n-alpha\n+alpha2\n*** Update File: b.txt\n@@\n-bravo\n+bravo2\n*** End Patch";
    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nM a.txt\nM b.txt\n");
    assert.equal(
      buildToolOutput(result),
      "Success. Updated the following files:\nM a.txt\nM b.txt\n\n" +
        "diff --git a/a.txt b/a.txt\n" +
        "--- a/a.txt\n" +
        "+++ b/a.txt\n" +
        "@@ -1,1 +1,1 @@\n" +
        "-alpha\n" +
        "+alpha2\n" +
        "\n" +
        "diff --git a/b.txt b/b.txt\n" +
        "--- a/b.txt\n" +
        "+++ b/b.txt\n" +
        "@@ -1,1 +1,1 @@\n" +
        "-bravo\n" +
        "+bravo2\n",
    );
  });
});
