#!/usr/bin/env node

import { exec } from 'child_process';
import fs from 'fs';
import readline from 'readline';

class DeepSeekCLI {
  constructor(apiKey, workingDir) {
    this.scriptDirectory = process.cwd();
    this.workingDirectory = workingDir;
    this.configFile = `${this.scriptDirectory}/.deepseek_config.json`;
    this.sessionFile = `${this.workingDirectory}/.deepseek_session.json`;
    
    // Load configuration
    const config = this.loadConfig();
    
    // Use provided API key or fallback to config
    if (apiKey) {
      this.apiKey = apiKey;
    } else if (config.apiKey) {
      this.apiKey = config.apiKey;
    } else {
      console.error('❌ No API key provided');
      process.exit(1);
    }
    
    this.conversationHistory = [];
    this.fullHistory = [];
    this.alwaysYes = false;
    this.forbiddenCommands = this.loadForbiddenCommands(config.forbiddenCommands);
    this.alwaysApprovedCommands = new Set();
    this.isInterrupted = false;

    // Configuration for conversation size management
    this.maxConversationLength = 90; // Maximum messages before warning
    this.criticalConversationLength = 100; // Critical size where compaction is strongly recommended    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.loadSession();
    this.setupKeypressListener();
  }

  setupKeypressListener() {
    // Raw mode to capture individual keys
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
    
    this.keypressHandler = (key) => {
      // Escape or Ctrl+C
      if (key === '\u001b' || key === '\u0003') {
        if (!this.isInterrupted) {
          this.isInterrupted = true;
          console.log('\n🛑 INTERRUPTION REQUESTED - Stopping current operation...');
          
          // Force stop any ongoing execution
          if (this.currentExecution) {
            this.currentExecution.kill('SIGTERM');
          }
        }
      }
    };
    
    process.stdin.on('data', this.keypressHandler);
  }

  removeKeypressListener() {
    process.stdin.removeListener('data', this.keypressHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  loadConfig() {
    const config = {
      apiKey: null,
      forbiddenCommands: []
    };
    
    try {
      if (fs.existsSync(this.configFile)) {
        const fileContent = fs.readFileSync(this.configFile, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        
        config.apiKey = fileConfig.apiKey || null;
        config.forbiddenCommands = fileConfig.forbiddenCommands || [];
      } else {
        console.log('⚠️ Config file does not exist!');
      }
    } catch (error) {
      console.log('⚠️ Config file error:', error.message);
    }
    
    return config;
  }

  showSessionStatus() {
    const historyCount = this.conversationHistory.length;
    const stepsCount = this.fullHistory.length;
    
    if (historyCount === 0) {
      console.log('🆕 New session - no conversation history');
    } else {
      console.log('📁 Current session:');
      console.log(`   Conversation: ${historyCount} messages`);
      console.log(`   Command history: ${stepsCount} steps`);
      
      // Show last user message for context
      const lastUserMsg = this.conversationHistory
        .filter(msg => msg.role === 'user')
        .pop();
      if (lastUserMsg) {
        console.log(`   Last task: "${this.truncateOutput(lastUserMsg.content, 1)}"`);
      }
    }
  }

  loadForbiddenCommands(configForbiddenCommands = []) {
    const defaultForbidden = [
      'rm -rf /', 'rm -rf /*', 'rm -rf .', 'rm -rf *',
      'dd if=/dev/random', 'mkfs', 'fdisk', ':(){ :|:& };:',
      'chmod -R 000', 'chown -R root:root', 'mv / /dev/null',
      '> /dev/sda', 'dd if=/dev/zero'
    ];
    
    return [...defaultForbidden, ...configForbiddenCommands];
  }

  isCommandForbidden(command) {
    const cleanCommand = command.split('#')[0].trim().toLowerCase();
    return this.forbiddenCommands.some(forbidden => cleanCommand === forbidden.toLowerCase() || cleanCommand.startsWith(forbidden.toLowerCase() + " "));
  }

  loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.conversationHistory = data.conversationHistory || [];
        this.fullHistory = data.fullHistory || [];
        
        console.log('📁 Previous session loaded');
        this.showSessionStatus();
        return true;
      } else {
        console.log('🆕 New session - no previous session found');
        return false;
      }
    } catch (error) {
      this.conversationHistory = [];
      this.fullHistory = [];
      console.log('🆕 New session - error loading previous session');
      return false;
    }
  }

  saveSession() {
    try {
      const data = { 
        conversationHistory: this.conversationHistory,
        fullHistory: this.fullHistory
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Ignore save errors
    }
  }

  checkConversationSize() {
    const currentSize = this.conversationHistory.length;

    if (currentSize >= this.criticalConversationLength) {
      console.log('🚨 CRITICAL: Conversation is very long! Auto-compacting...');
      this.compactConversation();
      return 'critical';
    } else if (currentSize >= this.maxConversationLength) {
      console.log(`⚠️ WARNING: Conversation is getting long (${currentSize} messages), Will auto-compact at ${this.criticalConversationLength}`);
      return 'warning';
    }

    return 'normal';
  }

  compactConversation() {
    const totalMessages = this.conversationHistory.length;

    if (totalMessages <= 10) {
      console.log('ℹ️ Conversation already has less than 10 messages, no compaction needed');
      return false;
    }

    // Keep first 4 messages (system + beginning of conversation)
    const firstMessages = this.conversationHistory.slice(0, 4);

    // Keep last 6 messages
    const lastMessages = this.conversationHistory.slice(-6);

    // New compacted history
    this.conversationHistory = [...firstMessages, ...lastMessages];

    console.log(`✅ Conversation compacted: ${totalMessages} → ${this.conversationHistory.length} messages`);

    this.saveSession();
    return true;
  }

  truncateOutput(text, maxLines = 4) {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n') + `\n... [${lines.length - maxLines} more lines]`;
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

  // Smart parsing of AI response to handle comments properly
  parseAIResponse(response) {
    const lines = response.split('\n').map(line => line.trim());
    
    // Check if the entire response is a comment
    if (lines.length > 0 && lines[0].startsWith('#') && lines.every(line => line.startsWith('#') || line === '')) {
      return {
        type: 'comment',
        content: lines.map(line => line.substring(1).trim()).join('\n'),
        command: null
      };
    }
    
    // Find the first line that is not a comment and not empty
    let commandLine = null;
    let commentLines = [];
    
    for (const line of lines) {
      if (line.startsWith('#') && commandLine === null) {
        // Comment before command
        commentLines.push(line.substring(1).trim());
      } else if (line && commandLine === null) {
        // First non-comment, non-empty line is the command
        commandLine = line;
      } else if (line.startsWith('#') && commandLine !== null) {
        // Comment after command - these are preserved as part of the command context
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

  async askDeepSeek(prompt) {
    // Check conversation size before API call
    const sizeStatus = this.checkConversationSize();
    if (sizeStatus === 'critical') {
      console.log('⏸️ API call pending - conversation too long');
    }

    // Check interruption before starting
    if (this.isInterrupted) {
      throw new Error('INTERRUPTED_BY_USER');
    }

    // Read AGENTS.md from the working directory only at the beginning of a session
    let agentsContent = '';
    if (this.conversationHistory.length === 0) {
      try {
        // Use the project working directory, not the CLI directory
        const agentsPath = `${this.workingDirectory}/AGENTS.md`;
        if (fs.existsSync(agentsPath)) {
          agentsContent = fs.readFileSync(agentsPath, 'utf8');
          console.log('📖 Loaded AGENTS.md');
        }
      } catch (error) {
        // Ignore if AGENTS.md doesn't exist or can't be read
      }
    }

    const systemPrompt = `
You have access to the user's full codebase.
Your commands will run in a Linux shell.
${agentsContent ? `\nProject-specific context from AGENTS.md:\n${agentsContent}\n` : ''}

EDITING BEST PRACTICES:
- For simple edits: use sed with single-line commands
- For complex multi-line edits: create a patch file or use a proper editor
- Test your sed commands mentally before using them
- Prefer simple and robust approaches over clever one-liners
    
IMPORTANT RULES:
1. You may respond with EITHER a valid shell command that can be executed immediately OR a comment starting with #
2. Only one command per response, and the comment ALWAYS last
3. Commands must be specific and actionable
4. No markdown, no code blocks
5. DO NOT repeat a command that just failed
6. NEVER launch a tail command with no timeout, this can lead to infinite waits
7. NEVER use interactive tools
8. If you need to wait for the user to execute something before continuing, yield a "pause" command

Current directory: ${this.workingDirectory}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: prompt }
    ];

    try {
      // Check interruption before API request
      if (this.isInterrupted) {
        throw new Error('INTERRUPTED_BY_USER');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-coder',
          messages: messages,
          max_tokens: 1000,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Check interruption after API request
      if (this.isInterrupted) {
        throw new Error('INTERRUPTED_BY_USER');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`API Error: ${data.error.message}`);
      }
      
      if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid response format from API');
      }
      
      const result = data.choices[0].message.content;

      this.conversationHistory.push({ role: 'user', content: prompt });
      this.conversationHistory.push({ role: 'assistant', content: result });
      this.saveSession();

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ API request timeout');
      } else if (error.message === 'INTERRUPTED_BY_USER') {
        throw error; // Propagate interruption
      } else {
        console.error('❌ API call failed:', error.message);
      }
      throw error;
    }
  }

  executeCommand(command, preComment = null) {
    return new Promise((resolve) => {
      // Check interruption before execution
      if (this.isInterrupted) {
        resolve({ 
          success: false, 
          output: 'COMMAND_INTERRUPTED',
          error: 'Interrupted by user',
          interrupted: true
        });
        return;
      }

      const trimmedCommand = command.trim();

      // Handle "pause" command
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

      // Check if command is forbidden
      if (this.isCommandForbidden(trimmedCommand)) {
        resolve({ 
          success: false, 
          output: `❌ FORBIDDEN COMMAND: "${trimmedCommand}" is not allowed for safety reasons.`,
          error: 'Forbidden command'
        });
        return;
      }

      // Execute the command AS IS - no naive # parsing
      const childProcess = exec(trimmedCommand, { timeout: 60000, cwd: this.workingDirectory }, (error, stdout, stderr) => {
        // Clear reference
        this.currentExecution = null;
        
        const output = stdout + stderr;
        const success = error === null;

        // Display failures clearly
        if (error) {
          console.log(`🔴 Exit code: ${error.code}`);
          console.log(`🔴 Error: ${error.message}`);
        }

        if (stderr && stderr.trim()) {
          console.log(`🔴 Stderr: ${stderr}`);
        }

        resolve({ success, output, error: error ? error.message : null });
      });

      // Store reference to current process
      this.currentExecution = childProcess;

      // Check interruption periodically during execution
      const checkInterruption = setInterval(() => {
        if (this.isInterrupted) {
          clearInterval(checkInterruption);
          childProcess.kill('SIGTERM');
        }
      }, 100);
      
      childProcess.on('exit', () => {
        clearInterval(checkInterruption);
      });
    });
  }

  async executeTaskLoop(initialPrompt) {
    const maxIterations = 100;
    let currentPrompt = initialPrompt;
    let iteration = 1;
    let shouldBreak = false;

    while (iteration <= maxIterations && !shouldBreak && !this.isInterrupted) {
      console.log(`\n┌─── Step ${iteration} ─${'─'.repeat(Math.max(0, 8 - String(iteration).length))}┐`);

      try {
        const response = await this.askDeepSeek(currentPrompt);

        // Check interruption after API call
        if (this.isInterrupted) {
          console.log("🛑 Interruption confirmed - stopping task...");
          shouldBreak = true;
          break;
        }

        // Parse AI response intelligently
        const parsedResponse = this.parseAIResponse(response);

        if (parsedResponse.type === 'comment') {
          // Pure comment - display with comment icon only
          console.log(`💬 ${parsedResponse.content}`);
          currentPrompt = 'Comment noted. Continue with next command.';
          iteration++;
          continue;
        } else {
          // Command response - show with lightbulb only
          console.log(`💡 ${this.truncateOutput(parsedResponse.fullResponse)}`);
        }

        if (!parsedResponse.command || parsedResponse.command.length < 2) {
          console.log('❌ No valid command found');
          currentPrompt = 'Give me a valid shell command to execute';
          iteration++;
          continue;
        }

        // Execute command with proper parsing
        const result = await this.executeCommand(parsedResponse.command, null);

        // Check interruption after execution
        if (this.isInterrupted || result.interrupted) {
          console.log("🛑 Interruption confirmed - stopping task...");
          shouldBreak = true;
          break;
        }

        if (result.paused) {
          // Pause requested by AI - wait for user confirmation
          console.log('⏸️ AI is waiting for you to complete an action');
          const userInput = await new Promise((resolve) => {
            this.rl.question('✅ Press Enter when ready to continue, or type new instruction > ', resolve);
          });
          
          if (userInput.trim()) {
            // User provided new instruction
            currentPrompt = userInput;
          } else {
            // User just pressed Enter - continue with next command
            currentPrompt = 'Action completed. Continue with next command.';
          }
          
          iteration++;
          continue;
        }

        if (result.output) {
          console.log(`📋 Output:\n${this.truncateOutput(result.output)}`);
        }

        if (result.error) {
          console.log(`❌ Command failed: ${result.error}`);
        }

        // Save full history and create intelligent summary for next prompt
        this.fullHistory.push({
          command: parsedResponse.command,
          success: result.success,
          output: result.output,
          timestamp: new Date().toISOString()
        });

        currentPrompt = this.createSummaryPrompt(parsedResponse.command, result.success, result.output, result.error);
        iteration++;

      } catch (error) {
        if (error.message === 'INTERRUPTED_BY_USER') {
          console.log("🛑 Interruption confirmed - stopping task...");
          shouldBreak = true;
          break;
        } else {
          console.error(`❌ Error: ${error.message}`);
          currentPrompt = `Error: ${error.message}. What next?`;
          iteration++;
        }
      }
    }

    if (this.isInterrupted) {
      console.log('🔄 Returning to main prompt...');
      this.isInterrupted = false;
    } else if (!shouldBreak) {
      console.log(`\n✅ Task completed`);
    }
  }

  async askUserPrompt() {
    return new Promise((resolve) => {
      // Temporarily disable keypress listener for user input
      this.removeKeypressListener();
      
      this.rl.question('\n> ', (answer) => {
        // Re-enable listener after input
        this.setupKeypressListener();
        resolve(answer.trim());
      });
    });
  }

  async startInteractiveSession() {
    console.log('🔧 DeepSeek CLI');
    console.log('====================================');
    console.log(`📁 Working directory: ${this.workingDirectory}`);
    console.log('Press ESC or Ctrl+C at any time to interrupt current task');

    while (true) {
      try {
        // Reset interruption flag at the start of each task
        this.isInterrupted = false;
        
        const userPrompt = await this.askUserPrompt();
        
        if (!userPrompt) {
          continue;
        }

        if (userPrompt.toLowerCase() === '/quit' || userPrompt.toLowerCase() === '/exit') {
          break;
        }

        if (userPrompt.toLowerCase() === '/clear') {
          this.conversationHistory = [];
          this.fullHistory = [];
          this.saveSession();
          console.log('🧹 History cleared');
          continue;
        }

        if (userPrompt.toLowerCase() === '/help') {
          console.log(`
Commands:
- <task> : Execute debugging task
- /continue : Continue from last session
- /clear : Clear history
- /compact : Reduce conversation to last 10 messages
- /help : Show this help
- /quit | /exit : Quit
- /forbidden : Show forbidden commands
- /history : Show full command history
- /status : Show current session status

Interruption:
- Press ESC or Ctrl+C to interrupt any operation
- Works during API calls and command execution
          `);
          continue;
        }

        if (userPrompt.toLowerCase() === '/forbidden') {
          console.log('🚫 Forbidden commands:');
          this.forbiddenCommands.forEach(cmd => console.log(`  - ${cmd}`));
          continue;
        }

        if (userPrompt.toLowerCase() === '/history') {
          console.log('📜 Full command history:');
          this.fullHistory.forEach((entry, index) => {
            console.log(`\n--- Step ${index + 1} ---`);
            console.log(`Command: ${entry.command}`);
            console.log(`Result: ${entry.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Output: ${this.truncateOutput(entry.output)}`);
          });
          continue;
        }

        if (userPrompt.toLowerCase() === '/compact') {
          this.compactConversation();
          continue;
        }

        if (userPrompt.toLowerCase() === '/status') {
          this.showSessionStatus();
          // Also show conversation size
          const sizeStatus = this.checkConversationSize();
          if (sizeStatus === 'normal') {
            console.log(`📊 Conversation size: ${this.conversationHistory.length} messages (OK)`);
          }
          continue;
        }

        if (userPrompt.toLowerCase() === '/continue') {
          if (this.conversationHistory.length === 0) {
            console.log('❌ No session to continue - start a new task first');
            continue;
          }

          // Check size before continuing
          this.checkConversationSize();

          // Find the last user message to continue from there
          const lastUserMsg = [...this.conversationHistory]
            .reverse()
            .find(msg => msg.role === 'user');
            
          if (!lastUserMsg) {
            console.log('❌ No previous task to continue from');
            continue;
          }
          
          console.log(`🔄 Continuing from: "${this.truncateOutput(lastUserMsg.content, 1)}"`);
          
          // Use the last summary prompt or recreate it
          let continuePrompt;
          if (this.fullHistory.length > 0) {
            const lastEntry = this.fullHistory[this.fullHistory.length - 1];
            continuePrompt = this.createSummaryPrompt(
              lastEntry.command,
              lastEntry.success,
              lastEntry.output
            );
          } else {
            continuePrompt = 'Continue with the next command';
          }
          
          await this.executeTaskLoop(continuePrompt);
          continue;
        }

        // Regular task execution
        await this.executeTaskLoop(userPrompt);

      } catch (error) {
        console.error(`❌ Session error: ${error.message}`);
      }
    }

    // Cleanup before exit
    this.removeKeypressListener();
    this.rl.close();
    console.log('👋 Goodbye!');
  }
}

// Main
const main = async () => {
  // Arguments: [node, script, workingDir, apiKey]
  const workingDir = process.argv[2];
  const apiKey = process.argv[3];

  if (!workingDir) {
    console.log('Missing working directory');
    process.exit(1);
  }

  const cli = new DeepSeekCLI(apiKey, workingDir);
  await cli.startInteractiveSession();
};

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});