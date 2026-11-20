#!/bin/zsh
# Double-click this file to open the trainer. It starts the local server,
# then opens the app in the browser. There is no other setup step.

cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://127.0.0.1:$PORT/"
LOG="$(pwd)/data/server.log"

mkdir -p data

if ! curl -s -o /dev/null --max-time 1 "${URL}api/health"; then
  if ! command -v python3 >/dev/null 2>&1; then
    osascript -e 'display dialog "python3 was not found. Install the Xcode command line tools first." buttons {"OK"}'
    exit 1
  fi
  nohup python3 server.py >>"$LOG" 2>&1 &
  for i in {1..60}; do
    if curl -s -o /dev/null --max-time 1 "${URL}api/health"; then
      break
    fi
    sleep 0.25
  done
fi

if curl -s -o /dev/null --max-time 1 "${URL}api/health"; then
  open "$URL"
else
  osascript -e "display dialog \"The trainer could not start. See data/server.log\" buttons {\"OK\"}"
fi
