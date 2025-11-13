import { exec, execFile } from "child_process";

export class CommandExecutor {
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

  killCurrentProcess() {
    if (this.currentExecution) {
      this.currentExecution.kill('SIGTERM');
      this.currentExecution = null;
    }
  }

  parseAIResponse(response) {
    const preferCodeBlocks = response.includes('```');
    const summaryPrefixes = ['command:', 'output:', 'result:', 'success:', 'error:'];
    const lines = response.split('\n');
    const actions = [];
    let currentScriptLines = [];
    let pendingCommentLines = [];
    let inCodeBlock = false;

    const flushScript = () => {
      if (currentScriptLines.length === 0) {
        return;
      }
      const script = currentScriptLines.join('\n').trim();
      if (script) {
        actions.push({ type: 'shell', content: script });
      }
      currentScriptLines = [];
    };

    const flushComment = () => {
      if (pendingCommentLines.length === 0) {
        return;
      }
      const text = pendingCommentLines.join('\n').trim();
      if (text) {
        actions.push({ type: 'comment', content: text });
      }
      pendingCommentLines = [];
    };

    const pushCommentLine = (text) => {
      if (text === null || text === undefined) {
        return;
      }
      pendingCommentLines.push(text);
    };

    const handleAgentLine = (trimmedLine) => {
      const agentMatch = trimmedLine.match(/^agent\s+(\w+)\s*:?\s*(.+)?$/i);
      if (!agentMatch) {
        return false;
      }
      flushComment();
      flushScript();
      actions.push({
        type: 'agent',
        agentId: agentMatch[1],
        message: (agentMatch[2] || '').trim()
      });
      return true;
    };

    const isSummaryLine = (trimmedLine) => {
      if (!trimmedLine) return false;
      const normalized = trimmedLine.toLowerCase();
      return summaryPrefixes.some(prefix => normalized.startsWith(prefix));
    };

    const handleLineContent = (text) => {
      if (!text && !inCodeBlock) {
        flushComment();
        return;
      }

      const trimmedLine = text.trim();

      if (!inCodeBlock) {
        if (trimmedLine.startsWith('>>')) {
          flushComment();
          const comment = trimmedLine.substring(2).trim();
          if (comment) {
            actions.push({ type: 'comment', content: comment });
          }
          return;
        }

        if (handleAgentLine(trimmedLine)) {
          return;
        }

        if (isSummaryLine(trimmedLine)) {
          flushScript();
          pushCommentLine(trimmedLine);
          return;
        }

        if (preferCodeBlocks) {
          if (trimmedLine) {
            pushCommentLine(trimmedLine);
          } else {
            flushComment();
          }
        } else {
          flushComment();
          currentScriptLines.push(text);
        }
        return;
      }

      currentScriptLines.push(text);
    };

    for (const rawLine of lines) {
      let line = rawLine.replace(/\r$/, '');

      const processSegment = (segment) => {
        if (!segment.length) return;
        handleLineContent(segment);
      };

      while (true) {
        const fenceIndex = line.indexOf('```');
        if (fenceIndex === -1) {
          processSegment(line);
          break;
        }

        const beforeFence = line.substring(0, fenceIndex);
        processSegment(beforeFence);

        const afterFence = line.substring(fenceIndex + 3);

        if (!inCodeBlock) {
          flushComment();
          inCodeBlock = true;
          // Skip optional language hint immediately after the fence
          const langMatch = afterFence.match(/^[a-zA-Z0-9_-]+/);
          line = langMatch
            ? afterFence.substring(langMatch[0].length).replace(/^\s*/, '')
            : afterFence;
        } else {
          flushScript();
          inCodeBlock = false;
          line = afterFence;
        }
      }
    }

    flushScript();
    flushComment();

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
      fullResponse: response
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
    lines.push('', 'Next command?');

    return lines
      .map(line => `>> ${line}`)
      .join('\n')
      .trimEnd();
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
