#!/bin/sh
# KEEP THE XCODE PROJECT EQUAL TO THE SOURCES.
#
# The project file is generated from project.yml, but it was also committed and
# then edited by hand in Xcode, so the two drifted: the committed project said
# CURRENT_PROJECT_VERSION = 1 while project.yml said 2. Whichever one you happened
# to open decided what the official app built as.
#
# Regenerating was never automated for one reason: the signing team had been
# picked in Xcode and stored nowhere else, so `xcodegen generate` threw it away
# and the next build would not sign. The team is in project.yml now, so this is
# safe to run on every commit, and XcodeGen is idempotent — running it twice in a
# row changes nothing, so a commit that touches no native file produces no diff.
#
#   scripts/ios-sync.sh            regenerate, bump the build number, verify
#   scripts/ios-sync.sh --no-bump  regenerate and verify only (CI)
#   scripts/ios-sync.sh --check    fail if the project is out of date; change nothing
set -e
cd "$(dirname "$0")/.."
DIR=ios-broadcast
PROJ="$DIR/WatchListParty.xcodeproj/project.pbxproj"
MODE="${1:-}"

if ! command -v xcodegen >/dev/null 2>&1; then
  # Not fatal on a machine without it: say so and leave the committed project alone,
  # rather than failing a commit that has nothing to do with the app.
  echo "ios-sync: xcodegen not installed (brew install xcodegen) — skipping" >&2
  exit 0
fi

# ── the build number ────────────────────────────────────────────────────────
# One per commit that touches the app. App Store Connect rejects a second upload
# with a build number it has already seen, and remembering to bump by hand is the
# step that gets skipped at 2am.
if [ "$MODE" != "--no-bump" ] && [ "$MODE" != "--check" ]; then
  CUR=$(sed -n 's/^ *CURRENT_PROJECT_VERSION: *"\{0,1\}\([0-9]*\)"\{0,1\} *$/\1/p' "$DIR/project.yml" | head -1)
  if [ -n "$CUR" ]; then
    NEXT=$((CUR + 1))
    sed -i '' "s/^\( *CURRENT_PROJECT_VERSION: \).*/\1\"$NEXT\"/" "$DIR/project.yml"
    echo "ios-sync: build $CUR -> $NEXT"
  fi
fi

BEFORE=$(shasum -a 256 "$PROJ" 2>/dev/null | cut -d' ' -f1)
( cd "$DIR" && xcodegen generate --quiet )
AFTER=$(shasum -a 256 "$PROJ" | cut -d' ' -f1)

# The team has to survive. If it ever does not, the next build fails to sign on a
# device and the reason is three steps back — so fail here, loudly, instead.
grep -q 'DEVELOPMENT_TEAM = [A-Z0-9]' "$PROJ" || {
  echo "ios-sync: FAILED — the generated project has no signing team" >&2; exit 1; }

if [ "$MODE" = "--check" ]; then
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "ios-sync: the Xcode project is out of date — run scripts/ios-sync.sh" >&2
    exit 1
  fi
  echo "ios-sync: project is in sync"
fi
