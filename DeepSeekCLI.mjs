#!/usr/bin/env node
import dotenv from "dotenv";
import readline from 'readline';
import fs from 'fs';
import { DeepSeekAPI } from './DeepSeekAPI.mjs';
import { SessionManager } from './SessionManager.mjs';
import { CommandExecutor } from './CommandExecutor.mjs';
import { ConversationManager } from './ConversationManager.mjs';
import { TaskExecutor } from './TaskExecutor.mjs';

export class DeepSeekCLI {
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
    this.taskExecutor = new TaskExecutor(this.conversationManager, this.commandExecutor, this.sessionManager);
    
    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
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
          this.taskExecutor.interrupt();
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

  async askUserPrompt() {
    return new Promise((resolve) => {
      this.removeKeypressListener();
      this.rl.question('\n> ', (answer) => {
        this.setupKeypressListener();
        resolve(answer.trim());
      });
    });
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
    
    await this.taskExecutor.executeTaskLoop(continuePrompt, this.systemPrompt, this);
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
            await this.taskExecutor.executeTaskLoop(userPrompt, this.systemPrompt, this);
        }

      } catch (error) {
        console.error(`❌ Session error: ${error.message}`);
      }
    }
  }
}