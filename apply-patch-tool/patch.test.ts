import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPatch } from "./patch.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-tool-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("applyPatch applies multiple operations", () => {
  withTempDir((dir) => {
    const modifyPath = path.join(dir, "modify.txt");
    const deletePath = path.join(dir, "delete.txt");
    fs.writeFileSync(modifyPath, "line1\nline2\n");
    fs.writeFileSync(deletePath, "obsolete\n");

    const patch =
      "*** Begin Patch\n*** Add File: nested/new.txt\n+created\n*** Delete File: delete.txt\n*** Update File: modify.txt\n@@\n-line2\n+changed\n*** End Patch";

    const result = applyPatch(patch, dir);
    assert.equal(
      result.summary,
      "Success. Updated the following files:\nA nested/new.txt\nM modify.txt\nD delete.txt\n",
    );
    assert.equal(fs.readFileSync(path.join(dir, "nested/new.txt"), "utf-8"), "created\n");
    assert.equal(fs.readFileSync(modifyPath, "utf-8"), "line1\nchanged\n");
    assert.equal(fs.existsSync(deletePath), false);
  });
});

test("applyPatch applies multiple chunks", () => {
  withTempDir((dir) => {
    const targetPath = path.join(dir, "multi.txt");
    fs.writeFileSync(targetPath, "line1\nline2\nline3\nline4\n");

    const patch =
      "*** Begin Patch\n*** Update File: multi.txt\n@@\n-line2\n+changed2\n@@\n-line4\n+changed4\n*** End Patch";

    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nM multi.txt\n");
    assert.equal(fs.readFileSync(targetPath, "utf-8"), "line1\nchanged2\nline3\nchanged4\n");
  });
});

test("applyPatch moves files to new directories", () => {
  withTempDir((dir) => {
    const originalPath = path.join(dir, "old/name.txt");
    const newPath = path.join(dir, "renamed/dir/name.txt");
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(originalPath, "old content\n");

    const patch =
      "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-old content\n+new content\n*** End Patch";

    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nM renamed/dir/name.txt\n");
    assert.equal(fs.existsSync(originalPath), false);
    assert.equal(fs.readFileSync(newPath, "utf-8"), "new content\n");
  });
});

test("applyPatch rejects empty patch", () => {
  withTempDir((dir) => {
    assert.throws(
      () => applyPatch("*** Begin Patch\n*** End Patch", dir),
      new Error("No files were modified.\n"),
    );
  });
});

test("applyPatch reports missing context", () => {
  withTempDir((dir) => {
    const targetPath = path.join(dir, "modify.txt");
    fs.writeFileSync(targetPath, "line1\nline2\n");

    const patch =
      "*** Begin Patch\n*** Update File: modify.txt\n@@\n-missing\n+changed\n*** End Patch";

    assert.throws(
      () => applyPatch(patch, dir),
      new Error("Failed to find expected lines in modify.txt:\nmissing\n"),
    );
    assert.equal(fs.readFileSync(targetPath, "utf-8"), "line1\nline2\n");
  });
});

test("applyPatch rejects missing file delete", () => {
  withTempDir((dir) => {
    const patch = "*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch";
    assert.throws(() => applyPatch(patch, dir), new Error("Failed to delete file missing.txt\n"));
  });
});

test("applyPatch rejects empty update hunk", () => {
  withTempDir((dir) => {
    const patch = "*** Begin Patch\n*** Update File: foo.txt\n*** End Patch";
    assert.throws(
      () => applyPatch(patch, dir),
      new Error("Invalid patch hunk on line 2: Update file hunk for path 'foo.txt' is empty\n"),
    );
  });
});

test("applyPatch requires existing file for update", () => {
  withTempDir((dir) => {
    const patch = "*** Begin Patch\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch";
    assert.throws(
      () => applyPatch(patch, dir),
      new Error(
        "Failed to read file to update missing.txt: No such file or directory (os error 2)\n",
      ),
    );
  });
});

test("applyPatch move overwrites existing destination", () => {
  withTempDir((dir) => {
    const originalPath = path.join(dir, "old/name.txt");
    const destination = path.join(dir, "renamed/dir/name.txt");
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(originalPath, "from\n");
    fs.writeFileSync(destination, "existing\n");

    const patch =
      "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-from\n+new\n*** End Patch";

    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nM renamed/dir/name.txt\n");
    assert.equal(fs.existsSync(originalPath), false);
    assert.equal(fs.readFileSync(destination, "utf-8"), "new\n");
  });
});

test("applyPatch add overwrites existing file", () => {
  withTempDir((dir) => {
    const filePath = path.join(dir, "duplicate.txt");
    fs.writeFileSync(filePath, "old content\n");

    const patch = "*** Begin Patch\n*** Add File: duplicate.txt\n+new content\n*** End Patch";
    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nA duplicate.txt\n");
    assert.equal(fs.readFileSync(filePath, "utf-8"), "new content\n");
  });
});

test("applyPatch delete directory fails", () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, "dir"));
    const patch = "*** Begin Patch\n*** Delete File: dir\n*** End Patch";
    assert.throws(() => applyPatch(patch, dir), new Error("Failed to delete file dir\n"));
  });
});

test("applyPatch rejects invalid hunk header", () => {
  withTempDir((dir) => {
    const patch = "*** Begin Patch\n*** Frobnicate File: foo\n*** End Patch";
    assert.throws(
      () => applyPatch(patch, dir),
      new Error(
        "Invalid patch hunk on line 2: '*** Frobnicate File: foo' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'\n",
      ),
    );
  });
});

test("applyPatch updates file and appends trailing newline", () => {
  withTempDir((dir) => {
    const filePath = path.join(dir, "no_newline.txt");
    fs.writeFileSync(filePath, "no newline at end");
    const patch =
      "*** Begin Patch\n*** Update File: no_newline.txt\n@@\n-no newline at end\n+first line\n+second line\n*** End Patch";

    const result = applyPatch(patch, dir);
    assert.equal(result.summary, "Success. Updated the following files:\nM no_newline.txt\n");
    const contents = fs.readFileSync(filePath, "utf-8");
    assert.ok(contents.endsWith("\n"));
    assert.equal(contents, "first line\nsecond line\n");
  });
});

test("applyPatch failure after partial success leaves changes", () => {
  withTempDir((dir) => {
    const patch =
      "*** Begin Patch\n*** Add File: created.txt\n+hello\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch";

    assert.throws(
      () => applyPatch(patch, dir),
      new Error(
        "Failed to read file to update missing.txt: No such file or directory (os error 2)\n",
      ),
    );
    assert.equal(fs.readFileSync(path.join(dir, "created.txt"), "utf-8"), "hello\n");
  });
});

test("applyPatch rejects path traversal outside cwd", () => {
  withTempDir((dir) => {
    const outsidePath = path.join(dir, "..", "escape.txt");
    const patch = "*** Begin Patch\n*** Add File: ../escape.txt\n+outside\n*** End Patch";

    assert.throws(
      () => applyPatch(patch, dir),
      new Error("patch rejected: writing outside of the project; rejected by user approval settings\n"),
    );
    assert.equal(fs.existsSync(outsidePath), false);
  });
});
