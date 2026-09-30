# Contributing

Thanks for helping improve Paperdesk! Bug reports, fixes, and small focused features are all welcome. For anything large, open an issue first so we can agree on the approach.

## Setup

You need macOS, Node 22+, TeX Live, Poppler, and (for the agent) the Codex CLI. See [Requirements](README.md#requirements).

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
| `server/index.js` | Express API: files, compile, SyncTeX, agent jobs |
| `server/latex.js` | Engine detection and `latexmk` builds |
| `server/ai.js` | Prompt and Codex CLI invocation |
| `server/projects.js` | The project list and the Paperdesk library |
| `server/workspace.js` | Path safety, saves, and history snapshots |
| `server/uploads.js`, `server/synctex.js` | Attachments and PDF-to-source mapping |
| `src/main.jsx`, `src/PdfPreview.jsx` | React UI and the PDF.js preview |
| `tests/` | Unit tests (`*.test.js`) and browser/live checks (`*.mjs`) |

## Checks

Run these before opening a pull request:

```sh
npm test              # unit tests (need TeX Live and Poppler)
npm run build
npm run test:browser  # end-to-end in Chrome; set CHROME_BIN if needed
```

`npm run test:ai` makes a real request with your Codex account. Run it when you change the prompt or `server/ai.js`.

## Style

- Match the surrounding code. It is compact, and comments explain *why*, not *what*.
- Keep the UI simple and quiet. Include a screenshot for visual changes.
- Avoid new dependencies unless they clearly pay for themselves.
- Add or update a test for behavior changes.
- Write small commits with imperative subjects, such as "Fix stale preview after rename".

Be kind and constructive in issues and reviews.
