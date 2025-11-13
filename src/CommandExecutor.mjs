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

          console.log(`🔧 Executing: ${trimmedCommand}`);

          const args = ["-c", trimmedCommand];
          const childProcess = execFile("/bin/sh", args, { 
              timeout: 60000, 
              cwd: this.workingDirectory 
          }, (error, stdout, stderr) => {
              this.currentExecution = null;
              
              const output = stdout + stderr;
              const success = error === null;

              console.log(`🔧 Command output: ${output}`);

              if (error) {
                  console.log(`🔴 Exit code: ${error.code}`);
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

  isLikelyComment(line) {
    return false;
  }

  getCurrentHeredocMarker(commandLines) {
    let heredocMarker = null;
    
    for (const cmd of commandLines) {
      // Détecter le début d'un heredoc
      const heredocMatch = cmd.match(/<<\s*['"]?(\w+)['"]?/);
      if (heredocMatch) {
        heredocMarker = heredocMatch[1];
      }
      
      // Si on trouve le marqueur de fin, reset
      if (heredocMarker && cmd.trim() === heredocMarker) {
        heredocMarker = null;
      }
    }
    
    return heredocMarker;
  }

  shouldContinueCommandBlock(line, currentCommandLines) {
    const heredocMarker = this.getCurrentHeredocMarker(currentCommandLines);
    if (heredocMarker) {
      const lastLine = currentCommandLines[currentCommandLines.length - 1];
      return lastLine.trim() !== heredocMarker;
    }

    if (!line) return false;
    if (this.isLikelyComment(line)) return false;
    
    // Continue si la ligne se termine par un backslash (continuation)
    if (line.trim().endsWith('\\')) return true;
    
    return false;
  }

  separateCommentsAndCommands(lines) {
    const commentLines = [];
    const commands = [];
    let currentCommandLines = [];
    let collectingCommand = false;

    const flushCommand = () => {
      if (currentCommandLines.length === 0) {
        return;
      }
      commands.push(this.reconstructMultilineCommand(currentCommandLines));
      currentCommandLines = [];
      collectingCommand = false;
    };

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('>>')) {
        if (collectingCommand) {
          flushCommand();
        }

        const commandContent = trimmedLine.substring(2).trim();
        if (!commandContent) {
          continue;
        }

        currentCommandLines.push(commandContent);
        const needsContinuation = this.shouldContinueCommandBlock(
          commandContent,
          currentCommandLines
        );

        if (!needsContinuation) {
          flushCommand();
        } else {
          collectingCommand = true;
        }

        continue;
      }

      if (collectingCommand) {
        currentCommandLines.push(line);
        const needsContinuation = this.shouldContinueCommandBlock(
          line,
          currentCommandLines
        );
        if (!needsContinuation) {
          flushCommand();
        }
        continue;
      }

      commentLines.push(line);
    }

    if (collectingCommand) {
      flushCommand();
    }

    return { commentLines, commands };
  }

  cleanCommentLines(commentLines) {
    const cleaned = [...commentLines];
    while (cleaned.length > 0 && cleaned[0] === '') {
      cleaned.shift();
    }
    return cleaned.join('\n');
  }

  reconstructMultilineCommand(commandLines) {
    if (commandLines.length === 0) return null;
    
    let reconstructed = '';
    
    for (let i = 0; i < commandLines.length; i++) {
      if (i > 0) {
        reconstructed += '\n';
      }
      reconstructed += commandLines[i];
    }
    
    return reconstructed;
  }

  parseAIResponse(response) {
    const lines = response.split('\n');
    
    const { commentLines, commands } = this.separateCommentsAndCommands(lines);
    const cleanComment = this.cleanCommentLines(commentLines);
    if (!commands.length) {
      const trimmedResponse = response.trim();
      if (trimmedResponse.length === 0) {
        return {
          type: 'comment',
          content: cleanComment,
          command: null,
          fullResponse: response
        };
      }
      
      if (trimmedResponse.includes('\n')) {
        return {
          type: 'comment',
          content: cleanComment,
          command: null,
          fullResponse: response
        };
      }

      return {
        type: 'command',
        command: trimmedResponse,
        commands: [trimmedResponse],
        preComment: null,
        fullResponse: response
      };
    }
    
    const combinedCommand = commands.join('\n');
    
    return {
      type: 'command',
      command: combinedCommand,
      commands,
      preComment: cleanComment || null,
      fullResponse: response
    };
  }

  createSummaryPrompt(command, success, output, error) {
    let resultText = `Command: ${command}\n`;
    resultText += `Result: ${success ? 'SUCCESS' : 'FAILED'}\n`;
    if (error) {
      resultText += `Error: ${error}\n`;
    }
    resultText += `Output: ${output}\n\nNext command?`;
    return resultText;
  }
}
