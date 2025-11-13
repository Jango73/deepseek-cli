#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

../../deepseek.sh --working-directory "$SCRIPT_DIR" --agent ProjectLeader "Specs are in Functional-Specs.md"
