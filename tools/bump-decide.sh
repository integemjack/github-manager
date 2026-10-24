#!/usr/bin/env bash
# Extracted, line-for-line, from .github/workflows/release.yml "Decide version" step.
# The gh CLI is mocked by test-mock-gh.sh via PATH so the *real* logic runs unchanged.
set -euo pipefail
VERSION="$(node -p 'require("./package.json").version')"
HEAD_SHA="$(git rev-parse HEAD)"
LAST_VERSION=""
LAST_COMMIT=""
if gh release view rolling --repo "$GITHUB_REPOSITORY" > /dev/null 2>&1; then
  LAST_VERSION="$(gh release view rolling --repo "$GITHUB_REPOSITORY" --json body -q .body | grep -oP 'version: \K[0-9.]+' | head -1 || true)"
  LAST_COMMIT="$(gh release view rolling --repo "$GITHUB_REPOSITORY" --json body -q .body | grep -oP 'commit: \K[0-9a-f]+' | head -1 || true)"
fi
echo "current=$VERSION last=$LAST_VERSION last_commit=$LAST_COMMIT head=$HEAD_SHA"
if [ -n "$LAST_VERSION" ] && [ "$LAST_VERSION" = "$VERSION" ] && [ -n "$LAST_COMMIT" ] && [ "$LAST_COMMIT" != "$HEAD_SHA" ]; then
  NEW_VERSION="$(node -p "const s='${VERSION}'.split('.').map(Number); s[2]++; s.join('.')")"
  npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git commit -am "chore: bump version to ${NEW_VERSION} [skip ci]"
  git push
  VERSION="$NEW_VERSION"
  HEAD_SHA="$(git rev-parse HEAD)"
fi
echo "version=$VERSION"
echo "sha=$HEAD_SHA"
