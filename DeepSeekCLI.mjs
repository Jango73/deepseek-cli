#!/usr/bin/env node
import dotenv from "dotenv";

import readline from 'readline';
import fs from 'fs';
import { DeepSeekAPI } from './DeepSeekAPI.mjs';
import { SessionManager } from './SessionManager.mjs';
import { CommandExecutor } from './CommandExecutor.mjs';
import { ConversationManager } from './ConversationManager.mjs';

class DeepSeekCLI {
  constructor(apiKey, workingDir) {
    this.scriptDirectory = process.cwd();
    this.workingDirectory = workingDir;
    this.configFile = `${this.scriptDirectory}/.deepseek_config.json`;
    
    const config = this.loadConfig();
    
    if (apiKey) {
      this.apiKey = apiKey;
    } else if (config.apiKey) {
      this.apiKey = config.apiKey;
    } else {
      console.error('❌ No API key provided');
      process.exit(1);
    }
    
    this.systemPrompt = config.systemPrompt;
    this.alwaysYes = false;
    this.isInterrupted = false;

    this.deepSeekAPI = new DeepSeekAPI(this.apiKey);
    this.sessionManager = new SessionManager(this.workingDirectory);
    this.commandExecutor = new CommandExecutor(this.workingDirectory, this.loadForbiddenCommands(config.forbiddenCommands));
    this.conversationManager = new ConversationManager(this.sessionManager, this.deepSeekAPI);
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.sessionManager.loadSession();
    this.setupKeypressListener();
  }

  loadConfig() {
    dotenv.config();
    const config = {
      apiKey: null,
      forbiddenCommands: [],
      systemPrompt: ''
    };
    
    try {
      if (fs.existsSync(this.configFile)) {
        const fileContent = fs.readFileSync(this.configFile, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        
        config.apiKey = process.env.DEEPSEEK_API_KEY || fileConfig.apiKey || null;
        config.forbiddenCommands = fileConfig.forbiddenCommands || [];
        config.systemPrompt = fileConfig.systemPrompt ? fileConfig.systemPrompt.join('\n') : "";
      } else {
        console.log('⚠️ Config file does not exist!');
      }
    } catch (error) {
      console.log('⚠️ Config file error:', error.message);
    }
    
    return config;
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

  setupKeypressListener() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
    
    this.keypressHandler = (key) => {
      if (key === '\u001b' || key === '\u0003') {
        if (!this.isInterrupted) {
          this.isInterrupted = true;
          console.log('\n🛑 INTERRUPTION REQUESTED - Stopping current operation...');
          this.commandExecutor.killCurrentProcess();
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

  async executeTaskLoop(initialPrompt) {
    // Store the initial prompt as session description
    if (this.sessionManager.getInitialPrompt() === '' && initialPrompt) {
      this.sessionManager.setInitialPrompt(initialPrompt);
    }

    const maxIterations = 100;
    let currentPrompt = initialPrompt;
    let iteration = 1;
    let shouldBreak = false;
    let needsCompaction = false;
    
    const initialSizeStatus = this.conversationManager.checkConversationSize();
    if (initialSizeStatus === "needs_compact") {
      needsCompaction = true;
    }

    while (iteration <= maxIterations && !shouldBreak && !this.isInterrupted) {
      if (needsCompaction) {
        try {
          await this.conversationManager.compactConversationWithAI();
          needsCompaction = false;
        } catch (error) {
          needsCompaction = false;
        }
      }

      try {
        console.log("");

        const response = await this.conversationManager.askDeepSeek(
          currentPrompt, 
          this.workingDirectory, 
          this.systemPrompt
        );

        const sizeStatusAfterAPI = this.conversationManager.checkConversationSize();
        if (sizeStatusAfterAPI === "needs_compact") {
          needsCompaction = true;
        }

        if (this.isInterrupted) {
          console.log("🛑 Interruption confirmed - stopping task...");
          shouldBreak = true;
          break;
        }

        const parsedResponse = this.commandExecutor.parseAIResponse(response);

        if (parsedResponse.type === 'comment') {
          const commentLines = parsedResponse.content.split('\n');
          commentLines.forEach(line => {
            if (line.trim()) {
              console.log(`${line}`);
            }
          });
          currentPrompt = "Comment noted. Continue with next command.";
          iteration++;
          continue;
        } else {
          const fullResponseLines = parsedResponse.fullResponse.split('\n');
          fullResponseLines.forEach(line => {
            if (line.trim()) {
              console.log(`${line}`);
            }
          });
        }

        if (!parsedResponse.command || parsedResponse.command.length < 2) {
          console.log('❌ No valid command found');
          currentPrompt = "Give me a valid shell command to execute";
          iteration++;
          continue;
        }

        // Handle "pause" command by breaking out of the loop
        if (parsedResponse.command.toLowerCase() === 'pause' || parsedResponse.command.toLowerCase() === 'exit') {
          shouldBreak = true;
          break;
        }

        const result = await this.commandExecutor.executeCommand(parsedResponse.command);

        if (this.isInterrupted || result.interrupted) {
          console.log("🛑 Interruption confirmed - stopping task...");
          shouldBreak = true;
          break;
        }

        this.sessionManager.addHistoryEntry({
          command: parsedResponse.command,
          success: result.success,
          output: result.output
        });

        currentPrompt = this.commandExecutor.createSummaryPrompt(
          parsedResponse.command, 
          result.success, 
          result.output, 
          result.error
        );

        const sizeStatusAfterCmd = this.conversationManager.checkConversationSize();
        if (sizeStatusAfterCmd === "needs_compact") {
          needsCompaction = true;
        }
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
      this.removeKeypressListener();
      
      this.rl.question('\n> ', (answer) => {
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
        this.isInterrupted = false;
        
        const userPrompt = await this.askUserPrompt();
        
        if (!userPrompt) {
          continue;
        }

        // Handle commands with parameters
        if (userPrompt.startsWith('/continue ')) {
          const sessionId = userPrompt.substring(10).trim();
          await this.handleContinue(sessionId);
          continue;
        }

        switch (userPrompt.toLowerCase()) {
          case '/quit':
          case '/exit':
            this.removeKeypressListener();
            this.rl.close();
            console.log('👋 Goodbye!');
            return;

          case '/clear':
            await this.handleClear();
            continue;

          case '/clear-all':
            this.handleClearAll();
            continue;

          case '/help':
            this.showHelp();
            continue;

          case '/forbidden':
            this.showForbiddenCommands();
            continue;

          case '/history':
            this.showHistory();
            continue;

          case '/compact':
            await this.conversationManager.compactConversationWithAI();
            continue;

          case '/status':
            this.sessionManager.showSessionStatus();
            this.conversationManager.checkConversationSize();
            continue;

          case '/archives':
            this.showArchives();
            continue;

          case '/continue':
            await this.handleContinue();
            continue;

          default:
            await this.executeTaskLoop(userPrompt);
        }

      } catch (error) {
        console.error(`❌ Session error: ${error.message}`);
      }
    }
  }

  showHelp() {
    console.log(`
Commands:
- <task> : Execute debugging task
- /continue : Continue from last session
- /continue <session-id> : Switch to archived session
- /clear : Archive current session and start new one
- /clear-all : Delete all sessions and archives
- /compact : Reduce conversation using AI
- /archives : List all archived sessions
- /help : Show this help
- /quit | /exit : Quit
- /forbidden : Show forbidden commands
- /history : Show full command history
- /status : Show current session status

Interruption:
- Press ESC or Ctrl+C to interrupt any operation
- Works during API calls and command execution
    `);
  }

  showForbiddenCommands() {
    console.log('🚫 Forbidden commands:');
    this.commandExecutor.forbiddenCommands.forEach(cmd => console.log(`  - ${cmd}`));
  }

  showHistory() {
    console.log('📜 Full command history:');
    this.sessionManager.fullHistory.forEach((entry, index) => {
      console.log(`\n--- Step ${index + 1} ---`);
      console.log(`Command: ${entry.command}`);
      console.log(`Result: ${entry.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`Output: ${this.sessionManager.truncateOutput(entry.output)}`);
    });
  }

  showArchives() {
    const archives = this.sessionManager.listArchives();
    
    if (archives.length === 0) {
      console.log('📂 No archived sessions found');
      return;
    }

    console.log('📂 Archived sessions:');
    console.log('=' .repeat(80));
    
    archives.forEach((archive, index) => {
      console.log(`\n${index + 1}. ${archive.sessionId}`);
      console.log(`   Description: ${archive.description}`);
      console.log(`   Date: ${new Date(archive.timestamp).toLocaleString()}`);
      console.log(`   Messages: ${archive.messageCount}, Commands: ${archive.commandCount}`);
    });
  }

  async handleClear() {
    if (this.sessionManager.conversationHistory.length === 0) {
      console.log('ℹ️ No current session to archive');
      this.sessionManager.clearCurrentSession();
      return;
    }

    await this.sessionManager.archiveAndClear();
    console.log('🆕 New session ready');
  }

  handleClearAll() {
    this.removeKeypressListener();
    this.rl.question('⚠️  Are you sure you want to delete ALL sessions and archives? (yes/no): ', (answer) => {
      this.setupKeypressListener();
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        this.sessionManager.clearAllSessions();
      } else {
        console.log('❌ Operation cancelled');
      }
    });
  }

  async handleContinue(sessionId = null) {
    if (sessionId) {
      // Switch to specific archived session
      const success = await this.sessionManager.switchToArchive(sessionId);
      if (!success) {
        console.log(`❌ Could not switch to session: ${sessionId}`);
      }
      return;
    }

    // Continue from current session (original behavior)
    if (this.sessionManager.conversationHistory.length === 0) {
      console.log('❌ No session to continue - start a new task first');
      return;
    }

    this.conversationManager.checkConversationSize();

    const lastUserMsg = [...this.sessionManager.conversationHistory]
      .reverse()
      .find(msg => msg.role === 'user');
      
    if (!lastUserMsg) {
      console.log('❌ No previous task to continue from');
      return;
    }
    
    console.log(`🔄 Continuing from: "${this.sessionManager.truncateOutput(lastUserMsg.content, 1)}"`);
    
    let continuePrompt;
    if (this.sessionManager.fullHistory.length > 0) {
      const lastEntry = this.sessionManager.fullHistory[this.sessionManager.fullHistory.length - 1];
      continuePrompt = this.commandExecutor.createSummaryPrompt(
        lastEntry.command,
        lastEntry.success,
        lastEntry.output
      );
    } else {
      continuePrompt = 'Continue with the next command';
    }
    
    await this.executeTaskLoop(continuePrompt);
  }
}

// Main
const main = async () => {
  const workingDir = process.argv[2];
  const apiKey = process.env.DEEPSEEK_API_KEY || process.argv[3];

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