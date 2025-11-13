#!/bin/bash
set -e

# Get the absolute path of the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Path to the dashboard script (relative to script directory)
SCRIPT_FILE="$SCRIPT_DIR/src/main.mjs"

# Required dependencies
DEPS=()

# Store the ORIGINAL working directory (where user launched the script)
ORIGINAL_DIR="$(pwd)"

# Change to script directory ONLY for npm operations
cd "$SCRIPT_DIR"

# Initialize npm project if missing
if [ ! -f package.json ]; then
    echo "[setup] Initializing npm project..."
    npm init -y >/dev/null
fi

# Install missing dependencies
for dep in "${DEPS[@]}"; do
    if ! npm list "$dep" >/dev/null 2>&1; then
        echo "[setup] Installing $dep..."
        npm install "$dep"
    fi
done

# Run the CLI
if [ ! -f "$SCRIPT_FILE" ]; then
    echo "[error] Script '$SCRIPT_FILE' not found."
    exit 1
fi

# Determine target working directory (default to where script was launched)
TARGET_DIR="$ORIGINAL_DIR"
FORWARDED_ARGS=()
API_KEY="${DEEPSEEK_API_KEY:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --working-directory)
            if [ -z "${2:-}" ]; then
                echo "[error] --working-directory requires a path argument"
                exit 1
            fi
            TARGET_DIR="$2"
            shift 2
            ;;
        --working-directory=*)
            TARGET_DIR="${1#*=}"
            shift
            ;;
        --api-key)
            if [ -z "${2:-}" ]; then
                echo "[error] --api-key requires a value"
                exit 1
            fi
            API_KEY="$2"
            shift 2
            ;;
        --api-key=*)
            API_KEY="${1#*=}"
            shift
            ;;
        *)
            FORWARDED_ARGS+=("$1")
            shift
            ;;
    esac
done

export DEEPSEEK_API_KEY="$API_KEY"

FORWARDED_ARGS+=(--working-directory "$TARGET_DIR")
if [ -n "$API_KEY" ]; then
    FORWARDED_ARGS+=(--api-key "$API_KEY")
fi

echo "[run] Starting deepseek CLI with workspace: $TARGET_DIR"
exec node "$SCRIPT_FILE" "${FORWARDED_ARGS[@]}"
