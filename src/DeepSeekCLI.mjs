#!/usr/bin/env node
import dotenv from "dotenv";
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { DeepSeekAPI } from './DeepSeekAPI.mjs';
import { SessionManager } from './SessionManager.mjs';
import { CommandExecutor } from './CommandExecutor.mjs';
import { ConversationManager } from './ConversationManager.mjs';
import { TaskExecutor } from './TaskExecutor.mjs';
import { runAgent } from './AgentRunner.mjs';
import { InterruptController } from './InterruptController.mjs';

export class DeepSeekCLI {
  constructor(apiKey, workingDir, interruptController = null) {
    this.scriptDirectory = process.cwd();
    this.workingDirectory = workingDir;
    this.configFile = `${this.scriptDirectory}/.deepseek_config.json`;
    
    this.config = this.loadConfig();
    
    if (apiKey) {
      this.apiKey = apiKey;
    } else if (this.config.apiKey) {
      this.apiKey = this.config.apiKey;
    } else {
      console.error('❌ No API key provided');
      process.exit(1);
    }
    
    this.defaultAgentId = process.env.DEEPSEEK_DEFAULT_AGENT || 'Generic';
    this.agentDefinitions = this.config.agents || [];
    this.alwaysYes = false;
    this.isInterrupted = false;

    this.deepSeekAPI = new DeepSeekAPI(this.apiKey);
    this.forbiddenCommands = this.loadForbiddenCommands(this.config.forbiddenCommands);
    this.agentStack = [];
    this.interruptController = interruptController || new InterruptController();
    this.interruptController.start();
    this.interruptCleanup = this.interruptController.onInterrupt(() => this.handleInterruptSignal());

    try {
      const rootContext = this.createAgentContext(this.defaultAgentId, { isRoot: true });
      this.agentStack.push(rootContext);
      this.applyContext(rootContext);
    } catch (error) {
      console.error(`❌ Failed to initialize default agent: ${error.message}`);
      process.exit(1);
    }
    
    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
      output: process.stdout
    });
  }

  loadConfig() {
    dotenv.config();
    const config = {
      apiKey: null,
      forbiddenCommands: [],
      systemPrompt: '',
      agents: []
    };
    
    try {
      if (fs.existsSync(this.configFile)) {
        const fileContent = fs.readFileSync(this.configFile, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        
        config.apiKey = process.env.DEEPSEEK_API_KEY || fileConfig.apiKey || null;
        config.forbiddenCommands = fileConfig.forbiddenCommands || [];
        config.systemPrompt = fileConfig.systemPrompt ? fileConfig.systemPrompt.join('\n') : "";
        config.agents = fileConfig.agents || [];
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

  getAgentDefinition(agentId) {
    const agent = this.agentDefinitions.find((definition) => definition.id === agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found in configuration`);
    }
    return agent;
  }

  resolveAgentPrompt(agentDefinition) {
    if (!agentDefinition.systemPrompt) {
      return this.config.systemPrompt || '';
    }

    const promptPath = agentDefinition.systemPrompt.startsWith('.')
      ? path.join(this.scriptDirectory, agentDefinition.systemPrompt)
      : agentDefinition.systemPrompt;

    try {
      return fs.readFileSync(promptPath, 'utf8');
    } catch (error) {
      console.warn(`⚠️ Unable to load system prompt for ${agentDefinition.id}: ${error.message}`);
      return this.config.systemPrompt || '';
    }
  }

  createAgentContext(agentId, options = {}) {
    const agentDefinition = this.getAgentDefinition(agentId);
    const systemPrompt = this.resolveAgentPrompt(agentDefinition);
    const isRoot = options.isRoot || false;
    const sessionNamespace = isRoot ? null : `${agentId}_${Date.now().toString(36)}`;
    const sessionManager = new SessionManager(this.workingDirectory, { sessionNamespace });
    
    if (isRoot) {
      sessionManager.loadSession();
    } else {
      sessionManager.clearCurrentSession();
    }

    const commandExecutor = new CommandExecutor(this.workingDirectory, this.forbiddenCommands);
    const conversationManager = new ConversationManager(sessionManager, this.deepSeekAPI);
    const taskExecutor = new TaskExecutor(conversationManager, commandExecutor, sessionManager);

    return {
      agentId,
      systemPrompt,
      sessionManager,
      commandExecutor,
      conversationManager,
      taskExecutor,
      sessionNamespace,
      autoPopOnComplete: false
    };
  }

  applyContext(context) {
    this.currentAgentId = context.agentId;
    this.systemPrompt = context.systemPrompt;
    this.sessionManager = context.sessionManager;
    this.commandExecutor = context.commandExecutor;
    this.conversationManager = context.conversationManager;
    this.taskExecutor = context.taskExecutor;
  }

  async pushAgentContext(agentId, initialPrompt = null) {
    const context = this.createAgentContext(agentId, { isRoot: this.agentStack.length === 0 });
    this.agentStack.push(context);
    this.applyContext(context);
    context.autoPopOnComplete = Boolean(initialPrompt);

    if (!initialPrompt) {
      console.log(`🧠 Active agent: ${agentId}`);
      return;
    }

    console.log(`🚀 Agent "${agentId}" started with task: "${initialPrompt}"`);
    await this.taskExecutor.executeTaskLoop(initialPrompt, this.systemPrompt, this);

    if (this.isInterrupted) {
      console.log(`⏸️ Agent "${agentId}" paused. Use /continue to resume or /pop to return to parent.`);
    } else {
      await this.finalizeAutoAgentIfNeeded();
    }
  }

  async popAgentContext(options = {}) {
    if (this.agentStack.length <= 1) {
      console.log('ℹ️ Already at the root agent - nothing to pop');
      return false;
    }

    const context = this.agentStack.pop();
    if (context.sessionManager.conversationHistory.length > 0) {
      await context.sessionManager.archiveCurrentSession();
    }
    context.sessionManager.cleanupArtifacts();

    const parentContext = this.agentStack[this.agentStack.length - 1];
    this.applyContext(parentContext);

    if (!options.auto) {
      console.log(`⬅️ Returned to agent "${parentContext.agentId}"`);
    } else {
      console.log(`🏁 Agent completed. Back to "${parentContext.agentId}"`);
    }

    return true;
  }

  async finalizeAutoAgentIfNeeded() {
    if (this.agentStack.length <= 1) {
      return;
    }

    const context = this.agentStack[this.agentStack.length - 1];
    if (!context.autoPopOnComplete || this.isInterrupted) {
      return;
    }

    await this.popAgentContext({ auto: true });
  }

  handleInterruptSignal() {
    if (this.isInterrupted) {
      return;
    }
    this.isInterrupted = true;
    console.log('\n⏹️ Interruption requested. Stopping current action…');
    if (this.commandExecutor) {
      this.commandExecutor.killCurrentProcess();
    }
    if (this.taskExecutor) {
      this.taskExecutor.interrupt();
    }
  }

  cleanupInterruptHandling() {
    if (this.interruptCleanup) {
      this.interruptCleanup();
      this.interruptCleanup = null;
    }
  }

  async askUserPrompt() {
    return new Promise((resolve) => {
      this.interruptController.pause();
      this.interruptController.clearInterrupt();
      const agentLabel = this.currentAgentId || 'Agent';
      this.rl.question(`\n[${agentLabel}]> `, (answer) => {
        this.interruptController.resume();
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
- /agent <id> "<message>" : Activate another agent (message optional)
- /compact : Reduce conversation using AI
- /pop : Exit current agent and return to the parent agent
- /archives : List all archived sessions
- /help : Show this help
- /quit | /exit : Quit
- /forbidden : Show forbidden commands
- /history : Show full command history
- /status : Show current session status

Interruption:
- Press ESC to interrupt any operation
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

  async handleClearAll() {
    return new Promise((resolve) => {
      this.interruptController.pause();
      this.interruptController.clearInterrupt();
      this.rl.question('⚠️  Are you sure you want to delete ALL sessions and archives? (yes/no): ', (answer) => {
        this.interruptController.resume();
        
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
          this.sessionManager.clearAllSessions();
          console.log('✅ All sessions and archives deleted');
        } else {
          console.log('❌ Operation cancelled');
        }
        
        resolve();
      });
    });
  }

  async handlePopAgent() {
    await this.popAgentContext();
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
    
    if (!this.isInterrupted) {
      await this.finalizeAutoAgentIfNeeded();
    }
  }

  async launchAgentFromUserCommand(agentId, message) {
      try {
          await this.pushAgentContext(agentId, message);
      } catch (err) {
          console.error(`❌ Failed to launch agent "${agentId}": ${err.message}`);
          if (this.agentStack.length > 1 && this.currentAgentId === agentId) {
              const failedContext = this.agentStack.pop();
              failedContext.sessionManager.cleanupArtifacts();
          }
          if (this.agentStack.length > 0) {
              this.applyContext(this.agentStack[this.agentStack.length - 1]);
          }
      }
  }

  async launchAgentFromAI(agentId, message) {
    try {
      console.log(`🤝 Delegating to agent "${agentId}" with task: "${message}"`);
      const depth = Math.max(0, this.agentStack.length - 1);
      await runAgent(agentId, message, {
        configPath: this.configFile,
        depth,
        apiKey: this.apiKey,
        parentSessionManager: this.sessionManager,
        workingDirectory: this.workingDirectory,
        interruptController: this.interruptController
      });
      console.log(`✅ Agent "${agentId}" completed`);
    } catch (error) {
      console.error(`❌ Agent "${agentId}" failed: ${error.message}`);
    }
  }

  async handleSpecialCommand(commandLine) {
    const agentMatch = commandLine.match(/^agent\s+(\w+)\s*:?\s*(.+)$/i);
    if (!agentMatch) {
      return false;
    }

    const agentId = agentMatch[1];
    let message = agentMatch[2]?.trim();

    if (!message) {
      console.log('❌ Agent command missing message content');
      return true;
    }

    if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
      message = message.substring(1, message.length - 1);
    }

    await this.launchAgentFromAI(agentId, message);
    return true;
  }

  async startInteractiveSession() {
    console.log(`📁 Working directory: ${this.workingDirectory}`);
    console.log('Press ESC at any time to interrupt current task');
    console.log(`🧠 Active agent: ${this.currentAgentId}`);

    try {
      while (true) {
        try {
          this.isInterrupted = false;
          this.interruptController.clearInterrupt();
          
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

          if (userPrompt.startsWith('/agent ')) {
              const parts = userPrompt.split(' ');
              const agentId = parts[1];
              const rest = userPrompt.substring(userPrompt.indexOf(agentId) + agentId.length).trim();
              const message = rest ? rest.replace(/^"|"$/g, '') : null;

              if (!agentId) {
                  console.log('Usage: /agent <agentId> "<message optional>"');
                  continue;
              }

              await this.launchAgentFromUserCommand(agentId, message);
              continue;
          }

          switch (userPrompt.toLowerCase()) {
            case '/quit':
            case '/exit':
              this.cleanupInterruptHandling();
              this.interruptController.pause();
              this.rl.close();
              return;

            case '/clear':
              await this.handleClear();
              continue;

            case '/clear-all':
              await this.handleClearAll();
              continue;

            case '/pop':
              await this.handlePopAgent();
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
    } finally {
      this.cleanupInterruptHandling();
      this.interruptController.pause();
    }
  }
}
