#!/bin/sh
# Run every browser test and report one line each.
#   sh scripts/suite.sh            run once
#   sh scripts/suite.sh --twice    run twice without clearing browser profiles,
#                                  which is how an order-dependent test is caught:
#                                  it passes, then fails against the state it
#                                  just wrote. A suite that only tells the truth
#                                  the first time is worse than no suite.
cd "$(dirname "$0")/.."
PASS=0; FAIL=0; FAILED=""
for f in scripts/*-test.mjs scripts/*.test.mjs; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .mjs)
  # Judge by exit status, not by parsing the summary line. Four suites print
  # their result in a different shape and the first version of this called all
  # four of them broken, which is a worse failure than the one it was looking for.
  log=$(node "$f" 2>&1); rc=$?
  out=$(printf '%s' "$log" | grep -Eo '[0-9]+ passed(, [0-9]+ failed)?' | tail -1)
  [ -z "$out" ] && out=$(printf '%s' "$log" | tail -1 | cut -c1-60)
  if [ $rc -eq 0 ]; then PASS=$((PASS+1)); printf '  ok   %-28s %s\n' "$n" "$out"
  else FAIL=$((FAIL+1)); FAILED="$FAILED $n"
       printf '  FAIL %-28s %s\n' "$n" "$out"
       printf '%s' "$log" | grep -E '^FAIL' | sed 's/^/         /'
  fi
done
echo "---- $PASS ok, $FAIL failing${FAILED:+ ·$FAILED}"
