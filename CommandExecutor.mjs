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
        console.log('⏸️ Pause requested by AI');
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
          console.log(`🔴 Stderr: ${stderr}`);
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
    
    if (lines.length > 0 && lines[0].startsWith('#') && lines.every(line => line.startsWith('#') || line === '')) {
      return {
        type: 'comment',
        content: lines.map(line => line.substring(1).trim()).join('\n'),
        command: null
      };
    }
    
    let commandLine = null;
    let commentLines = [];
    
    for (const line of lines) {
      if (line.startsWith('#') && commandLine === null) {
        commentLines.push(line.substring(1).trim());
      } else if (line && commandLine === null) {
        commandLine = line;
      } else if (line.startsWith('#') && commandLine !== null) {
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