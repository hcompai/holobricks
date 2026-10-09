#!/usr/bin/env bash
# Mirror this commit's tree to the public repo through one rolling pull request: PUBLIC=owner/repo GH_TOKEN=… scripts/sync-public.sh
# Each sync commit has the previous sync and the public main as parents, so the pull request always merges cleanly and its
# diff is exactly what the public repo lacks. Changes made only in the public repo show as reverted until they are ported here.
set -euo pipefail
cd "$(dirname "$0")/.."

public=${PUBLIC:?set PUBLIC to owner/repo}
: "${GH_TOKEN:?set GH_TOKEN to a token that can push to $public}"
remote="https://x-access-token:$GH_TOKEN@github.com/$public.git"
tree=$(git rev-parse 'HEAD^{tree}')

git fetch --quiet "$remote" +refs/heads/main:refs/sync/main
if [[ $(git rev-parse 'refs/sync/main^{tree}') == "$tree" ]]; then
  echo "$public main already matches $(git rev-parse --short HEAD)."
  exit 0
fi
parents=(-p refs/sync/main)
if git fetch --quiet "$remote" +refs/heads/sync:refs/sync/sync 2>/dev/null; then
  parents=(-p refs/sync/sync "${parents[@]}")
fi
if [[ ${#parents[@]} -eq 4 && $(git rev-parse 'refs/sync/sync^{tree}') == "$tree" ]] &&
  git merge-base --is-ancestor refs/sync/main refs/sync/sync; then
  echo "$public sync already matches $(git rev-parse --short HEAD)."
else
  commit=$(git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit-tree "$tree" "${parents[@]}" -m "Sync, $(date -u '+%F %H:%M') UTC")
  git push --quiet "$remote" "$commit:refs/heads/sync"
fi

if [[ -z $(gh pr list -R "$public" --head sync --state open --json number --jq '.[].number') ]]; then
  gh pr create -R "$public" --base main --head sync --title "Sync from the private repo" \
    --body "Rolling: every push to the private default branch adds a commit here. Merge any time."
fi
