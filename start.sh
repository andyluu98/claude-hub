#!/bin/sh
# Claude Hub launcher (macOS / Linux)
cd "$(dirname "$0")"
node server.js &
SERVER_PID=$!
sleep 1
case "$(uname -s)" in
  Darwin) open "http://localhost:8765" ;;
  Linux)  xdg-open "http://localhost:8765" >/dev/null 2>&1 ;;
esac
wait $SERVER_PID
