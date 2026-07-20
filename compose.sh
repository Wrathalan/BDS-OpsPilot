#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$REPO_ROOT"

. ./scripts/compose-runtime.sh
opspilot_require_compose "$REPO_ROOT"
opspilot_compose "$@"
