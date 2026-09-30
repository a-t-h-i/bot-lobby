#!/bin/sh
# Start DSH Web for plugin development, detached in its own process group, and
# print the tokenized URL once it is up. Stop it with stop-web.sh.
#
# Meant to live at scripts/dsh/ in the plugin repo. Optional environment:
#   DSH_HOME       profiles, storages, logs; also web.pid and web.log  (default: <repo>/.dsh-home)
#   DSH_PORT       port                                                (default: 4817)
#   DSH_WORKSPACE  the directory DSH starts in, its default workspace  (default: <repo>)
#   DSH_BIN        the dsh CLI entry          (default: <repo>/node_modules/@deepseek-ai/dsh/lib/bin.js)
#
# Adapted from the commands that verified the probe plugin in DSH 0.2.0-rc.2:
#   DSH_HOME=$PWD/home setsid node node_modules/@deepseek-ai/dsh/lib/bin.js \
#     web --no-open --port 4817 --host 127.0.0.1 > web.log 2>&1 < /dev/null &
# Running the CLI entry directly (not through npx) keeps the port owned by the
# process we record. `setsid` is from util-linux; on macOS use `nohup` instead
# and stop the recorded pid alone.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
: "${DSH_HOME:=$repo/.dsh-home}"
: "${DSH_PORT:=4817}"
: "${DSH_WORKSPACE:=$repo}"
: "${DSH_BIN:=$repo/node_modules/@deepseek-ai/dsh/lib/bin.js}"
export DSH_HOME
mkdir -p "$DSH_HOME"
pidfile="$DSH_HOME/web.pid"
log="$DSH_HOME/web.log"

if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  echo "DSH web already runs (pid $(cat "$pidfile")); stop it with stop-web.sh" >&2
  exit 1
fi

# DSH treats the directory it starts in as the default workspace root.
cd "$DSH_WORKSPACE"
setsid node "$DSH_BIN" web --no-open --port "$DSH_PORT" --host 127.0.0.1 > "$log" 2>&1 < /dev/null &
echo $! > "$pidfile"

i=0
while [ "$i" -lt 120 ]; do
  url=$(grep -oE "http://127\.0\.0\.1:$DSH_PORT/\?token=[A-Za-z0-9_-]+" "$log" | head -n 1 || true)
  if [ -n "$url" ]; then
    echo "$url"
    exit 0
  fi
  if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "DSH web exited before it printed its URL; the end of $log:" >&2
    tail -n 20 "$log" >&2
    rm -f "$pidfile"
    exit 1
  fi
  sleep 1
  i=$((i + 1))
done
echo "DSH web printed no URL in 120 s; see $log" >&2
exit 1
