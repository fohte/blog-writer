#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi

vitest run --config vitest.screenshot.config.ts "$@"
VRT_VIEWPORT=tablet vitest run \
  --config vitest.screenshot.config.ts \
  --testNamePattern='the tablet layout places a long outline above the article body'
