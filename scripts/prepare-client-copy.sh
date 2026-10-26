#!/usr/bin/env bash
set -euo pipefail

# Prepare a client copy from a disposable clone. Dry-run is the safe default.
# Never run this against the master repository or a production checkout.

APPLY=false
TARGET="$(pwd)"
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --target=*) TARGET="${arg#*=}" ;;
    -h|--help) printf 'Usage: %s [--target=DIR] [--apply]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

TARGET="$(cd "$TARGET" && pwd)"
if [[ -d "$TARGET/.git" && "$(git -C "$TARGET" rev-parse --is-inside-work-tree 2>/dev/null)" == true ]]; then
  BRANCH="$(git -C "$TARGET" branch --show-current)"
  if [[ "$BRANCH" == "main" || "$BRANCH" == "master" || "$BRANCH" == "production" ]]; then
    printf 'Refusing to operate on protected branch: %s\n' "$BRANCH" >&2; exit 1
  fi
  if [[ -n "$(git -C "$TARGET" status --porcelain)" ]]; then
    printf 'Refusing to operate on a dirty working tree: %s\n' "$TARGET" >&2; exit 1
  fi
fi

if [[ -f "$TARGET/.env" || -f "$TARGET/.env.production" ]]; then
  printf 'Refusing to operate on a production-looking checkout: %s\n' "$TARGET" >&2; exit 1
fi

if [[ ! -f "$TARGET/package.json" || ! -d "$TARGET/.git" ]]; then
  printf 'Target must be a fresh git clone containing package.json: %s\n' "$TARGET" >&2; exit 1
fi

# Keep this list intentionally explicit. Review additions before applying.
REMOVALS=(
  tmp-cleanup-verify.ts tmp-dbcheck2.ts tmp-debug-dialog.mjs tmp-peek.mjs tmp-peek2.mjs tmp-seed-verify.ts
  scripts/e2e-final.sh scripts/e2e-finish-onboarding.mts scripts/e2e-forced-password.sh scripts/e2e-prepare-user.mts
  scripts/qa-dash.mjs scripts/qa-featured-work.mjs scripts/qa-gallery-states.mjs scripts/qa-screens.mjs scripts/qa-team-chips.mjs
  src/app/api/test
)
MANIFEST="$TARGET/client-copy-removals.txt"
EXISTING=()
for relative in "${REMOVALS[@]}"; do
  if [[ -e "$TARGET/$relative" ]]; then
    EXISTING+=("$relative")
    printf '%s\n' "$relative"
  fi
done
printf '\nNo credentials or secret values are printed. Run with --apply to delete only the listed internal test artifacts.\n'

if [[ "$APPLY" != true ]]; then
  printf 'Dry-run only: no files were deleted or created.\n'
  exit 0
fi

{
  printf 'Client-copy removal manifest\nGenerated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "${EXISTING[@]}"
} > "$MANIFEST"
for relative in "${EXISTING[@]}"; do
  rm -rf -- "$TARGET/$relative"
done
printf 'Applied approved removals. Review client-copy-removals.txt and run the client build.\n'
