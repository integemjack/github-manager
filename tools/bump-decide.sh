#!/usr/bin/env bash
# Extracted, line-for-line, from .github/workflows/release.yml "Decide version & tag"
# step (stdout replaces $GITHUB_OUTPUT). Test scenarios live in tools/test-bump.sh.
set -euo pipefail
VERSION="$(node -p 'require("./package.json").version')"
HEAD_SHA="$(git rev-parse HEAD)"
LAST_TAG="$(git tag -l 'v*' --sort=-v:refname | head -1 || true)"
LAST_VERSION="${LAST_TAG#v}"
echo "current=$VERSION last_tag=${LAST_TAG:-none} head=$HEAD_SHA"
if [ -n "$LAST_VERSION" ] && [ "$LAST_VERSION" = "$VERSION" ] && \
   [ "$(git rev-parse -q --verify "refs/tags/$LAST_TAG" 2>/dev/null || true)" != "$HEAD_SHA" ]; then
  NEW_VERSION="$(node -p "const s='${VERSION}'.split('.').map(Number); s[2]++; s.join('.')")"
  npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git commit -am "chore: bump version to ${NEW_VERSION} [skip ci]"
  git push
  VERSION="$NEW_VERSION"
  HEAD_SHA="$(git rev-parse HEAD)"
fi
# Always ensure the release tag exists at the exact commit we build.
TAG="v$VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  EXISTING="$(git rev-parse "$TAG^{commit}")"
  if [ "$EXISTING" != "$HEAD_SHA" ]; then
    echo "::error::tag $TAG already exists at $EXISTING, refusing to move it to $HEAD_SHA" >&2
    exit 1
  fi
else
  git tag "$TAG" "$HEAD_SHA"
  git push origin "$TAG"
fi
echo "version=$VERSION"
echo "sha=$HEAD_SHA"
echo "tag=$TAG"
