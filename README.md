# Paperdesk

Local LaTeX editor with a PDF preview and Codex.

Double-click **Start Paperdesk.command**, or run:

```sh
npm install --include=dev
npm run build
npm start
```

Open http://localhost:4317.

1. Click **Choose directory** to open the native macOS folder picker, then choose a folder in `Fall 26:27`.
2. Select a `.tex` file from the toolbar. It opens on the left and compiles on the right.
3. Use the Codex panel for edits, questions, or larger tasks. To convert a PDF, attach it and ask Codex to convert it. You can also name the PDF in your request. A directory with only a PDF needs no setup first.
4. Codex saves its output, selects the resulting `.tex` file, and compiles it automatically. The editor pauses during a Codex request to prevent conflicting edits.

Drag over PDF text to select it and use ⌘/Ctrl C to copy. Double-click a location on the compiled PDF to jump to and select the corresponding LaTeX line (SyncTeX inverse search). Included `.tex` files open in the editor while the main file remains the compilation target. Recompile once after upgrading to create the source map. Stale previews must finish compiling before source navigation; mapping is to the nearest source line or paragraph, not an exact character.

Edits autosave. Compilation runs automatically after saving; **Compile** also runs it manually (⌘/Ctrl Enter). A failed build preserves the previous PDF. Use the file selector to change the primary file. The directory and primary file are remembered on reload.

**More → History** restores earlier saves. **More → Writing style** edits your profile or proposes notes from your saved edits. Human edits automatically become examples for future requests; AI changes and restores are excluded. This is prompt memory, not model training. You can clear the examples and profile.

Documents remain in the selected directory. App data is in `.data/`; recovery snapshots are in each document folder's `.paperdesk/history/` (80 versions per folder). Unsaved drafts are retained in browser storage. External file changes trigger a save conflict rather than an overwrite.

The app uses the local Codex CLI login. AI requests send document context, the writing profile, recent examples, and any attached PDF to Codex's configured provider. PDF conversion uses extracted text and rendered pages (24 pages maximum). Check unclear math and diagrams against the original. Codex returns one LaTeX document per request; it does not run arbitrary filesystem operations from chat.

Node 22+, Codex, Tectonic, and Poppler (`pdftotext`, `pdftoppm`, `pdfinfo`) must be on PATH. They are installed on this Mac. Tectonic can download packages on the first build. The server is loopback-only and restricts files to the workspace. It is intended for personal local use.

Configuration: `WORKSPACE_ROOT` defaults to this repo's parent; `PORT` defaults to `4317`; `CODEX_BIN` defaults to `codex`; `PAPERDESK_DATA_DIR` defaults to `.data`. Run `npm run dev` for development.

The reusable skill is `.agents/skills/paperdesk/SKILL.md`. The CLI integration uses [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/).

Validation:

```sh
npm test
npm run build
npm run test:browser
npm run test:ai # Uses your Codex account
```

Browser tests use temporary directories and render real compiled PDFs with PDF.js. `CHROME_BIN` overrides the Chrome executable for tests.
