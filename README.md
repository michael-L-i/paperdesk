# Paperdesk

[![CI](https://github.com/michael-L-i/paperdesk/actions/workflows/ci.yml/badge.svg)](https://github.com/michael-L-i/paperdesk/actions/workflows/ci.yml)

**A local LaTeX editor with a live PDF preview and an AI agent that can read your whole project.**

Write LaTeX on the left and see the PDF on the right. Ask the agent to explain a problem set, convert a PDF to LaTeX, or edit your document. The agent is the [Codex](https://github.com/openai/codex) or [Claude Code](https://github.com/anthropics/claude-code) CLI you already use. Everything runs on your machine, with your own TeX install and your own agent login.

![Paperdesk showing LaTeX source, a chat with the agent, and the compiled PDF](docs/screenshot.png)

## Features

- **Live preview.** Edits autosave and compile when you pause typing. The PDF updates without losing your scroll position.
- **Any engine.** Builds use `latexmk` with pdfLaTeX, XeLaTeX, or LuaLaTeX, picked per document. BibTeX, biber, and reruns happen automatically.
- **SyncTeX.** Double-click the PDF to jump to the matching source line.
- **An agent that sees your folder.** It reads PDFs, notes, and code itself, knows which PDF is built from which `.tex`, and remembers the conversation.
- **Safe edits.** The agent can read your files but not modify them. Paperdesk applies the agent's edits all at once, with revision checks and history snapshots.
- **A readable chat.** Replies render Markdown and KaTeX math. Attach files with the paperclip, paste, or drag and drop; they are copied into your project.
- **Your writing style.** Your own edits become examples the agent follows. This is prompt memory, not model training.
- **Your folders stay yours.** Builds happen in a temp folder, and history lives in Paperdesk's own data folder. A project folder gains only the PDF.

## Install

Paperdesk runs on macOS with [Node](https://nodejs.org) 22 or newer.

```sh
npx paperdesk
```

This starts Paperdesk and opens http://localhost:4317. The first time, **Settings** shows what else it needs and the command to install each piece:

| Needed for | Install |
|---|---|
| Compiling | TeX with `latexmk`: `brew install --cask mactex-no-gui` |
| Letting the agent read PDFs | `brew install poppler` |
| The agent (optional) | `npm install -g @openai/codex` or `npm install -g @anthropic-ai/claude-code`, then run it once to sign in |

The editor, preview, and SyncTeX work without an agent. With both agents installed, choose one, and optionally a model, in **Settings**.

### Keep it running

`npx paperdesk` runs until you close its terminal. To run Paperdesk in the background instead, starting at login and restarting if it ever stops:

```sh
npm install -g paperdesk
paperdesk install      # paperdesk uninstall removes it
```

### From source

```sh
git clone https://github.com/michael-L-i/paperdesk.git
cd paperdesk
npm install
npm start
```

Or double-click **Start Paperdesk.command**, which sets up the background service from that folder and opens the app.

## Projects

Click **New project**, then:

- **Blank project** creates a folder in your Paperdesk library (`~/Documents/Paperdesk`, changeable in Settings).
- **Open folder…** links a folder you already have, such as one with a `.tex` file or just a PDF you want converted.

Paperdesk only reads and writes inside your projects' folders. Removing a linked project only takes it off the list. Deleting a library project moves its folder to the Trash. If you move or rename a folder, its project shows **Folder missing · Locate…**; pointing one project at its new place also fixes the others that moved with it.

The file tree shows documents: LaTeX and text files, images, and PDFs. Code, data, and anything else in the folder is one click away under **Show other files**.

## Usage

| To | Do this |
|---|---|
| Compile now | Click **Compile**, or press ⌘/Ctrl Enter outside the chat |
| Turn auto-compile on or off | **More → Auto-compile** |
| Jump from the PDF to the source | Double-click the PDF |
| Force an engine | Put `% !TEX program = xelatex` (or `pdflatex`, `lualatex`) at the top of the file |
| Change the main document | Click the star next to a `.tex` file in **Files** |
| Add images or other files | Drag them onto **Files**, or click the upload button |
| Preview, download, rename, or delete an image | Click it in **Files** (PDFs preview too; deleted files go to the Trash) |
| Send a chat message / add a line | Enter / Shift Enter |
| Stop the agent | Click the stop button that replaces send while it works |
| Restore an earlier save | **More → History** |
| Remove `.aux`, `.log`, and other build files left by other tools | **More → Clean up build files** (they go to the Trash) |
| Start a fresh conversation | Click **New chat** in the Agent bar |
| Choose the agent, model, or library folder | **More → Settings**, or the gear on the projects page |
| Edit your writing profile | **More → Writing style** |

The main document is the file that compiles and appears in the PDF pane. Opening a `.tex` file with `\documentclass` makes it the main document. Opening a chapter, a `.bib`, or another fragment keeps the current one. A `% !TEX root = ../main.tex` line in a fragment names its main document.

Without a magic comment, Paperdesk picks the engine from the preamble:

- `fontspec`, `unicode-math`, `polyglossia`, or `\setmainfont` → XeLaTeX
- `luacode` or `\directlua` → LuaLaTeX
- anything else → pdfLaTeX

If the log shows the document needs a different engine, the build retries once with it. A failed build keeps the previous PDF and shows the first TeX error. Unsaved drafts survive a reload. Open tabs sync saved source changes and completed previews from disk every 1.5 seconds and when focused. Changes from another tab or an external editor automatically reload a clean editor and rebuild outdated previews when auto-compile is enabled. If you have an unsaved draft, it is preserved and a conflict warning prevents an overwrite.

## How the agent works

Each request runs your agent's CLI in a scratch folder, where it can read your project and run commands such as `pdftotext`, `pdftoppm`, and `latexmk`, but can't modify your files:

- **Codex** runs `codex exec` with the `workspace-write` sandbox, which allows writes only in the scratch folder.
- **Claude Code** runs `claude -p` with no file-editing tools, and its shell commands run in Claude Code's sandbox with writes to your project denied.

The agent returns a message, plus the complete new contents of each file it changes, such as a chapter and `refs.bib`. Paperdesk checks every file for changes made while the agent worked, then saves them all with history snapshots, or saves none. The agent's standing instructions are in [`.agents/skills/paperdesk/SKILL.md`](.agents/skills/paperdesk/SKILL.md).

Each request sends the open document, the conversation, your writing profile, and any files the agent reads to your agent's provider.

## Configuration

Settings in the app cover the agent, model, and library folder. Environment variables override them:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4317` | Server port (listens on 127.0.0.1 only) |
| `PAPERDESK_AGENT` | first one installed | `codex` or `claude` |
| `PAPERDESK_LIBRARY` | `~/Documents/Paperdesk` | Where new projects are created |
| `PAPERDESK_DATA_DIR` | `~/Library/Application Support/Paperdesk` | Project list, settings, writing profile, save history, and the service log |
| `CODEX_BIN`, `CLAUDE_BIN` | `codex`, `claude` | The agent executables |

`paperdesk install` records the variables set when you run it, including `PATH`, so the background service finds the same TeX and agent commands as your terminal. Run it again after changing them.

Paperdesk keeps the last 200 saved versions of each project's files.

## Development

```sh
npm run dev            # UI served through Vite; restart after server changes
npm test               # unit tests (need TeX Live and Poppler)
npm run test:browser   # end-to-end tests in Chrome (set CHROME_BIN to override)
npm run test:ai        # live check with your Codex account; add `-- claude` for Claude Code
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
