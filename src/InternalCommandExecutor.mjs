import fs from "fs";
import path from "path";
import { ConsoleOutput } from "./ConsoleOutput.mjs";

/**
 * Parses an internal command string into a structured object.
 * Supported commands:
 * - read "filepath" from start to end [from-end] (or without range to read whole file)
 * - delete "filepath" from start to end [from-end]
 * - write "filepath" at line
 *   (content lines follow, separated by newline)
 * - replace "filepath" from start to end [from-end]
 *   (new content lines follow)
 * - file-size "filepath" (returns file size in bytes)
 */
export function parseInternalCommand(commandText) {
  const lines = commandText.split("\n");
  const firstLine = lines[0].trim();
  const restLines = lines.slice(1);

  // Tokenize the first line respecting quotes
  const tokens = tokenizeInternalLine(firstLine);
  if (tokens.length === 0) {
    return { error: "Empty command" };
  }

  const cmd = tokens[0].toLowerCase();
  let filePath = null;
  let start = null;
  let end = null;
  let line = null;

  // Helper to parse a quoted path
  const parseFilePath = (idx) => {
    if (idx >= tokens.length) return null;
    let token = tokens[idx];
    // Remove surrounding quotes if present
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1);
    }
    return token;
  };

  // Helper to parse a number
  const parseNumber = (idx) => {
    if (idx >= tokens.length) return null;
    const num = parseInt(tokens[idx], 10);
    return isNaN(num) ? null : num;
  };

  if (cmd === "read" || cmd === "delete" || cmd === "replace") {
    // read "file" from X to Y [from-end]
    // delete "file" from X to Y [from-end]
    // replace "file" from X to Y [from-end]
    filePath = parseFilePath(1);
    if (!filePath) {
      return { error: `Missing file path for ${cmd}` };
    }
    let fromEnd = false;
    let start = null;
    let end = null;
    
    if (tokens.length >= 4 && tokens[2].toLowerCase() === "from") {
      start = parseNumber(3);
      if (start === null) {
        return { error: `Invalid start line for ${cmd}` };
      }
      if (tokens.length >= 6 && tokens[4].toLowerCase() === "to") {
        end = parseNumber(5);
        if (end === null) {
          return { error: `Invalid end line for ${cmd}` };
        }
        // Check for "from-end" token after the range
        if (tokens.length >= 7 && tokens[6].toLowerCase() === "from-end") {
          fromEnd = true;
        }
      } else {
        // If only "from X" without "to Y", treat as single line
        end = start;
        // Check for "from-end" token after the single line
        if (tokens.length >= 5 && tokens[4].toLowerCase() === "from-end") {
          fromEnd = true;
        }
      }
    } else {
      // No line range, default to whole file? For read, maybe whole file.
      // For delete/replace, need range.
      if (cmd === "read") {
        // read whole file
        start = 1;
        end = Infinity;
      } else {
        return { error: `Missing line range for ${cmd}` };
      }
    }
    return {
      type: cmd,
      filePath,
      start,
      end,
      fromEnd,
      content: restLines.join("\n")
    };
  } else if (cmd === "write") {
    // write "file" at X
    filePath = parseFilePath(1);
    if (!filePath) {
      return { error: "Missing file path for write" };
    }
    if (tokens.length >= 3 && tokens[2].toLowerCase() === "at") {
      line = parseNumber(3);
      if (line === null) {
        return { error: "Invalid line number for write" };
      }
    } else {
      return { error: "Missing 'at' line number for write" };
    }
    return {
      type: cmd,
      filePath,
      line,
      content: restLines.join("\n")
    };
  } else if (cmd === "file-size") {
    // file-size "filepath"
    filePath = parseFilePath(1);
    if (!filePath) {
      return { error: "Missing file path for file-size" };
    }
    return {
      type: cmd,
      filePath,
      content: restLines.join("\n")
    };
  } else {
    return { error: `Unknown internal command: ${cmd}` };
  }
}

/**
 * Tokenizes a single line respecting quotes.
 * Simplified version of tokenizeShellCommand but for a single line.
 */
function tokenizeInternalLine(line) {
  const tokens = [];
  let current = "";
  let inQuote = null;
  let escape = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

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

/**
 * Executes an internal command object.
 * Returns { success, output, error } similar to shell command result.
 */
export function executeInternalCommand(cmdObj, workingDirectory) {
  try {
    const absPath = path.isAbsolute(cmdObj.filePath)
      ? cmdObj.filePath
      : path.join(workingDirectory, cmdObj.filePath);

    // Ensure file exists for read, delete, replace (write may create?)
    if (cmdObj.type !== "write") {
      if (!fs.existsSync(absPath)) {
        return {
          success: false,
          output: `File not found: ${cmdObj.filePath}`,
          error: "FILE_NOT_FOUND"
        };
      }
    }

    switch (cmdObj.type) {
      case "read": {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        let start = Math.max(1, cmdObj.start);
        let end = cmdObj.end === Infinity ? lines.length : Math.min(cmdObj.end, lines.length);
        if (cmdObj.fromEnd) {
          const total = lines.length;
          start = total - start + 1;
          end = total - end + 1;
          // Ensure start <= end
          if (start > end) {
            [start, end] = [end, start];
          }
          // Clamp to valid range
          start = Math.max(1, start);
          end = Math.min(total, end);
        }
        if (start > end || start > lines.length) {
          return {
            success: false,
            output: `Invalid line range: ${start}-${end} (file has ${lines.length} lines)`,
            error: "INVALID_RANGE"
          };
        }
        const selected = lines.slice(start - 1, end);
        // Output with line numbers
        const numbered = selected.map((line, idx) => `${start + idx}: ${line}`);
        return {
          success: true,
          output: numbered.join("\n"),
          error: null
        };
      }

      case "delete": {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        let start = Math.max(1, cmdObj.start);
        let end = Math.min(cmdObj.end, lines.length);
        if (cmdObj.fromEnd) {
          const total = lines.length;
          start = total - start + 1;
          end = total - end + 1;
          // Ensure start <= end
          if (start > end) {
            [start, end] = [end, start];
          }
          // Clamp to valid range
          start = Math.max(1, start);
          end = Math.min(total, end);
        }
        if (start > end || start > lines.length) {
          return {
            success: false,
            output: `Invalid line range: ${start}-${end} (file has ${lines.length} lines)`,
            error: "INVALID_RANGE"
          };
        }
        lines.splice(start - 1, end - start + 1);
        fs.writeFileSync(absPath, lines.join("\n"));
        return {
          success: true,
          output: `Deleted lines ${start}-${end} from ${cmdObj.filePath}`,
          error: null
        };
      }

      case "write": {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        const insertAt = Math.max(1, cmdObj.line);
        // If line is beyond end, pad with empty lines
        while (lines.length < insertAt - 1) {
          lines.push("");
        }
        const newLines = cmdObj.content.split("\n");
        lines.splice(insertAt - 1, 0, ...newLines);
        fs.writeFileSync(absPath, lines.join("\n"));
        return {
          success: true,
          output: `Written ${newLines.length} line(s) at line ${insertAt} to ${cmdObj.filePath}`,
          error: null
        };
      }

      case "replace": {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        let start = Math.max(1, cmdObj.start);
        let end = Math.min(cmdObj.end, lines.length);
        if (cmdObj.fromEnd) {
          const total = lines.length;
          start = total - start + 1;
          end = total - end + 1;
          // Ensure start <= end
          if (start > end) {
            [start, end] = [end, start];
          }
          // Clamp to valid range
          start = Math.max(1, start);
          end = Math.min(total, end);
        }
        if (start > end || start > lines.length) {
          return {
            success: false,
            output: `Invalid line range: ${start}-${end} (file has ${lines.length} lines)`,
            error: "INVALID_RANGE"
          };
        }
        const newLines = cmdObj.content.split("\n");
        lines.splice(start - 1, end - start + 1, ...newLines);
        fs.writeFileSync(absPath, lines.join("\n"));
        return {
          success: true,
          output: `Replaced lines ${start}-${end} with ${newLines.length} line(s) in ${cmdObj.filePath}`,
          error: null
        };
      }

      case "file-size": {
        const stats = fs.statSync(absPath);
        return {
          success: true,
          output: `File size: ${stats.size} bytes`,
          error: null
        };
      }

      default:
        return {
          success: false,
          output: `Unsupported internal command: ${cmdObj.type}`,
          error: "UNKNOWN_COMMAND"
        };
    }
  } catch (err) {
    return {
      success: false,
      output: `Error executing internal command: ${err.message}`,
      error: "EXECUTION_ERROR"
    };
  }
}