import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { ConsoleOutput } from "./ConsoleOutput.mjs";
import { tokenizeShellCommand } from "./ShellTokenizer.mjs";
import { parseInternalCommand as parseInternalCommandExternal, executeInternalCommand as executeInternalCommandExternal } from "./InternalCommandExecutor.mjs";

export class CommandExecutor {
  static MAX_COMMAND_LINES = 20;

  constructor(workingDirectory, forbiddenCommands) {
    this.workingDirectory = workingDirectory;
    this.forbiddenCommands = new Set(
      forbiddenCommands.map((cmd) => cmd.toLowerCase()),
    );
    this.currentExecution = null;
  }

  isCommandForbidden(command) {
    const cleanCommand = command.split("#")[0].trim().toLowerCase();
    return Array.from(this.forbiddenCommands).some(
      (forbidden) =>
        cleanCommand === forbidden || cleanCommand.startsWith(forbidden),
    );
  }

  executeCommand(command) {
    return new Promise((resolve) => {
      if (typeof command !== "string") {
        resolve({
          success: false,
          output: "❌ Invalid command input",
          error: "INVALID_COMMAND",
        });
        return;
      }
      const trimmedCommand = command.trim();

      if (
        trimmedCommand.toLowerCase() === "pause" ||
        trimmedCommand.toLowerCase() === "exit" ||
        trimmedCommand.toLowerCase() === "done"
      ) {
        resolve({
          success: true,
          output: "PAUSE: Waiting for user action. Continue when ready.",
          paused: true,
        });
        return;
      }

      if (!trimmedCommand) {
        resolve({
          success: false,
          output: "❌ Empty command",
          error: "Empty command",
        });
        return;
      }

      if (this.isCommandForbidden(trimmedCommand)) {
        resolve({
          success: false,
          output: `❌ FORBIDDEN COMMAND: "${trimmedCommand}" is not allowed for safety reasons.`,
          error: "Forbidden command",
        });
        return;
      }

      const heredocError = this.findUnterminatedHeredoc(trimmedCommand);
      if (heredocError) {
        resolve({
          success: false,
          output: heredocError,
          error: "Unterminated heredoc",
        });
        return;
      }

      const heredocResult = this.tryHandleHeredocCommand(command);
      if (heredocResult) {
        resolve(heredocResult);
        return;
      }

      const commandLines = command.split("\n");
      if (commandLines.length > CommandExecutor.MAX_COMMAND_LINES) {
        resolve({
          success: false,
          output: `⚠️ Command skipped: ${commandLines.length} lines detected (max ${CommandExecutor.MAX_COMMAND_LINES}). Split the script into smaller blocks.`,
          error: "COMMAND_TOO_LONG",
          lineCount: commandLines.length,
        });
        return;
      }

      const args = ["-c", trimmedCommand];
      const childProcess = execFile(
        "/bin/sh",
        args,
        {
          timeout: 60000,
          cwd: this.workingDirectory,
        },
        (error, stdout, stderr) => {
          this.currentExecution = null;

          const output = stdout + stderr;
          const success = error === null;

          if (error) {
            ConsoleOutput.error(`Command failed with exit code ${error.code}`);
          }

          resolve({
            success,
            output: output || "No output",
            error: error ? error.message : null,
          });
        },
      );

      this.currentExecution = childProcess;
    });
  }

  tryHandleHeredocCommand(command) {
    const lines = command.split("\n");
    if (lines.length === 0) {
      return null;
    }

    const firstLine = lines[0].trim();
    const heredocMatch = firstLine.match(
      /^cat\s+(>?>)\s+(.+?)\s+<<\s*(['"]?)([A-Za-z0-9_-]+)\3\s*$/,
    );
    if (!heredocMatch) {
      return null;
    }

    const operator = heredocMatch[1];
    let targetPath = heredocMatch[2].trim();
    if (
      (targetPath.startsWith('"') && targetPath.endsWith('"')) ||
      (targetPath.startsWith("'") && targetPath.endsWith("'"))
    ) {
      targetPath = targetPath.substring(1, targetPath.length - 1);
    }
    const terminator = heredocMatch[4];

    const closingIndex = lines.findIndex(
      (line, idx) => idx > 0 && line.replace(/\r$/, "") === terminator,
    );
    if (closingIndex === -1) {
      return {
        success: false,
        output: `❌ Unterminated heredoc marker "${terminator}". Complete the block before executing.`,
        error: "UNTERMINATED_HEREDOC",
      };
    }

    const contentLines = lines.slice(1, closingIndex);
    let content = contentLines.join("\n");
    if (content.length && !content.endsWith("\n")) {
      content += "\n";
    }

    try {
      const absolutePath = path.isAbsolute(targetPath)
        ? targetPath
        : path.join(this.workingDirectory, targetPath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      if (operator === ">>") {
        fs.appendFileSync(absolutePath, content);
      } else {
        fs.writeFileSync(absolutePath, content);
      }
      return {
        success: true,
        output: `✅ Wrote ${contentLines.length} line(s) to ${targetPath}`,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        output: `❌ Failed to write file: ${error.message}`,
        error: "HEREDOC_WRITE_FAILED",
      };
    }
  }

  killCurrentProcess() {
    if (this.currentExecution) {
      this.currentExecution.kill("SIGTERM");
      this.currentExecution = null;
    }
  }

  classifyCommand(command) {
    const cmd = command.toLowerCase().trim();

    // Commandes d'exploration
    const explorationPatterns = [
      /^ls\b/, /^find\b/, /^grep\b/, /^cat\b/, /^head\b/, /^tail\b/,
      /^file\b/, /^stat\b/, /^wc\b/, /^pwd\b/, /^which\b/, /^type\b/,
      /^env\b/, /^echo\b/, /^sed\s+-n/, /^sed\s+.*p$/, /^awk\b/, /^cut\b/,
      /^sort\b/, /^uniq\b/, /^tr\b/, /^diff\b/, /^cmp\b/, /^comm\b/,
      /^rg\b/, /^ag\b/, /^ack\b/, /^git\s+log/, /^git\s+show/, /^git\s+diff/,
      /^git\s+status/, /^npm\s+list/, /^npm\s+view/, /^npm\s+info/,
    ];

    // Commandes d'édition (sed avec modification, mv, cp, rm, etc.)
    const editionPatterns = [
      /^sed\s+.*[^p]$/, /^sed\s+-i/, /^mv\b/, /^cp\b/, /^rm\b/, /^mkdir\b/,
      /^rmdir\b/, /^touch\b/, /^chmod\b/, /^chown\b/, /^chgrp\b/, /^ln\b/,
      /^git\s+add/, /^git\s+commit/, /^git\s+push/, /^git\s+pull/, /^git\s+merge/,
      /^git\s+rebase/, /^git\s+reset/, /^git\s+checkout/, /^git\s+branch\s+-c/,
      /^git\s+tag\s+-a/, /^npm\s+install/, /^npm\s+uninstall/, /^npm\s+update/,
      /^npm\s+init/, /^npm\s+publish/,
    ];

    for (const pattern of explorationPatterns) {
      if (pattern.test(cmd)) {
        return "exploration";
      }
    }

    for (const pattern of editionPatterns) {
      if (pattern.test(cmd)) {
        return "edition";
      }
    }

    return "other";
  }

  extractCommandTarget(command) {
    const tokens = tokenizeShellCommand(command);
    if (tokens.length === 0) {
      return "";
    }

    // Special handling for cd (not classified as exploration/edition)
    if (tokens[0].toLowerCase() === "cd") {
      let i = 1;
      while (i < tokens.length && tokens[i].startsWith("-")) {
        if (this._flagExpectsArgument(tokens[i]) && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
          i++; // skip flag argument
        }
        i++;
      }
      if (i < tokens.length) {
        return tokens[i];
      }
      return "";
    }

    // Only extract target for commands classified as exploration or edition
    const category = this.classifyCommand(command);
    if (category === "other") {
      return "";
    }

    // Determine command name (with possible subcommand for git/npm)
    let commandName = tokens[0].toLowerCase();
    let skip = 1;
    if (commandName === "git" || commandName === "npm") {
      if (tokens.length > 1) {
        commandName = `${commandName} ${tokens[1].toLowerCase()}`;
        skip = 2;
      }
    }

    // Commands that have no file/directory target
    const noTargetCommands = new Set([
      "echo", "pwd", "env", "which", "type",
      "git status", "git log", "git show", "git diff", "git commit",
      "git push", "git pull", "git merge", "git rebase", "git reset",
      "git checkout", "git tag", "git branch -c", "git tag -a",
      "npm list", "npm view", "npm info", "npm install", "npm uninstall",
      "npm update", "npm init", "npm publish"
    ]);
    if (noTargetCommands.has(commandName) || noTargetCommands.has(tokens[0].toLowerCase())) {
      return "";
    }

    // Skip command tokens
    let i = skip;
    // Helper to skip flags and their arguments
    while (i < tokens.length && tokens[i].startsWith("-")) {
      if (this._flagExpectsArgument(tokens[i]) && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
        i++; // skip flag argument
      }
      i++;
    }

    // After flags, determine target based on command
    // Commands where the first non‑flag token is a pattern/script, not a target
    const skipPatternCommands = new Set(["grep", "sed", "awk"]);
    if (skipPatternCommands.has(tokens[0].toLowerCase())) {
      // Skip pattern/script token
      if (i < tokens.length) {
        i++;
      }
    }

    // Now look for the target
    for (; i < tokens.length; i++) {
      const token = tokens[i];
      // Skip shell redirects and their arguments
      if (token === ">" || token === ">>" || token === "<") {
        i++; // skip the file argument
        continue;
      }
      // Stop at command separators
      if (token === "|" || token === ";" || token === "&" || token === "&&" || token === "||") {
        break;
      }
      // Found a potential file/directory target
      return token;
    }

    return "";
  }

  _flagExpectsArgument(flag) {
    // Flags that already include an argument via '=' don't need another
    if (flag.includes("=")) {
      return false;
    }
    // Known flags that take an argument
    const argumentFlags = new Set([
      "-m", "-c", "-o", "-O", "-C", "-I", "-L", "-t", "-d", "-e", "-f",
      "--message", "--output", "--directory", "--file", "--commit", "--tree",
      "--author", "--date", "--format", "--sort", "--filter", "--contains"
    ]);
    if (argumentFlags.has(flag)) {
      return true;
    }
    // Double-dash flags generally expect an argument (simplification)
    if (flag.startsWith("--")) {
      return true;
    }
    // Single hyphen with a single letter - assume NO argument unless in set
    // Combined short flags (-la, -rf) do not expect an argument
    return false;
  }

  isInternalCommand(commandText) {
    const firstWord = commandText.trim().split(/\s+/)[0].toLowerCase();
    return ["read", "delete", "write", "replace", "file-size"].includes(firstWord);
  }

  parseInternalCommand(commandText) {
    return parseInternalCommandExternal(commandText);
  }

  executeInternalCommand(commandObj) {
    return executeInternalCommandExternal(commandObj, this.workingDirectory);
  }

  parseAIResponse(response) {
    const actions = [];
    const agentLineRegex = /^agent\s+(\w+)\s*:?\s*(.*)$/i;
    const diagnostics = {
      unclosedBlocks: [],
    };

    const flushCommentLines = (lines) => {
      if (!lines.length) {
        return;
      }
      const text = lines.join("\n").trim();
      if (text) {
        actions.push({ type: "comment", content: text });
      }
      lines.length = 0;
    };

    const appendChatSegment = (segment) => {
      if (!segment) {
        return;
      }

      const lines = segment.split("\n");
      const commentBuffer = [];

      for (const rawLine of lines) {
        const normalized = rawLine.trim();
        if (!normalized) {
          flushCommentLines(commentBuffer);
          continue;
        }

        const agentMatch = normalized.match(agentLineRegex);
        if (agentMatch) {
          flushCommentLines(commentBuffer);
          actions.push({
            type: "agent",
            agentId: agentMatch[1],
            message: (agentMatch[2] || "").trim(),
          });
          continue;
        }

        commentBuffer.push(normalized);
      }

      flushCommentLines(commentBuffer);
    };

    let cursor = 0;
    while (cursor < response.length) {
      const start = response.indexOf(">>>", cursor);
      if (start === -1) {
        appendChatSegment(response.substring(cursor));
        break;
      }

      appendChatSegment(response.substring(cursor, start));

      const end = response.indexOf("<<<", start + 3);
      if (end === -1) {
        diagnostics.unclosedBlocks.push({
          startIndex: start,
          preview: response.substring(
            start,
            Math.min(response.length, start + 200),
          ),
        });
        appendChatSegment(response.substring(start));
        break;
      }

      const commandText = response.substring(start + 3, end).trim();
      if (commandText) {
        if (this.isInternalCommand(commandText)) {
          const parsed = this.parseInternalCommand(commandText);
          if (parsed.error) {
            actions.push({
              type: "comment",
              content: `❌ Invalid internal command: ${parsed.error}`
            });
          } else {
            actions.push({
              type: "internal",
              content: commandText,
              commandObj: parsed
            });
          }
        } else {
          actions.push({
            type: "shell",
            content: commandText,
            commandCategory: this.classifyCommand(commandText),
            commandTarget: this.extractCommandTarget(commandText)
          });
        }
      }
      cursor = end + 3;
    }

    const commands = actions
      .filter((action) => action.type === "shell" || action.type === "internal")
      .map((action) => action.content);

    let type = "comment";
    let commandCategory = null;
    let commandTarget = "";

    const commandActions = actions.filter((action) => action.type === "shell" || action.type === "internal");
    if (commandActions.length > 0) {
      type = "command";
      const firstAction = commandActions[0];
      if (firstAction.type === "internal") {
        commandCategory = "internal";
        commandTarget = firstAction.commandObj?.filePath || "";
      } else {
        commandCategory = this.classifyCommand(firstAction.content);
        commandTarget = this.extractCommandTarget(firstAction.content);
      }
    } else if (actions.some((action) => action.type === "agent")) {
      type = "agent";
    }

    return {
      type,
      commandCategory,
      commandTarget,
      command: commands[0] || null,
      commands,
      actions,
      fullResponse: response,
      diagnostics,
    };
  }

  createSummaryPrompt(command, success, output, error) {
    const lines = [
      `Command: ${command}`,
      `Result: ${success ? "SUCCESS" : "FAILED"}`,
    ];

    if (error) {
      lines.push(`YOUR LAST COMMAND FAILED: ${error}`);
    }

    lines.push("Output:");
    const outputLines = (output || "No output").split("\n");
    lines.push(...outputLines);
    lines.push("", "Next command? Remember to wrap it between >>> and <<<.");

    return lines.join("\n").trimEnd();
  }

  findUnterminatedHeredoc(command) {
    const heredocPattern = /<<\s*(['"]?)([A-Za-z0-9_]+)\1/g;
    const pendingMarkers = [];

    let match;
    while ((match = heredocPattern.exec(command)) !== null) {
      const marker = match[2];
      if (marker) {
        const markerRegex = new RegExp(`^${marker}$`, "m");
        if (!markerRegex.test(command.substring(match.index))) {
          pendingMarkers.push(marker);
        }
      }
    }

    if (pendingMarkers.length === 0) {
      return null;
    }

    const uniqueMarkers = [...new Set(pendingMarkers)];
    return `❌ Unterminated heredoc marker(s): ${uniqueMarkers.join(", ")}. Complete the command with the closing marker before executing.`;
  }
}
