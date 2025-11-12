#!/usr/bin/env sh
# List all .mjs files in the current directory and write their contents
# into code.txt, each wrapped in a Markdown code block labeled with the filename.

set -eu

OUTPUT_FILE="code.txt"

# Start fresh
: > "$OUTPUT_FILE"

echo "Scanning current directory for .mjs files..." >&2

found=0

# Portable glob-based loop (handles spaces in filenames)
for f in ./*.mjs; do
    # If the glob doesn't match, it remains literal; guard against that
    [ -e "$f" ] || break

    found=1
    filename="$(basename "$f")"
    echo "Appending ${filename} to ${OUTPUT_FILE}..." >&2

    # Write header fence with the filename as the code block label
    # Note: Markdown allows an info string; using the filename for readability.
    printf '```%s\n' "$filename" >> "$OUTPUT_FILE"

    # Append file content verbatim
    cat -- "$f" >> "$OUTPUT_FILE"

    # Close the code block and add a blank line between entries
    printf '\n```\n\n' >> "$OUTPUT_FILE"
done

if [ "$found" -eq 0 ]; then
    echo "No .mjs files found in the current directory." >&2
else
    echo "Done. Output written to ${OUTPUT_FILE}." >&2
fi
