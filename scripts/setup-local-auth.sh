#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
expected=https://github.com/parthsheelenterprises/social_post.git
actual=$(git -C "$repo_root" remote get-url origin)
[ "$actual" = "$expected" ] || { printf 'Unexpected Git origin: %s\n' "$actual" >&2; exit 1; }

unset GH_TOKEN GITHUB_TOKEN
gh auth token --hostname github.com --user parthsheelenterprises >/dev/null

git -C "$repo_root" config --local credential.useHttpPath true
# An empty first helper clears global helpers such as credential-store.
git -C "$repo_root" config --local --replace-all credential.helper ''
git -C "$repo_root" config --local --add credential.helper \
  '!sh "$(git rev-parse --show-toplevel)/scripts/pe-git-credential.sh"'
printf 'PE Git credentials are isolated to this checkout.\n'
