#!/usr/bin/env bash
# PostToolUse hook: lint a CloudFormation/SAM template right after it is edited.
#
# CLAUDE.md states "run sam validate --lint after any template change". A hook
# enforces that instead of relying on remembering it -- a broken template
# otherwise surfaces minutes later as an opaque deploy rollback.
#
# Reads the hook payload on stdin, exits 0 for anything that is not a template.
# On a validation failure it feeds the error back to the model as additional
# context rather than blocking, so the edit stands and the fix is informed.

set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

case "$file" in
  *template.yaml|*template.yml) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

sam=$(command -v sam || echo /opt/homebrew/bin/sam)
[ -x "$sam" ] || exit 0

if out=$("$sam" validate --lint --template "$file" --region ap-southeast-1 2>&1); then
  exit 0
fi

# jq -Rs safely JSON-encodes multi-line CLI output.
printf '%s' "$out" | jq -Rs --arg f "$file" '{
  systemMessage: ("sam validate --lint failed on \($f)"),
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("sam validate --lint failed on \($f):\n" + .)
  }
}'
exit 0
