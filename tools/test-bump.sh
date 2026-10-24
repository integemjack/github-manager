#!/usr/bin/env bash
# Runs bump-decide.sh against 5 real git scenarios and asserts outcomes.
# The gh CLI is mocked via tools/mock/gh (first on PATH).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
WORK="$(mktemp -d)"
PASS=0; FAIL=0

say() { printf '%s\n' "$*"; }

setup() { # $1=dir -> creates bare origin + clone with package.json 0.1.0 + one commit
  local dir="$1"
  mkdir -p "$dir/origin.git" "$dir/clone"
  git -C "$dir/origin.git" init --bare -q
  git -C "$dir/clone" init -q -b main
  printf '{\n  "name": "github-manager",\n  "version": "0.1.0"\n}\n' > "$dir/clone/package.json"
  git -C "$dir/clone" add -A
  git -C "$dir/clone" -c user.name=t -c user.email=t@t commit -qm "init"
  git -C "$dir/clone" remote add origin "file://$dir/origin.git"
  git -C "$dir/clone" push -q -u origin main
}

run_case() { # $1=name, rest: env KEY=VAL; runs bump-decide in current $SCENARIO/clone
  local name="$1"; shift
  ( cd "$SCENARIO/clone" && env "$@" PATH="$HERE/mock:$PATH" GITHUB_REPOSITORY=acme/test bash "$ROOT/tools/bump-decide.sh" ) > "$SCENARIO/out.log" 2>&1
}

pkgver() { node -p 'require(process.argv[1]).version' "$1/clone/package.json"; }

assert_eq() {
  if [ "$2" = "$3" ]; then say "  ok: $1"; PASS=$((PASS+1))
  else say "  FAIL: $1 — expected [$3] got [$2]"; sed 's/^/    /' "$SCENARIO/out.log" 2>/dev/null; FAIL=$((FAIL+1)); fi
}

# --- A: rolling release missing -> no bump
SCENARIO="$WORK/a"; setup "$SCENARIO"
run_case "A" MOCK_ROLLING_EXISTS=0
assert_eq "A version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"
assert_eq "A no new commit" "$(git -C "$SCENARIO/clone" rev-list --count origin/main)" "1"

# --- B: versions differ -> no bump
SCENARIO="$WORK/b"; setup "$SCENARIO"
run_case "B" MOCK_ROLLING_EXISTS=1 MOCK_ROLLING_BODY="Automated rolling build.
version: 0.2.0
commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
built: x"
assert_eq "B version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"

# --- C: same version, same commit -> no bump
SCENARIO="$WORK/c"; setup "$SCENARIO"
C_SHA="$(git -C "$SCENARIO/clone" rev-parse HEAD)"
run_case "C" MOCK_ROLLING_EXISTS=1 MOCK_ROLLING_BODY="Automated rolling build.
version: 0.1.0
commit: $C_SHA
built: x"
assert_eq "C version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"

# --- D: same version, different commit -> bump patch + push
SCENARIO="$WORK/d"; setup "$SCENARIO"
printf 'x\n' > "$SCENARIO/clone/note.txt"
git -C "$SCENARIO/clone" add -A
git -C "$SCENARIO/clone" -c user.name=t -c user.email=t@t commit -qm "change"
git -C "$SCENARIO/clone" push -q
run_case "D" MOCK_ROLLING_EXISTS=1 MOCK_ROLLING_BODY="Automated rolling build.
version: 0.1.0
commit: 0000000000000000000000000000000000000000
built: x"
assert_eq "D version bumps to 0.1.1" "$(pkgver "$SCENARIO")" "0.1.1"
assert_eq "D pushed commit" "$(git -C "$SCENARIO/clone" rev-parse HEAD)" "$(git -C "$SCENARIO/clone" rev-parse origin/main)"
grep -q "version=0.1.1" "$SCENARIO/out.log" && { say "  ok: D outputs new version"; PASS=$((PASS+1)); } || { say "  FAIL: D output"; FAIL=$((FAIL+1)); }

# --- E: rolling exists but commit empty in body -> no bump
SCENARIO="$WORK/e"; setup "$SCENARIO"
run_case "E" MOCK_ROLLING_EXISTS=1 MOCK_ROLLING_BODY="Automated rolling build.
version: 0.1.0
built: x"
assert_eq "E version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"

say ""
say "PASS=$PASS FAIL=$FAIL (workdir $WORK)"
[ "$FAIL" = "0" ]
