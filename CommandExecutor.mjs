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

  isLikelyComment(line) {
    return false;
  }

  shouldContinueCommandBlock(line, currentCommandLines) {
    if (!line) return false;
    if (this.isLikelyComment(line)) return false;
    
    // Continue if line ends with line continuation or is part of heredoc
    if (line.endsWith('\\')) return true;
    if (line.includes('<<') && !line.includes('EOF')) return true;
    
    // Check if we're in a heredoc context
    const hasUnclosedHeredoc = currentCommandLines.some(cmd => 
      cmd.includes('<<') && !currentCommandLines.some(c => c.trim() === 'EOF')
    );
    
    return hasUnclosedHeredoc;
  }

  separateCommentsAndCommands(lines) {
    let commentLines = [];
    let commandLines = [];
    let inCommandBlock = false;

    for (const line of lines) {
      if (line.startsWith('>>')) {
        inCommandBlock = true;
        const commandContent = line.substring(2).trim();
        if (commandContent) commandLines.push(commandContent);
      } else if (inCommandBlock && this.shouldContinueCommandBlock(line, commandLines)) {
        commandLines.push(line);
      } else {
        inCommandBlock = false;
        commentLines.push(line);
      }
    }

    return { commentLines, commandLines };
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
    return commandLines.join('\n');
  }

  parseAIResponse(response) {
    const lines = response.split('\n').map(line => line.trim());
    
    const { commentLines, commandLines } = this.separateCommentsAndCommands(lines);
    const cleanComment = this.cleanCommentLines(commentLines);
    const fullCommand = this.reconstructMultilineCommand(commandLines);
    
    if (!fullCommand) {
      return {
        type: 'comment',
        content: cleanComment,
        command: null,
        fullResponse: response
      };
    }
    
    return {
      type: 'command',
      command: fullCommand,
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
