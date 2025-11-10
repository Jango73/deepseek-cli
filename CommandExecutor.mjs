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

        // SECURITY FIX: Use execFile to prevent command injection
        const args = ["-c", trimmedCommand];
        const childProcess = execFile("/bin/sh", args, { timeout: 60000, cwd: this.workingDirectory }, (error, stdout, stderr) => {
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
    
    // Look for command lines starting with '>>'
    let commandLine = null;
    let commentContent = [];
    
    for (const line of lines) {
      if (line.startsWith('>>')) {
        // Found a command, extract the part after '>>'
        commandLine = line.substring(2).trim();
        break;
      } else {
        // Add to comment part
        commentContent.push(line);
      }
    }
    
    // Clean comment content (remove empty lines at the beginning)
    while (commentContent.length > 0 && commentContent[0] === '') {
      commentContent.shift();
    }
    
    const cleanComment = commentContent.join('\n');
    
    if (commandLine === null) {
      // No command found, it's just a comment
      return {
        type: 'comment',
        content: cleanComment,
        command: null,
        fullResponse: response
      };
    }
    
    // A command was found
    return {
      type: 'command',
      command: commandLine,
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
