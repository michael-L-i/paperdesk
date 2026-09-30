#!/bin/zsh
set -e
cd "${0:A:h}"
# Finder-launched terminals may not have the same PATH as your development shell.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/Library/TeX/texbin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    source "$HOME/.nvm/nvm.sh"
  fi
fi
if curl -fsS "http://127.0.0.1:${PORT:-4317}/api/projects" >/dev/null 2>&1; then
  open "http://localhost:${PORT:-4317}"
  exit 0
fi
if [[ ! -d node_modules ]]; then npm install --include=dev; fi
npm run build
(sleep 2; open "http://localhost:${PORT:-4317}") &
npm start
