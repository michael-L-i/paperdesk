#!/bin/zsh
# Double-click to open Paperdesk. The first time, this sets it up to run in the background,
# so it keeps working after this window closes and starts again when you log in.
cd "${0:A:h}"
# Finder-launched terminals may not have the same PATH as your development shell.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/Library/TeX/texbin:$PATH"
command -v node >/dev/null 2>&1 || { [[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh"; }
if ! command -v node >/dev/null 2>&1; then
  echo "Paperdesk needs Node.js 22 or newer. Install it from https://nodejs.org, then try again."
  read -k1 "?Press any key to close."; exit 1
fi
node bin/paperdesk.js install || read -k1 "?Press any key to close."
