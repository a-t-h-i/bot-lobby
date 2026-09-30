#!/bin/sh
# Stop the DSH Web process group that start-web.sh started.
# Never stop DSH with `pkill -f`: the pattern also matches the shell running it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
: "${DSH_HOME:=$repo/.dsh-home}"
pidfile="$DSH_HOME/web.pid"
if [ ! -f "$pidfile" ]; then
  echo "DSH web is not running (no $pidfile)"
  exit 0
fi
pid=$(cat "$pidfile")
kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
rm -f "$pidfile"
echo "stopped DSH web ($pid)"
