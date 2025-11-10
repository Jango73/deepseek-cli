#!/bin/bash
set -e

# Get the absolute path of the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Path to the dashboard script (relative to script directory)
SCRIPT_FILE="$SCRIPT_DIR/main.mjs"

# Required dependencies
DEPS=()

# Store the ORIGINAL working directory
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

echo "[run] Starting deepseek CLI from: $ORIGINAL_DIR"
exec node "$SCRIPT_FILE" "$ORIGINAL_DIR"
