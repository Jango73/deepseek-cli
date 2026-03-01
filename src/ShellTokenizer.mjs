/**
 * Tokenizes a shell command string into an array of tokens, respecting quotes and escaping.
 * Handles single quotes ('), double quotes ("), and backslash escaping within quotes.
 */
export function tokenizeShellCommand(command) {
  const tokens = [];
  let current = "";
  let inQuote = null;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\" && inQuote) {
      escape = true;
      continue;
    }

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        if (current.trim()) {
          tokens.push(current.trim());
        }
        current = "";
      } else if (ch === " " || ch === "\t") {
        if (current.trim()) {
          tokens.push(current.trim());
        }
        current = "";
      } else {
        current += ch;
      }
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}