#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

source_branch="${1:-}"
expected_sha="${2:-}"

[[ "$source_branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "A valid source branch is required."
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase commit SHA is required."

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
actual_sha="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$actual_sha" == "$expected_sha" ]] \
  || fail "Checked out $actual_sha instead of $expected_sha."

# Compatibility entrypoint for callers that still pass branch/SHA. The fast
# path uses the checkout directly without a registry, push/pull, or pruning.
exec bash "$repo_root/deploy/update.sh"
