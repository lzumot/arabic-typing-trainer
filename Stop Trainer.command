#!/bin/zsh
# Double-click to stop the local trainer server.

PIDS=$(lsof -ti tcp:8765 -sTCP:LISTEN 2>/dev/null)
if [[ -z "$PIDS" ]]; then
  osascript -e 'display dialog "The trainer is not running." buttons {"OK"}'
  exit 0
fi
echo "$PIDS" | xargs kill
sleep 0.5
if lsof -ti tcp:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  osascript -e 'display dialog "The trainer did not stop." buttons {"OK"}'
  exit 1
fi
osascript -e 'display dialog "Trainer stopped." buttons {"OK"}'
