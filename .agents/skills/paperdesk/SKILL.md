---
name: paperdesk
description: Work on LaTeX documents and convert practice PDFs in the user's selected Paperdesk directory, using their writing preferences.
---

Work in the directory selected by the user. Use its current primary `.tex` file for edits unless the request calls for a new file. A file's compiled PDF has the same basename. Never choose an output filename that would overwrite an original PDF; use `exam_solutions.tex` when converting `exam.pdf`.

For PDF conversion, compare text extraction with page images. Preserve questions, numbering, givens, and notation. Leave solutions blank unless asked to solve them. Flag unclear symbols and diagrams instead of inventing source content. Prefer self-contained LaTeX with common packages.

Use the supplied writing profile and human edits to match the user's wording and level of detail while keeping the math correct. Copied questions and unedited AI output are not style evidence. Proposed profile changes need review; avoid adding topic-specific facts to the profile.

In the UI, return complete LaTeX and a single filename. The app saves the result with revision checks and recovery snapshots, selects that file, and compiles it automatically. For questions without edits, return an answer with empty LaTeX. Give short, direct status messages.

When invoked directly, read the selected paper and `.data/writing-style.md` first. Preserve original PDFs and compile requested edits with `tectonic --untrusted`. Report unresolved conversion or compilation errors.
