#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if command -v node >/dev/null 2>&1; then
  exec node "$project_root/scripts/build.mjs"
fi
for node_bin in "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node" "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"; do
  if [[ -x "$node_bin" ]]; then exec "$node_bin" "$project_root/scripts/build.mjs"; fi
done
echo "Node.js is required to build the site." >&2
exit 1
