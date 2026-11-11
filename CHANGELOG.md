# Changelog

## 0.2.0

### Added
- `paperdesk` command: `paperdesk` starts the app, and `paperdesk install` runs it in the background, starting at login and restarting if it stops.
- Claude Code as an agent beside Codex, chosen in Settings.
- Settings, with checks for LaTeX, Poppler, and the agent CLIs, and the command to install whatever is missing. It opens on first run when something is missing.
- **Locate…** for projects whose folder moved; projects that moved with the same parent folder follow.
- **Clean up build files**, which moves `.aux`, `.log`, and similar files beside a `.tex` source to the Trash.
- Compile logs with errors and warnings shown in the editor gutter.
- Open tabs follow changes made on disk or in another tab.
- The agent conversation survives reloads; **New chat** clears it.

### Changed
- The file tree shows documents by default; other files are under **Show other files**.
- App data moved from `.data/` in the source folder to `~/Library/Application Support/Paperdesk`. Existing data is copied on first start.
- Save history and PDF source maps moved from `.paperdesk/` folders inside projects into app data. Old folders move over when a project is opened.
- The editor works without an agent installed.

## 0.1.0

First public version: live PDF preview, SyncTeX, a projects screen, and a Codex-powered agent.
