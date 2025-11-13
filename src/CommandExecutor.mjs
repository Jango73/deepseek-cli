import { execFile } from "child_process";
import fs from 'fs';
import path from 'path';

export class CommandExecutor {
  static MAX_COMMAND_LINES = 20;

  constructor(workingDirectory, forbiddenCommands) {
    this.workingDirectory = workingDirectory;
    this.forbiddenCommands = new Set(forbiddenCommands.map(cmd => cmd.toLowerCase()));
    this.currentExecution = null;
  }

  isCommandForbidden(command) {
    const cleanCommand = command.split('#')[0].trim().toLowerCase();
    return Array.from(this.forbiddenCommands).some(forbidden => 
      cleanCommand === forbidden || cleanCommand.startsWith(forbidden)
    );
  }

  executeCommand(command) {
      return new Promise((resolve) => {
          if (typeof command !== 'string') {
              resolve({
                  success: false,
                  output: '❌ Invalid command input',
                  error: 'INVALID_COMMAND'
              });
              return;
          }
          const trimmedCommand = command.trim();

          if (trimmedCommand.toLowerCase() === 'pause' || trimmedCommand.toLowerCase() === 'exit') {
              resolve({ 
                  success: true, 
                  output: 'PAUSE: Waiting for user action. Continue when ready.',
                  paused: true
              });
              return;
          }

          if (!trimmedCommand) {
              resolve({ 
                  success: false, 
                  output: '❌ Empty command',
                  error: 'Empty command'
              });
              return;
          }

          if (this.isCommandForbidden(trimmedCommand)) {
              resolve({ 
                  success: false, 
                  output: `❌ FORBIDDEN COMMAND: "${trimmedCommand}" is not allowed for safety reasons.`,
                  error: 'Forbidden command'
              });
              return;
          }

          const heredocError = this.findUnterminatedHeredoc(trimmedCommand);
          if (heredocError) {
              resolve({
                  success: false,
                  output: heredocError,
                  error: 'Unterminated heredoc'
              });
              return;
          }

          const heredocResult = this.tryHandleHeredocCommand(command);
          if (heredocResult) {
            resolve(heredocResult);
            return;
          }

          const commandLines = command.split('\n');
          if (commandLines.length > CommandExecutor.MAX_COMMAND_LINES) {
            resolve({
              success: false,
              output: `⚠️ Command skipped: ${commandLines.length} lines detected (max ${CommandExecutor.MAX_COMMAND_LINES}). Split the script into smaller blocks.`,
              error: 'COMMAND_TOO_LONG',
              lineCount: commandLines.length
            });
            return;
          }

          const args = ["-c", trimmedCommand];
          const childProcess = execFile("/bin/sh", args, { 
              timeout: 60000, 
              cwd: this.workingDirectory 
          }, (error, stdout, stderr) => {
              this.currentExecution = null;
              
              const output = stdout + stderr;
              const success = error === null;

              if (error) {
                  console.error(`🔴 Command failed with exit code ${error.code}`);
              }

              resolve({ 
                  success, 
                  output: output || 'No output',
                  error: error ? error.message : null 
              });
          });

          this.currentExecution = childProcess;
      });
  }

  tryHandleHeredocCommand(command) {
    const lines = command.split('\n');
    if (lines.length === 0) {
      return null;
    }

    const firstLine = lines[0].trim();
    const heredocMatch = firstLine.match(/^cat\s+(>?>)\s+(.+?)\s+<<\s*(['"]?)([A-Za-z0-9_-]+)\3\s*$/);
    if (!heredocMatch) {
      return null;
    }

    const operator = heredocMatch[1];
    let targetPath = heredocMatch[2].trim();
    if ((targetPath.startsWith('"') && targetPath.endsWith('"')) || (targetPath.startsWith("'") && targetPath.endsWith("'"))) {
      targetPath = targetPath.substring(1, targetPath.length - 1);
    }
    const terminator = heredocMatch[4];

    const closingIndex = lines.findIndex((line, idx) => idx > 0 && line.replace(/\r$/, '') === terminator);
    if (closingIndex === -1) {
      return {
        success: false,
        output: `❌ Unterminated heredoc marker "${terminator}". Complete the block before executing.`,
        error: 'UNTERMINATED_HEREDOC'
      };
    }

    const contentLines = lines.slice(1, closingIndex);
    let content = contentLines.join('\n');
    if (content.length && !content.endsWith('\n')) {
      content += '\n';
    }

    try {
      const absolutePath = path.isAbsolute(targetPath)
        ? targetPath
        : path.join(this.workingDirectory, targetPath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      if (operator === '>>') {
        fs.appendFileSync(absolutePath, content);
      } else {
        fs.writeFileSync(absolutePath, content);
      }
      return {
        success: true,
        output: `✅ Wrote ${contentLines.length} line(s) to ${targetPath}`,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        output: `❌ Failed to write file: ${error.message}`,
        error: 'HEREDOC_WRITE_FAILED'
      };
    }
  }

  killCurrentProcess() {
    if (this.currentExecution) {
      this.currentExecution.kill('SIGTERM');
      this.currentExecution = null;
    }
  }

  parseAIResponse(response) {
    const actions = [];
    const agentLineRegex = /^agent\s+(\w+)\s*:?\s*(.*)$/i;
    const diagnostics = {
      unclosedBlocks: []
    };

    const flushCommentLines = (lines) => {
      if (!lines.length) {
        return;
      }
      const text = lines.join('\n').trim();
      if (text) {
        actions.push({ type: 'comment', content: text });
      }
      lines.length = 0;
    };

    const appendChatSegment = (segment) => {
      if (!segment) {
        return;
      }

      const lines = segment.split('\n');
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
            type: 'agent',
            agentId: agentMatch[1],
            message: (agentMatch[2] || '').trim()
          });
          continue;
        }

        commentBuffer.push(normalized);
      }

      flushCommentLines(commentBuffer);
    };

    let cursor = 0;
    while (cursor < response.length) {
      const start = response.indexOf('>>>', cursor);
      if (start === -1) {
        appendChatSegment(response.substring(cursor));
        break;
      }

      appendChatSegment(response.substring(cursor, start));

      const end = response.indexOf('<<<', start + 3);
      if (end === -1) {
        diagnostics.unclosedBlocks.push({
          startIndex: start,
          preview: response.substring(start, Math.min(response.length, start + 200))
        });
        appendChatSegment(response.substring(start));
        break;
      }

      const commandText = response.substring(start + 3, end).trim();
      if (commandText) {
        actions.push({ type: 'shell', content: commandText });
      }
      cursor = end + 3;
    }

    const commands = actions
      .filter(action => action.type === 'shell')
      .map(action => action.content);

    let type = 'comment';
    if (commands.length > 0) {
      type = 'command';
    } else if (actions.some(action => action.type === 'agent')) {
      type = 'agent';
    }

    return {
      type,
      command: commands[0] || null,
      commands,
      actions,
      fullResponse: response,
      diagnostics
    };
  }

  createSummaryPrompt(command, success, output, error) {
    const lines = [
      `Command: ${command}`,
      `Result: ${success ? 'SUCCESS' : 'FAILED'}`
    ];

    if (error) {
      lines.push(`Error: ${error}`);
    }

    lines.push('Output:');
    const outputLines = (output || 'No output').split('\n');
    lines.push(...outputLines);
    lines.push('', 'Next command? Remember to wrap it between >>> and <<<.');

    return lines.join('\n').trimEnd();
  }

  findUnterminatedHeredoc(command) {
    const heredocPattern = /<<\s*(['"]?)([A-Za-z0-9_]+)\1/g;
    const pendingMarkers = [];

    let match;
    while ((match = heredocPattern.exec(command)) !== null) {
      const marker = match[2];
      if (marker) {
        const markerRegex = new RegExp(`^${marker}$`, 'm');
        if (!markerRegex.test(command.substring(match.index))) {
          pendingMarkers.push(marker);
        }
      }
    }

    if (pendingMarkers.length === 0) {
      return null;
    }

    const uniqueMarkers = [...new Set(pendingMarkers)];
    return `❌ Unterminated heredoc marker(s): ${uniqueMarkers.join(', ')}. Complete the command with the closing marker before executing.`;
  }
}
