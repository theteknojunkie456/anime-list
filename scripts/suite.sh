#!/bin/sh
# Run every browser test and report one line each.
#   sh scripts/suite.sh            run once
#   sh scripts/suite.sh --twice    run twice without clearing browser profiles,
#                                  which is how an order-dependent test is caught:
#                                  it passes, then fails against the state it
#                                  just wrote. A suite that only tells the truth
#                                  the first time is worse than no suite.
cd "$(dirname "$0")/.."
# Each test spawns a throwaway web server and a headless Chrome and kills both on
# the way out — unless it crashes, in which case they outlive it, hold the port,
# and the NEXT test to want that port dies on "address already in use". One
# crashed test took twenty-five healthy ones down with it that way, and the
# report blamed the app. Sweep before starting and after each file, so a crash
# costs exactly one result.
sweep(){ pkill -f 'remote-debugging-port=9' 2>/dev/null; pkill -f 'python3 -m http.server' 2>/dev/null; sleep 1; }
sweep
trap sweep EXIT INT TERM

PASS=0; FAIL=0; FAILED=""
for f in scripts/*-test.mjs scripts/*.test.mjs; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .mjs)
  # Judge by exit status, not by parsing the summary line. Four suites print
  # their result in a different shape and the first version of this called all
  # four of them broken, which is a worse failure than the one it was looking for.
  log=$(node "$f" 2>&1); rc=$?
  sweep
  out=$(printf '%s' "$log" | grep -Eo '[0-9]+ passed(, [0-9]+ failed)?' | tail -1)
  [ -z "$out" ] && out=$(printf '%s' "$log" | tail -1 | cut -c1-60)
  if [ $rc -eq 0 ]; then PASS=$((PASS+1)); printf '  ok   %-28s %s\n' "$n" "$out"
  else FAIL=$((FAIL+1)); FAILED="$FAILED $n"
       printf '  FAIL %-28s %s\n' "$n" "$out"
       printf '%s' "$log" | grep -E '^FAIL' | sed 's/^/         /'
  fi
done
echo "---- $PASS ok, $FAIL failing${FAILED:+ ·$FAILED}"
