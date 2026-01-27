import fs from "node:fs";
import path from "node:path";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

type ParseMode = "strict" | "lenient";

class PatchParseError extends Error {
  readonly kind: "invalid_patch" | "invalid_hunk";
  readonly lineNumber?: number;

  constructor(kind: "invalid_patch" | "invalid_hunk", message: string, lineNumber?: number) {
    super(message);
    this.kind = kind;
    this.lineNumber = lineNumber;
  }
}

interface ApplyPatchArgs {
  hunks: Hunk[];
  patch: string;
}

type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

interface AddFileHunk {
  kind: "add";
  path: string;
  contents: string;
}

interface DeleteFileHunk {
  kind: "delete";
  path: string;
}

interface UpdateFileHunk {
  kind: "update";
  path: string;
  movePath?: string;
  chunks: UpdateFileChunk[];
}

interface UpdateFileChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

interface Replacement {
  startIndex: number;
  oldLen: number;
  newLines: string[];
}

export interface ApplyPatchFileDetail {
  path: string;
  status: "added" | "modified" | "deleted";
  moveFrom?: string;
  moveTo?: string;
  unifiedDiff: string;
}

export interface ApplyPatchDetails {
  added: string[];
  modified: string[];
  deleted: string[];
  files: ApplyPatchFileDetail[];
}

export interface ApplyPatchResult {
  summary: string;
  details: ApplyPatchDetails;
}

interface AffectedPaths {
  added: string[];
  modified: string[];
  deleted: string[];
}

interface AppliedPatch {
  originalContents: string;
  newContents: string;
  replacements: Replacement[];
  originalLines: string[];
  newLines: string[];
}

export function applyPatch(patchText: string, cwd: string): ApplyPatchResult {
  let args: ApplyPatchArgs;
  try {
    args = parsePatch(patchText);
  } catch (err) {
    if (err instanceof PatchParseError) {
      if (err.kind === "invalid_patch") {
        throwError(`Invalid patch: ${err.message}`);
      }
      const lineNumber = err.lineNumber ?? 0;
      throwError(`Invalid patch hunk on line ${lineNumber}: ${err.message}`);
    }
    throw err;
  }
  const { affected, details } = applyHunks(args.hunks, cwd);
  return {
    summary: formatSummary(affected),
    details,
  };
}

function parsePatch(patchText: string): ApplyPatchArgs {
  const mode: ParseMode = "lenient";
  return parsePatchText(patchText, mode);
}

function parsePatchText(patchText: string, mode: ParseMode): ApplyPatchArgs {
  const lines = patchText.trim().split("\n");
  let parsedLines = lines;
  try {
    checkPatchBoundariesStrict(parsedLines);
  } catch (err) {
    if (mode === "strict") {
      throw err;
    }
    const error = err instanceof PatchParseError ? err : new PatchParseError("invalid_patch", String(err));
    parsedLines = checkPatchBoundariesLenient(parsedLines, error);
  }

  const hunks: Hunk[] = [];
  const lastLineIndex = parsedLines.length > 0 ? parsedLines.length - 1 : 0;
  let remaining = parsedLines.slice(1, lastLineIndex);
  let lineNumber = 2;
  while (remaining.length > 0) {
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += consumed;
    remaining = remaining.slice(consumed);
  }

  return { hunks, patch: parsedLines.join("\n") };
}

function checkPatchBoundariesStrict(lines: string[]): void {
  const firstLine = lines.length > 0 ? lines[0] : undefined;
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined;
  checkStartAndEndLinesStrict(firstLine, lastLine);
}

function checkStartAndEndLinesStrict(firstLine?: string, lastLine?: string): void {
  const first = firstLine?.trim();
  const last = lastLine?.trim();

  if (first === BEGIN_PATCH_MARKER && last === END_PATCH_MARKER) {
    return;
  }

  if (first !== BEGIN_PATCH_MARKER) {
    throw new PatchParseError("invalid_patch", "The first line of the patch must be '*** Begin Patch'");
  }

  throw new PatchParseError("invalid_patch", "The last line of the patch must be '*** End Patch'");
}

function checkPatchBoundariesLenient(lines: string[], originalError: PatchParseError): string[] {
  if (lines.length >= 4) {
    const first = lines[0];
    const last = lines[lines.length - 1];
    if ((first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') && last.endsWith("EOF")) {
      const innerLines = lines.slice(1, lines.length - 1);
      checkPatchBoundariesStrict(innerLines);
      return innerLines;
    }
  }

  throw originalError;
}

function parseOneHunk(lines: string[], lineNumber: number): { hunk: Hunk; consumed: number } {
  const firstLine = lines[0].trim();

  if (firstLine.startsWith(ADD_FILE_MARKER)) {
    const filePath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = "";
    let parsedLines = 1;
    for (const addLine of lines.slice(1)) {
      if (addLine.startsWith("+")) {
        contents += `${addLine.slice(1)}\n`;
        parsedLines += 1;
      } else {
        break;
      }
    }
    return { hunk: { kind: "add", path: filePath, contents }, consumed: parsedLines };
  }

  if (firstLine.startsWith(DELETE_FILE_MARKER)) {
    const filePath = firstLine.slice(DELETE_FILE_MARKER.length);
    return { hunk: { kind: "delete", path: filePath }, consumed: 1 };
  }

  if (firstLine.startsWith(UPDATE_FILE_MARKER)) {
    const filePath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let parsedLines = 1;

    let movePath: string | undefined;
    if (remaining[0]?.startsWith(MOVE_TO_MARKER)) {
      movePath = remaining[0].slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      parsedLines += 1;
    }

    const chunks: UpdateFileChunk[] = [];
    while (remaining.length > 0) {
      if (remaining[0].trim() === "") {
        remaining = remaining.slice(1);
        parsedLines += 1;
        continue;
      }

      if (remaining[0].startsWith("***")) {
        break;
      }

      const chunk = parseUpdateFileChunk(remaining, lineNumber + parsedLines, chunks.length === 0);
      chunks.push(chunk.chunk);
      parsedLines += chunk.consumed;
      remaining = remaining.slice(chunk.consumed);
    }

    if (chunks.length === 0) {
      throw new PatchParseError(
        "invalid_hunk",
        `Update file hunk for path '${filePath}' is empty`,
        lineNumber,
      );
    }

    return {
      hunk: {
        kind: "update",
        path: filePath,
        movePath,
        chunks,
      },
      consumed: parsedLines,
    };
  }

  throw new PatchParseError(
    "invalid_hunk",
    `'${firstLine}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    lineNumber,
  );
}

function parseUpdateFileChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } {
  if (lines.length === 0) {
    throw new PatchParseError("invalid_hunk", "Update hunk does not contain any lines", lineNumber);
  }

  let changeContext: string | undefined;
  let startIndex: number;

  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    changeContext = undefined;
    startIndex = 1;
  } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else {
    if (!allowMissingContext) {
      throw new PatchParseError(
        "invalid_hunk",
        `Expected update hunk to start with a @@ context marker, got: '${lines[0]}'`,
        lineNumber,
      );
    }
    changeContext = undefined;
    startIndex = 0;
  }

  if (startIndex >= lines.length) {
    throw new PatchParseError("invalid_hunk", "Update hunk does not contain any lines", lineNumber + 1);
  }

  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  };

  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new PatchParseError("invalid_hunk", "Update hunk does not contain any lines", lineNumber + 1);
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }

    if (line.length === 0) {
      chunk.oldLines.push("");
      chunk.newLines.push("");
      parsedLines += 1;
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === " ") {
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (prefix === "+") {
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (prefix === "-") {
      chunk.oldLines.push(content);
      parsedLines += 1;
      continue;
    }

    if (parsedLines === 0) {
      throw new PatchParseError(
        "invalid_hunk",
        `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
        lineNumber + 1,
      );
    }

    break;
  }

  return { chunk, consumed: parsedLines + startIndex };
}

function applyHunks(hunks: Hunk[], cwd: string): { affected: AffectedPaths; details: ApplyPatchDetails } {
  if (hunks.length === 0) {
    throwError("No files were modified.");
  }

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const files: ApplyPatchFileDetail[] = [];

  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      const displayPath = hunk.path;
      const absPath = resolveFsPath(displayPath, cwd);
      ensureParentDir(absPath, displayPath);
      writeFileOrThrow(absPath, displayPath, hunk.contents);

      added.push(displayPath);
      files.push({
        path: displayPath,
        status: "added",
        unifiedDiff: buildAddDiff(displayPath, hunk.contents),
      });
      continue;
    }

    if (hunk.kind === "delete") {
      const displayPath = hunk.path;
      const absPath = resolveFsPath(displayPath, cwd);
      const existingContents = readFileOptional(absPath);
      deleteFileOrThrow(absPath, displayPath);

      deleted.push(displayPath);
      files.push({
        path: displayPath,
        status: "deleted",
        unifiedDiff: buildDeleteDiff(displayPath, existingContents),
      });
      continue;
    }

    const displayPath = hunk.path;
    const absPath = resolveFsPath(displayPath, cwd);
    const applied = deriveNewContentsFromChunks(absPath, displayPath, hunk.chunks);
    const destDisplay = hunk.movePath ?? displayPath;
    const destAbsPath = resolveFsPath(destDisplay, cwd);

    if (hunk.movePath) {
      ensureParentDir(destAbsPath, destDisplay);
      writeFileOrThrow(destAbsPath, destDisplay, applied.newContents);
      removeOriginalOrThrow(absPath, displayPath);
    } else {
      writeFileOrThrow(absPath, displayPath, applied.newContents);
    }

    modified.push(destDisplay);
    files.push({
      path: destDisplay,
      status: "modified",
      moveFrom: hunk.movePath ? displayPath : undefined,
      moveTo: hunk.movePath ? destDisplay : undefined,
      unifiedDiff: buildUpdateDiff(
        hunk.movePath ? displayPath : displayPath,
        destDisplay,
        applied.originalLines,
        applied.newLines,
        applied.replacements,
      ),
    });
  }

  return {
    affected: { added, modified, deleted },
    details: { added, modified, deleted, files },
  };
}

function deriveNewContentsFromChunks(
  absPath: string,
  displayPath: string,
  chunks: UpdateFileChunk[],
): AppliedPatch {
  let originalContents: string;
  try {
    originalContents = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    const message = formatReadError("Failed to read file to update", displayPath, err);
    throwError(message);
  }

  const originalLines = originalContents.split("\n");
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop();
  }

  const replacements = computeReplacements(originalLines, displayPath, chunks);
  let newLines = applyReplacements([...originalLines], replacements);
  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines = [...newLines, ""];
  }
  const newContents = newLines.join("\n");

  const newLinesForDiff = newLines.length > 0 && newLines[newLines.length - 1] === ""
    ? newLines.slice(0, -1)
    : newLines;

  return {
    originalContents,
    newContents,
    replacements,
    originalLines,
    newLines: newLinesForDiff,
  };
}

function computeReplacements(originalLines: string[], displayPath: string, chunks: UpdateFileChunk[]): Replacement[] {
  const replacements: Replacement[] = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const ctxIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (ctxIndex === null) {
        throwError(`Failed to find context '${chunk.changeContext}' in ${displayPath}`);
      }
      lineIndex = ctxIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push({ startIndex: insertionIndex, oldLen: 0, newLines: [...chunk.newLines] });
      continue;
    }

    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

    if (found === null && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (found !== null) {
      replacements.push({ startIndex: found, oldLen: pattern.length, newLines: [...newSlice] });
      lineIndex = found + pattern.length;
    } else {
      throwError(`Failed to find expected lines in ${displayPath}:\n${chunk.oldLines.join("\n")}`);
    }
  }

  replacements.sort((a, b) => a.startIndex - b.startIndex);
  return replacements;
}

function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const { startIndex, oldLen, newLines } = replacements[i];
    lines.splice(startIndex, oldLen, ...newLines);
  }
  return lines;
}

function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number | null {
  if (pattern.length === 0) {
    return start;
  }

  if (pattern.length > lines.length) {
    return null;
  }

  const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
  const lastStart = lines.length - pattern.length;

  for (let i = searchStart; i <= lastStart; i += 1) {
    if (arraysEqual(lines, pattern, i)) {
      return i;
    }
  }

  for (let i = searchStart; i <= lastStart; i += 1) {
    let ok = true;
    for (let p = 0; p < pattern.length; p += 1) {
      if (lines[i + p].trimEnd() !== pattern[p].trimEnd()) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  for (let i = searchStart; i <= lastStart; i += 1) {
    let ok = true;
    for (let p = 0; p < pattern.length; p += 1) {
      if (lines[i + p].trim() !== pattern[p].trim()) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  for (let i = searchStart; i <= lastStart; i += 1) {
    let ok = true;
    for (let p = 0; p < pattern.length; p += 1) {
      if (normalizeLine(lines[i + p]) !== normalizeLine(pattern[p])) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  return null;
}

function arraysEqual(lines: string[], pattern: string[], startIndex: number): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    if (lines[startIndex + i] !== pattern[i]) {
      return false;
    }
  }
  return true;
}

function normalizeLine(input: string): string {
  return input
    .trim()
    .split("")
    .map((char) => {
      switch (char) {
        case "\u2010":
        case "\u2011":
        case "\u2012":
        case "\u2013":
        case "\u2014":
        case "\u2015":
        case "\u2212":
          return "-";
        case "\u2018":
        case "\u2019":
        case "\u201A":
        case "\u201B":
          return "'";
        case "\u201C":
        case "\u201D":
        case "\u201E":
        case "\u201F":
          return "\"";
        case "\u00A0":
        case "\u2002":
        case "\u2003":
        case "\u2004":
        case "\u2005":
        case "\u2006":
        case "\u2007":
        case "\u2008":
        case "\u2009":
        case "\u200A":
        case "\u202F":
        case "\u205F":
        case "\u3000":
          return " ";
        default:
          return char;
      }
    })
    .join("");
}

function formatSummary(affected: AffectedPaths): string {
  const lines: string[] = ["Success. Updated the following files:"];
  for (const filePath of affected.added) {
    lines.push(`A ${filePath}`);
  }
  for (const filePath of affected.modified) {
    lines.push(`M ${filePath}`);
  }
  for (const filePath of affected.deleted) {
    lines.push(`D ${filePath}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildAddDiff(displayPath: string, contents: string): string {
  const lines = splitDiffLines(contents);
  const header = [
    `diff --git a/${displayPath} b/${displayPath}`,
    "--- /dev/null",
    `+++ b/${displayPath}`,
  ];
  const hunk = buildSimpleHunk(0, 0, 1, lines.length, [], lines, []);
  return [...header, hunk].join("\n");
}

function buildDeleteDiff(displayPath: string, contents: string): string {
  const lines = splitDiffLines(contents);
  const header = [
    `diff --git a/${displayPath} b/${displayPath}`,
    `--- a/${displayPath}`,
    "+++ /dev/null",
  ];
  const hunk = buildSimpleHunk(1, lines.length, 0, 0, lines, [], []);
  return [...header, hunk].join("\n");
}

function buildUpdateDiff(
  oldPath: string,
  newPath: string,
  originalLines: string[],
  newLines: string[],
  replacements: Replacement[],
): string {
  const header = [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
  ];
  const hunks = buildReplacementHunks(originalLines, newLines, replacements, 1);
  return [...header, ...hunks].join("\n");
}

function buildReplacementHunks(
  originalLines: string[],
  newLines: string[],
  replacements: Replacement[],
  context: number,
): string[] {
  const hunks: string[] = [];
  let delta = 0;

  for (const replacement of replacements) {
    const oldStart = replacement.startIndex;
    const oldEnd = replacement.startIndex + replacement.oldLen;
    const contextStart = Math.max(0, oldStart - context);
    const contextEnd = Math.min(originalLines.length, oldEnd + context);
    const contextBefore = originalLines.slice(contextStart, oldStart);
    const contextAfter = originalLines.slice(oldEnd, contextEnd);
    const newContextStart = contextStart + delta;
    const oldHunkLen = contextBefore.length + replacement.oldLen + contextAfter.length;
    const newHunkLen = contextBefore.length + replacement.newLines.length + contextAfter.length;
    const hunkLines: string[] = [];

    hunkLines.push(`@@ -${contextStart + 1},${oldHunkLen} +${newContextStart + 1},${newHunkLen} @@`);
    for (const line of contextBefore) {
      hunkLines.push(` ${line}`);
    }
    for (const line of originalLines.slice(oldStart, oldEnd)) {
      hunkLines.push(`-${line}`);
    }
    for (const line of replacement.newLines) {
      hunkLines.push(`+${line}`);
    }
    for (const line of contextAfter) {
      hunkLines.push(` ${line}`);
    }

    hunks.push(hunkLines.join("\n"));
    delta += replacement.newLines.length - replacement.oldLen;
  }

  return hunks;
}

function buildSimpleHunk(
  oldStart: number,
  oldLen: number,
  newStart: number,
  newLen: number,
  removed: string[],
  added: string[],
  context: string[],
): string {
  const hunkLines: string[] = [];
  hunkLines.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
  for (const line of context) {
    hunkLines.push(` ${line}`);
  }
  for (const line of removed) {
    hunkLines.push(`-${line}`);
  }
  for (const line of added) {
    hunkLines.push(`+${line}`);
  }
  return hunkLines.join("\n");
}

function splitDiffLines(contents: string): string[] {
  if (contents === "") return [];
  const lines = contents.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function resolveFsPath(displayPath: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedPath = path.isAbsolute(displayPath)
    ? path.normalize(displayPath)
    : path.resolve(resolvedCwd, displayPath);

  if (!isPathWithinRoot(resolvedCwd, resolvedPath)) {
    throwError("patch rejected: writing outside of the project; rejected by user approval settings");
  }

  return resolvedPath;
}

function isPathWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureParentDir(absPath: string, displayPath: string): void {
  const parent = path.dirname(absPath);
  if (!parent || parent === "." || parent === absPath) {
    return;
  }
  if (!fs.existsSync(parent)) {
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch (err) {
      const message = formatIoError("Failed to create parent directories for", displayPath, err);
      throwError(message);
    }
  }
}

function writeFileOrThrow(absPath: string, displayPath: string, contents: string): void {
  try {
    fs.writeFileSync(absPath, contents);
  } catch (err) {
    const message = formatIoError("Failed to write file", displayPath, err);
    throwError(message);
  }
}

function deleteFileOrThrow(absPath: string, displayPath: string): void {
  try {
    fs.rmSync(absPath);
  } catch {
    throwError(`Failed to delete file ${displayPath}`);
  }
}

function removeOriginalOrThrow(absPath: string, displayPath: string): void {
  try {
    fs.rmSync(absPath);
  } catch (err) {
    const message = formatIoError("Failed to remove original", displayPath, err);
    throwError(message);
  }
}

function readFileOptional(absPath: string): string {
  try {
    return fs.readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }
}

function formatReadError(prefix: string, displayPath: string, err: unknown): string {
  const osMessage = formatOsError(err);
  return `${prefix} ${displayPath}: ${osMessage}`;
}

function formatIoError(prefix: string, displayPath: string, err: unknown): string {
  const osMessage = formatOsError(err);
  return `${prefix} ${displayPath}: ${osMessage}`;
}

function formatOsError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as NodeJS.ErrnoException).code);
    if (code === "ENOENT") {
      return "No such file or directory (os error 2)";
    }
    if (code === "EACCES") {
      return "Permission denied (os error 13)";
    }
    if (code === "EISDIR") {
      return "Is a directory (os error 21)";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function throwError(message: string): never {
  throw new Error(`${message}\n`);
}
