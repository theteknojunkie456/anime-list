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
# The pattern has to match the COMMAND LINE as it actually appears. These show up
# as "…/Python -m http.server 8995" — the interpreter resolves to its real path,
# so a pattern of 'python3 -m http.server' matched nothing and the sweep quietly
# swept nothing. Two suites kept failing on a port that was never released.
# Killing Chrome leaves a SingletonLock behind in its profile, and the next
# launch against that profile refuses to start — which surfaces as ECONNREFUSED
# on the debug port and a crash banner, test after test, with nothing to say the
# cause was a lock file. The profiles are disposable, so they go with the
# processes; that also means no test can inherit state from its own last run.
#
# NARROWLY. The first version of this ran `pkill -f '-m http.server'`, which on
# this machine would also have killed two servers belonging to a different
# project running in another session. A cleanup that reaches outside its own
# suite is not a cleanup. Chrome is matched on OUR profile directory, and the
# servers only by the ports these tests actually declare.
# Both kinds of port these tests claim: the local web server, and the CDP debug
# port. The debug port matters just as much — one of them was already taken by an
# ssh tunnel from another project, so the handshake connected to THAT, every
# command drove a browser that could not see the local server, and the run
# reported "2 passed, 10 failed" with not one failure about the app.
ports(){ grep -ho 'PORT *= *[0-9]\+\|DBG *= *[0-9]\+\|remote-debugging-port=[0-9]\+' \
           scripts/*.mjs cloud/*.mjs 2>/dev/null \
         | grep -o '[0-9]\+' | sort -u; }
sweep(){
  pkill -f 'user-data-dir=[^ ]*/wl-' 2>/dev/null
  for p in $(ports); do
    for pid in $(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  done
  sleep 1
  rm -rf "${TMPDIR:-/tmp}"/wl-* 2>/dev/null
  return 0; }

# A test whose server cannot bind navigates to a Chrome error page, finds none of
# the app defined, and reports every "expect 0" check as a pass — 2 passed, 10
# failed, and not one of them about the app. Refuse to start in that state.
# Ports on this machine that belong to other projects. OG Game keeps an ssh
# tunnel up to the Mac mini — `ssh -N -L 9333 -L 9334 -R 8766` — restarted by a
# wrapper, so these come back even after something kills them. 8766 is OG's own
# game server coming back the other way, which is exactly the server an earlier
# version of the sweep here would have killed. A WatchList test must never claim
# one of these: binding fails or, far worse, a CDP handshake succeeds against
# the wrong browser and the suite reports confident nonsense.
RESERVED="9333 9334 8766 8768"
for p in $(ports); do
  case " $RESERVED " in *" $p "*)
    echo "suite: test port $p belongs to another project (OG Game's mini tunnel). Pick another." >&2
    exit 2 ;;
  esac
done

busy=""
for p in $(ports); do
  lsof -nP -iTCP:$p -sTCP:LISTEN -t >/dev/null 2>&1 && busy="$busy $p"
done

sweep
if [ -n "$busy" ]; then
  echo "suite: ports busy after sweep:$busy" >&2
  echo "suite: something outside this suite is holding them; not running." >&2
  exit 2
fi
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
