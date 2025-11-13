#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

../../deepseek.sh --working-directory "$SCRIPT_DIR" --agent ProjectLeader --input "Specs are in Functional-Specs.md and in Technical-Specs.md"
