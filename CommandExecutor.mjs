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
    if (!line) return false;
    if (this.isLikelyComment(line)) return false;
    
    // Continue si la ligne se termine par un backslash (continuation)
    if (line.endsWith('\\')) return true;
    
    // Vérifier si nous sommes dans un contexte heredoc
    const heredocMarker = this.getCurrentHeredocMarker(currentCommandLines);
    if (heredocMarker && line.trim() !== heredocMarker) {
      return true; // On est toujours dans le heredoc
    }
    
    return false;
  }

  separateCommentsAndCommands(lines) {
    let commentLines = [];
    let commandLines = [];
    let inCommandBlock = false;
    let inHeredoc = false;
    let heredocMarker = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('>>')) {
        inCommandBlock = true;
        const commandContent = trimmedLine.substring(2).trim();
        if (commandContent) commandLines.push(commandContent);
        
        // Vérifier si cette commande commence un heredoc
        if (commandContent.includes('<<')) {
          const match = commandContent.match(/<<\s*['"]?(\w+)['"]?/);
          if (match) {
            inHeredoc = true;
            heredocMarker = match[1];
          }
        }
      } 
      else if (inCommandBlock && (this.shouldContinueCommandBlock(trimmedLine, commandLines) || inHeredoc)) {
        commandLines.push(trimmedLine);
        
        // Vérifier si c'est la fin du heredoc
        if (inHeredoc && trimmedLine === heredocMarker) {
          inHeredoc = false;
          heredocMarker = null;
        }
      }
      else {
        inCommandBlock = false;
        inHeredoc = false;
        heredocMarker = null;
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
    
    // Reconstruire le commande en gérant les heredocs
    let reconstructed = '';
    let inHeredoc = false;
    let heredocMarker = null;
    
    for (let i = 0; i < commandLines.length; i++) {
      const line = commandLines[i];
      
      if (i > 0) {
        reconstructed += '\n';
      }
      reconstructed += line;
      
      // Détecter le début d'un heredoc
      if (!inHeredoc && line.includes('<<')) {
        const match = line.match(/<<\s*['"]?(\w+)['"]?/);
        if (match) {
          inHeredoc = true;
          heredocMarker = match[1];
        }
      }
      
      // Détecter la fin d'un heredoc
      if (inHeredoc && line.trim() === heredocMarker) {
        inHeredoc = false;
        heredocMarker = null;
      }
    }
    
    return reconstructed;
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