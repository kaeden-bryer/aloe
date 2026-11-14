#!/bin/sh
# Build aloe-sandbox-ccf from the fork at a pinned commit.
#   docker/sandbox-ccf/build.sh [commit]      (default: the pinned commit below)
# Needs: docker, git, the base image `aloe-sandbox` (docker build -t aloe-sandbox docker/sandbox).
set -eu

REPO="${CCF_REPO:-https://github.com/kaeden-bryer/cloud-carbon-footprint.git}"
# Pinned on purpose: the baked node_modules must match this commit's yarn.lock.
COMMIT="${1:-f584c549ee358d5980d36513267d007ecd3ee716}"
TAG="${TAG:-aloe-sandbox-ccf}"
HERE="$(cd "$(dirname "$0")" && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Fetch only that commit (shallow), then export a clean tree: no .git in the build context.
git init -q "$WORK/src"
git -C "$WORK/src" fetch -q --depth 1 "$REPO" "$COMMIT"
mkdir "$WORK/ctx"
git -C "$WORK/src" archive --prefix=ccf/ FETCH_HEAD | tar -x -C "$WORK/ctx"

docker build -f "$HERE/Dockerfile" -t "$TAG" "$WORK/ctx/ccf"
echo "Built $TAG from $COMMIT"
