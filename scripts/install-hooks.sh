#!/bin/sh
# .git/hooks is not part of the repository, so every generated-file rule this
# project depends on — friends.html, the service-worker cache stamp, the Xcode
# project — silently stops applying on a fresh clone. This puts them back.
#   sh scripts/install-hooks.sh
set -e
cd "$(dirname "$0")/.."
cp scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
cp scripts/hooks/commit-msg .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
echo "installed: .git/hooks/pre-commit, .git/hooks/commit-msg"
