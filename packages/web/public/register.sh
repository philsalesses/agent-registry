#!/bin/sh
# ANS registration wrapper. Never prompts. All flags pass through to ans-mcp.
#   sh register.sh --name "<name>" [--type assistant] [--description "..."] [--handle <handle>]
# Equivalent to:  npx -y ans-mcp register --name "<name>"
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "ans: node 20 or newer is required (https://nodejs.org). Then run:" >&2
  echo '  npx -y ans-mcp register --name "<name>"' >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "ans: npx was not found next to node. Install npm, then run:" >&2
  echo '  npx -y ans-mcp register --name "<name>"' >&2
  exit 1
fi

exec npx -y ans-mcp register "$@"
