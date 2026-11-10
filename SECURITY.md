# Security

Paperdesk is a single-user app that runs on your own machine:

- The server listens on `127.0.0.1` only, rejects cross-origin requests, and restricts file access to the folders of your projects.
- The agent runs in a scratch folder and can read your files and run commands, but cannot modify them: Codex runs in its `workspace-write` sandbox, and Claude Code runs without file-editing tools and with its shell sandbox denying writes to your project. The app saves the agent's LaTeX with revision checks.
- LaTeX builds use TeX Live's default restricted shell escape. `latexmk` runs any `latexmkrc` in a document's folder, so only compile folders you trust.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/michael-L-i/paperdesk/security/advisories/new), not in public issues. Include steps to reproduce, and expect a reply within a week.
