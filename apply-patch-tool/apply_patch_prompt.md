## `apply_patch`

Use the `apply_patch` tool to create, edit, rename, and delete files.
Pass the whole patch as the tool's `input` string. Do not call `apply_patch` through `bash` or a shell command.

The patch language is a stripped-down, file-oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high-level envelope:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Within that envelope, you get a sequence of file operations.
You MUST include a header to specify the action you are taking.
Each operation starts with one of three headers:

*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).
*** Delete File: <path> - remove an existing file. Nothing follows.
*** Update File: <path> - patch an existing file in place (optionally with a rename).

May be immediately followed by *** Move to: <new path> if you want to rename the file.
Then one or more hunks, each introduced by `@@` optionally followed by a hunk header.
Within a hunk each line starts with:

- space (` `) for unchanged context
- `-` for lines to remove
- `+` for lines to add

For editing existing files:
- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change’s [context_after] lines in the second change’s [context_before] lines.
- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:
@@ class BaseClass
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

- If a code block is repeated so many times in a class or function such that even a single `@@` statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple `@@` statements to jump to the right context. For instance:

@@ class BaseClass
@@ 	 def method():
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]

The full grammar definition is below:
Patch := Begin { FileOp } End
Begin := "*** Begin Patch" NEWLINE
End := "*** End Patch" NEWLINE
FileOp := AddFile | DeleteFile | UpdateFile
AddFile := "*** Add File: " path NEWLINE { "+" line NEWLINE }
DeleteFile := "*** Delete File: " path NEWLINE
UpdateFile := "*** Update File: " path NEWLINE [ MoveTo ] { Hunk }
MoveTo := "*** Move to: " newPath NEWLINE
Hunk := "@@" [ header ] NEWLINE { HunkLine } [ "*** End of File" NEWLINE ]
HunkLine := (" " | "-" | "+") text NEWLINE

Create a new file:

*** Begin Patch
*** Add File: src/hello.txt
+export function hello() {
+  return "Hello, world!";
+}
*** End Patch

Edit an existing file:

*** Begin Patch
*** Update File: src/app.ts
@@
 function greet() {
-  return "Hi";
+  return "Hello, world!";
 }
*** End Patch

Rename and edit a file:

*** Begin Patch
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** End Patch

Delete a file:

*** Begin Patch
*** Delete File: obsolete.txt
*** End Patch

A full patch can combine several operations:

*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch

It is important to remember:

- You must include a header with your intended action (Add/Delete/Update).
- For `*** Add File`, every content line must start with `+`.
- For `*** Update File`, include enough unchanged context lines (space-prefixed) to uniquely identify the edit.
- File references can only be relative, NEVER absolute.
- Prefer `apply_patch` for normal file edits. Use other tools only when generated output or bulk scripted changes are more appropriate.

Invoke it as a tool call with an `input` field containing the patch text.
