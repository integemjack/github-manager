#!/usr/bin/env bash
# Runs bump-decide.sh against real git scenarios (tag-based) and asserts outcomes.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
WORK="$(mktemp -d)"
PASS=0; FAIL=0

say() { printf '%s\n' "$*"; }

setup() { # $1=dir -> bare origin + clone with package.json 0.1.0 + one commit
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

run_case() { # runs bump-decide in $SCENARIO/clone
  ( cd "$SCENARIO/clone" && env GITHUB_REPOSITORY=acme/test bash "$ROOT/tools/bump-decide.sh" ) > "$SCENARIO/out.log" 2>&1
}

pkgver() { node -p 'require(process.argv[1]).version' "$1/clone/package.json"; }
hastag() { git -C "$1/clone" rev-parse -q --verify "refs/tags/$2" >/dev/null 2>&1; }
origintag() { git -C "$1/origin.git" rev-parse -q --verify "refs/tags/$2" >/dev/null 2>&1; }

assert_eq() {
  if [ "$2" = "$3" ]; then say "  ok: $1"; PASS=$((PASS+1))
  else say "  FAIL: $1 — expected [$3] got [$2]"; sed 's/^/    /' "$SCENARIO/out.log" 2>/dev/null; FAIL=$((FAIL+1)); fi
}
assert_ok() {
  if [ "$2" = "0" ]; then say "  ok: $1"; PASS=$((PASS+1))
  else say "  FAIL: $1"; sed 's/^/    /' "$SCENARIO/out.log" 2>/dev/null; FAIL=$((FAIL+1)); fi
}

# --- A: no v* tag at all -> no bump, tag v0.1.0 created at HEAD and pushed
SCENARIO="$WORK/a"; setup "$SCENARIO"
run_case
assert_eq "A version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"
assert_ok "A tag v0.1.0 exists locally" "$(hastag "$SCENARIO" v0.1.0; echo $?)"
assert_ok "A tag v0.1.0 pushed to origin" "$(origintag "$SCENARIO" v0.1.0; echo $?)"

# --- B: latest tag is newer (v0.2.0) than package.json (0.1.0) -> no bump, tag v0.1.0 created
SCENARIO="$WORK/b"; setup "$SCENARIO"
git -C "$SCENARIO/clone" tag v0.2.0
git -C "$SCENARIO/clone" push -q origin v0.2.0
run_case
assert_eq "B version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"
assert_ok "B tag v0.1.0 exists locally" "$(hastag "$SCENARIO" v0.1.0; echo $?)"

# --- C: tag v0.1.0 already at HEAD -> idempotent, no bump, no duplicate push
SCENARIO="$WORK/c"; setup "$SCENARIO"
git -C "$SCENARIO/clone" tag v0.1.0
git -C "$SCENARIO/clone" push -q origin v0.1.0
run_case
assert_eq "C version stays 0.1.0" "$(pkgver "$SCENARIO")" "0.1.0"
assert_eq "C outputs version=0.1.0" "$(grep -c '^version=0.1.0$' "$SCENARIO/out.log")" "1"

# --- D: tag v0.1.0 at older commit, new commit on main -> bump to 0.1.1, tag v0.1.1 at new HEAD
SCENARIO="$WORK/d"; setup "$SCENARIO"
git -C "$SCENARIO/clone" tag v0.1.0
git -C "$SCENARIO/clone" push -q origin v0.1.0
printf 'x\n' > "$SCENARIO/clone/note.txt"
git -C "$SCENARIO/clone" add -A
git -C "$SCENARIO/clone" -c user.name=t -c user.email=t@t commit -qm "change"
git -C "$SCENARIO/clone" push -q
run_case
assert_eq "D version bumps to 0.1.1" "$(pkgver "$SCENARIO")" "0.1.1"
assert_eq "D bump commit on origin/main" "$(git -C "$SCENARIO/clone" rev-parse HEAD)" "$(git -C "$SCENARIO/clone" rev-parse origin/main)"
assert_ok "D tag v0.1.1 exists locally" "$(hastag "$SCENARIO" v0.1.1; echo $?)"
assert_ok "D tag v0.1.1 pushed to origin" "$(origintag "$SCENARIO" v0.1.1; echo $?)"
assert_eq "D tag v0.1.1 points at HEAD" "$(git -C "$SCENARIO/clone" rev-parse v0.1.1^{commit})" "$(git -C "$SCENARIO/clone" rev-parse HEAD)"
assert_eq "D outputs version=0.1.1" "$(grep -c '^version=0.1.1$' "$SCENARIO/out.log")" "1"

# --- E: tag for current version exists at a DIFFERENT commit (and a newer
#     v0.2.0 tag exists so no bump happens) -> refuse to move it (exit 1)
SCENARIO="$WORK/e"; setup "$SCENARIO"
INIT_SHA="$(git -C "$SCENARIO/clone" rev-parse HEAD)"
printf '{\n  "name": "github-manager",\n  "version": "0.1.1"\n}\n' > "$SCENARIO/clone/package.json"
git -C "$SCENARIO/clone" add -A
git -C "$SCENARIO/clone" -c user.name=t -c user.email=t@t commit -qm "set 0.1.1"
git -C "$SCENARIO/clone" push -q
# newest tag is v0.2.0 (≠ 0.1.1, so no bump); v0.1.1 already tagged at the OLD commit
git -C "$SCENARIO/clone" tag v0.2.0 "$INIT_SHA"
git -C "$SCENARIO/clone" tag v0.1.1 "$INIT_SHA"
git -C "$SCENARIO/clone" push -q origin v0.2.0 v0.1.1
( cd "$SCENARIO/clone" && env GITHUB_REPOSITORY=acme/test bash "$ROOT/tools/bump-decide.sh" ) > "$SCENARIO/out.log" 2>&1
RC=$?
if [ "$RC" != "0" ]; then say "  ok: E refuses to move existing tag"; PASS=$((PASS+1))
else say "  FAIL: E should have exited non-zero"; FAIL=$((FAIL+1)); fi

say ""
say "PASS=$PASS FAIL=$FAIL (workdir $WORK)"
[ "$FAIL" = "0" ]
