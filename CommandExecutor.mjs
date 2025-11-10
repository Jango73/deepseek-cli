import { exec } from 'child_process';

export class CommandExecutor {
  constructor(workingDirectory, forbiddenCommands) {
    this.workingDirectory = workingDirectory;
    this.forbiddenCommands = new Set(forbiddenCommands.map(cmd => cmd.toLowerCase()));
    this.currentExecution = null;
  }

  isCommandForbidden(command) {
    const cleanCommand = command.split('#')[0].trim().toLowerCase();
    return Array.from(this.forbiddenCommands).some(forbidden => 
      cleanCommand === forbidden || cleanCommand.startsWith(forbidden + " ")
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

      const childProcess = exec(trimmedCommand, { timeout: 60000, cwd: this.workingDirectory }, (error, stdout, stderr) => {
        this.currentExecution = null;
        
        const output = stdout + stderr;
        const success = error === null;

        if (error) {
          console.log(`🔴 Exit code: ${error.code}`);
          console.log(`🔴 Error: ${error.message}`);
        }

        if (stderr && stderr.trim()) {
        }

        resolve({ success, output, error: error ? error.message : null });
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
    const lines = response.split('\n').map(line => line.trim());
    
    // Check if the entire response is a comment (all lines start with # or are empty)
    const isPureComment = lines.length > 0 && 
                         lines.every(line => line.startsWith('#') || line === '');
    
    if (isPureComment) {
      return {
        type: 'comment',
        content: lines.map(line => line.startsWith('#') ? line.substring(1).trim() : line)
                     .filter(line => line !== '')
                     .join('\n'),
        command: null
      };
    }
    
    // Find command line and comment lines
    let commandLine = null;
    let commentLines = [];
    let inCommentBlock = false;
    
    for (const line of lines) {
      if (line.startsWith('#') && commandLine === null) {
        // Comment before command - part of the comment block
        commentLines.push(line.substring(1).trim());
        inCommentBlock = true;
      } else if (line === '' && inCommentBlock && commandLine === null) {
        // Empty line in comment block - preserve as part of comment
        commentLines.push('');
      } else if (line && commandLine === null) {
        // First non-comment, non-empty line is the command
        commandLine = line;
        inCommentBlock = false;
      } else if (line.startsWith('#') && commandLine !== null) {
        // Comment after command - stop parsing, these are preserved as context
        break;
      } else if (line && commandLine !== null) {
        // Non-comment line after command - this should be part of the command context
        // but we break to avoid mixing command with additional text
        break;
      }
    }
    
    if (commandLine === null) {
      return {
        type: 'comment',
        content: commentLines.join('\n'),
        command: null
      };
    }
    
    return {
      type: 'command',
      command: commandLine,
      preComment: commentLines.length > 0 ? commentLines.join('\n') : null,
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