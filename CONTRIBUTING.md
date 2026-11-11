# Contributing

Thanks for helping improve Paperdesk! Bug reports, fixes, and small focused features are all welcome. For anything large, open an issue first so we can agree on the approach.

## Setup

You need macOS, Node 22+, TeX Live, Poppler, and (for the agent) the Codex or Claude Code CLI. See [Install](README.md#install).

```sh
git clone https://github.com/michael-L-i/paperdesk.git
cd paperdesk
npm install
npm run dev
```

Open http://localhost:4317. `npm run dev` serves the UI through Vite; restart it after changing files in `server/`.

## Project layout

| Path | What it does |
|---|---|
| `bin/paperdesk.js` | The `paperdesk` command: start, and the background service |
| `server/index.js` | Express API: projects, files, settings, agent jobs |
| `server/build.js`, `server/latex.js` | Compiling with `latexmk`, engine detection, and PDF-to-source lookup |
| `server/ai.js`, `server/agents.js` | The prompt, and one adapter per agent CLI |
| `server/config.js`, `server/setup.js` | Data folder and port; checks for TeX, Poppler, and agents |
| `server/projects.js` | The project list and the Paperdesk library |
| `server/workspace.js` | Path safety, saves, and history snapshots |
| `server/synctex.js` | PDF-to-source mapping |
| `src/Home.jsx`, `src/Editor.jsx` | The projects screen and the editor |
| `src/FileTree.jsx`, `src/Logs.jsx`, `src/Settings.jsx`, `src/PdfPreview.jsx` | File tree, compile logs, settings, and the PDF.js preview |
| `tests/` | Unit tests (`*.test.js`) and browser/live checks (`*.mjs`) |

## Checks

Run these before opening a pull request:

```sh
npm test              # unit tests (need TeX Live and Poppler)
npm run build
npm run test:browser  # end-to-end in Chrome; set CHROME_BIN if needed
```

`npm run test:ai` makes a real request with your Codex account (`npm run test:ai -- claude` for Claude Code). Run it when you change the prompt, `server/ai.js`, or `server/agents.js`.

`npm run dev` uses your real data folder; set `PAPERDESK_DATA_DIR` to try things on a scratch copy.

## Style

- Match the surrounding code. It is compact, and comments explain *why*, not *what*.
- Keep the UI simple and quiet. Include a screenshot for visual changes.
- Avoid new dependencies unless they clearly pay for themselves.
- Add or update a test for behavior changes.
- Write small commits with imperative subjects, such as "Fix stale preview after rename".

Be kind and constructive in issues and reviews; see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releases

Bump `version` in `package.json`, add a section to [CHANGELOG.md](CHANGELOG.md), and publish a GitHub release. The Release workflow publishes that version to npm.
