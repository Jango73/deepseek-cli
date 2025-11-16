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
import { ConsoleOutput } from "./ConsoleOutput.mjs";

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
      ConsoleOutput.error('No API key provided');
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
      ConsoleOutput.info(`🚀 Agent "${this.currentAgentId}" instantiated (root context)`);
      this.logPromptInfo(rootContext);
      if (rootContext.initialPrompt) {
        const preview = this.generatePromptPreview(rootContext.initialPrompt);
        ConsoleOutput.info(`🗒️ Task (${rootContext.agentId}): ${preview}`);
      }
    } catch (error) {
      ConsoleOutput.error(`Failed to initialize default agent: ${error.message}`);
      process.exit(1);
    }
    
    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
      output: process.stdout
    });
  }
  handleInterruptSignal() {
    if (this.isInterrupted) {
      return;
    }
    this.isInterrupted = true;
    ConsoleOutput.info('\n⏹️ Interruption requested. Stopping ALL agents in the stack…');
    
    // Interrompre tous les agents dans le stack
    for (let i = this.agentStack.length - 1; i >= 0; i--) {
      const context = this.agentStack[i];
      ConsoleOutput.info(`🛑 Stopping agent "${context.agentId}"...`);
      
      // Interrompre le taskExecutor de chaque agent
      if (context.taskExecutor) {
        context.taskExecutor.interrupt();
      }
      
      // Interrompre le commandExecutor de chaque agent
      if (context.commandExecutor) {
        context.commandExecutor.killCurrentProcess();
      }
    }
    
    // Interrompre la requête AI en cours
    if (this.currentAIRequestAbortController) {
      this.currentAIRequestAbortController.abort();
      this.currentAIRequestAbortController = null;
    }
    
    // Nettoyer tous les agents sauf le root
    this.cleanupAgentStack();
  }

  cleanupAgentStack() {
    // Garder seulement l'agent root, supprimer tous les autres
    while (this.agentStack.length > 1) {
      const context = this.agentStack.pop();
      ConsoleOutput.info(`🧹 Destroying agent "${context.agentId}"`);
      if (context.sessionManager && context.sessionManager.conversationHistory && context.sessionManager.conversationHistory.length > 0) {
        context.sessionManager.archiveCurrentSession().catch(() => {});
      }
      if (context.sessionManager) {
        context.sessionManager.cleanupArtifacts();
      }
    }
    
    // Réappliquer le contexte root
    if (this.agentStack.length > 0) {
      this.applyContext(this.agentStack[0]);
      ConsoleOutput.info(`⬅️ Returned to root agent "${this.currentAgentId}"`);
    }
    
    this.isInterrupted = false;
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
        ConsoleOutput.info('⚠️ Config file does not exist!');
      }
    } catch (error) {
      ConsoleOutput.info('⚠️ Config file error:', error.message);
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
      const content = this.config.systemPrompt || '';
      return {
        content,
        source: 'config.systemPrompt',
        preview: this.generatePromptPreview(content)
      };
    }

    const promptPath = agentDefinition.systemPrompt.startsWith('.')
      ? path.join(this.scriptDirectory, agentDefinition.systemPrompt)
      : agentDefinition.systemPrompt;

    try {
      const content = fs.readFileSync(promptPath, 'utf8');
      return {
        content,
        source: promptPath,
        preview: this.generatePromptPreview(content)
      };
    } catch (error) {
      ConsoleOutput.warn(`⚠️ Unable to load system prompt for ${agentDefinition.id}: ${error.message}`);
      const content = this.config.systemPrompt || '';
      return {
        content,
        source: 'config.systemPrompt',
        preview: this.generatePromptPreview(content)
      };
    }
  }

  createAgentContext(agentId, options = {}) {
    const agentDefinition = this.getAgentDefinition(agentId);
    const { content: systemPrompt, source: promptSource, preview: promptPreview } = this.resolveAgentPrompt(agentDefinition);
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
      autoPopOnComplete: false,
      promptSource,
      promptPreview,
      systemPrompt
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
    ConsoleOutput.info(`🚀 Agent "${agentId}" instantiated`);
    this.logPromptInfo(context);
    if (initialPrompt) {
      const preview = this.generatePromptPreview(initialPrompt);
      ConsoleOutput.info(`🗒️ Task (${agentId}): ${preview}`);
    }
    context.autoPopOnComplete = Boolean(initialPrompt);

    if (!initialPrompt) {
      ConsoleOutput.info(`🧠 Active agent: ${agentId}`);
      return;
    }

    ConsoleOutput.info(`🚀 Agent "${agentId}" started with task: "${initialPrompt}"`);
    await this.taskExecutor.executeTaskLoop(initialPrompt, this.systemPrompt, this);

    if (this.isInterrupted) {
      ConsoleOutput.info(`⏸️ Agent "${agentId}" paused. Use /continue to resume or /pop to return to parent.`);
    } else {
      await this.finalizeAutoAgentIfNeeded();
    }
  }

  async popAgentContext(options = {}) {
    if (this.agentStack.length <= 1) {
      ConsoleOutput.info('ℹ️ Already at the root agent - nothing to pop');
      return false;
    }

    const context = this.agentStack.pop();
    if (context.sessionManager.conversationHistory.length > 0) {
      await context.sessionManager.archiveCurrentSession();
    }
    context.sessionManager.cleanupArtifacts();
    ConsoleOutput.info(`🧹 Agent "${context.agentId}" destroyed`);

    const parentContext = this.agentStack[this.agentStack.length - 1];
    this.applyContext(parentContext);

    if (!options.auto) {
      ConsoleOutput.info(`⬅️ Returned to agent "${parentContext.agentId}"`);
    } else {
      ConsoleOutput.info(`🏁 Agent completed. Back to "${parentContext.agentId}"`);
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


  cleanupInterruptHandling() {
    if (this.interruptCleanup) {
      this.interruptCleanup();
      this.interruptCleanup = null;
    }
  }

  generatePromptPreview(promptText) {
    if (!promptText) {
      return 'Empty prompt';
    }
    const firstLine = promptText
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) || promptText.substring(0, 80);
    return firstLine.length > 120 ? `${firstLine.substring(0, 117)}...` : firstLine;
  }

  logPromptInfo(context) {}

  createAIAbortController() {
    if (this.currentAIRequestAbortController) {
      this.currentAIRequestAbortController.abort();
    }
    this.currentAIRequestAbortController = new AbortController();
    return this.currentAIRequestAbortController;
  }

  releaseAIAbortController(controller) {
    if (this.currentAIRequestAbortController === controller) {
      this.currentAIRequestAbortController = null;
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
    ConsoleOutput.info(`
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
    ConsoleOutput.info('🚫 Forbidden commands:');
    this.commandExecutor.forbiddenCommands.forEach(cmd => ConsoleOutput.info(`  - ${cmd}`));
  }

  showHistory() {
    ConsoleOutput.info('📜 Full command history:');
    this.sessionManager.fullHistory.forEach((entry, index) => {
      ConsoleOutput.info(`\n--- Step ${index + 1} ---`);
      ConsoleOutput.info(`Command: ${entry.command}`);
      ConsoleOutput.info(`Result: ${entry.success ? 'SUCCESS' : 'FAILED'}`);
      ConsoleOutput.info(`Output: ${this.sessionManager.truncateOutput(entry.output)}`);
    });
  }

  showArchives() {
    const archives = this.sessionManager.listArchives();
    
    if (archives.length === 0) {
      ConsoleOutput.info('📂 No archived sessions found');
      return;
    }

    ConsoleOutput.info('📂 Archived sessions:');
    ConsoleOutput.info('=' .repeat(80));
    
    archives.forEach((archive, index) => {
      ConsoleOutput.info(`\n${index + 1}. ${archive.sessionId}`);
      ConsoleOutput.info(`   Description: ${archive.description}`);
      ConsoleOutput.info(`   Date: ${new Date(archive.timestamp).toLocaleString()}`);
      ConsoleOutput.info(`   Messages: ${archive.messageCount}, Commands: ${archive.commandCount}`);
    });
  }

  async handleClear() {
    if (this.sessionManager.conversationHistory.length === 0) {
      ConsoleOutput.info('ℹ️ No current session to archive');
      this.sessionManager.clearCurrentSession();
      return;
    }

    await this.sessionManager.archiveAndClear();
    ConsoleOutput.info('🆕 New session ready');
  }

  async handleClearAll() {
    return new Promise((resolve) => {
      this.interruptController.pause();
      this.interruptController.clearInterrupt();
      this.rl.question('⚠️  Are you sure you want to delete ALL sessions and archives? (yes/no): ', (answer) => {
        this.interruptController.resume();
        
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
          this.sessionManager.clearAllSessions();
          ConsoleOutput.info('✅ All sessions and archives deleted');
        } else {
          ConsoleOutput.info('❌ Operation cancelled');
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
        ConsoleOutput.info(`❌ Could not switch to session: ${sessionId}`);
      }
      return;
    }

    // Continue from current session (original behavior)
    if (this.sessionManager.conversationHistory.length === 0) {
      ConsoleOutput.info('❌ No session to continue - start a new task first');
      return;
    }

    this.conversationManager.checkConversationSize();

    const lastUserMsg = [...this.sessionManager.conversationHistory]
      .reverse()
      .find(msg => msg.role === 'user');
      
    if (!lastUserMsg) {
      ConsoleOutput.info('❌ No previous task to continue from');
      return;
    }
    
    ConsoleOutput.info(`🔄 Continuing from: "${this.sessionManager.truncateOutput(lastUserMsg.content, 1)}"`);
    
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
          ConsoleOutput.error(`Failed to launch agent "${agentId}": ${err.message}`);
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
      ConsoleOutput.info(`🤝 Delegating to agent "${agentId}" with task: "${message}"`);
      const depth = Math.max(0, this.agentStack.length - 1);
      await runAgent(agentId, message, {
        configPath: this.configFile,
        depth,
        apiKey: this.apiKey,
        parentSessionManager: this.sessionManager,
        workingDirectory: this.workingDirectory,
        interruptController: this.interruptController
      });
      ConsoleOutput.info(`✅ Agent "${agentId}" completed`);
    } catch (error) {
      ConsoleOutput.error(`Agent "${agentId}" failed: ${error.message}`);
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
      ConsoleOutput.info('❌ Agent command missing message content');
      return true;
    }

    if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
      message = message.substring(1, message.length - 1);
    }

    await this.launchAgentFromAI(agentId, message);
    return true;
  }

  async startInteractiveSession() {
    ConsoleOutput.info(`📁 Working directory: ${this.workingDirectory}`);
    ConsoleOutput.info('Press ESC at any time to interrupt current task');
    ConsoleOutput.info(`🧠 Active agent: ${this.currentAgentId}`);

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
                  ConsoleOutput.info('Usage: /agent <agentId> "<message optional>"');
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
          ConsoleOutput.error(`Session error: ${error.message}`);
        }
      }
    } finally {
      this.cleanupInterruptHandling();
      this.interruptController.pause();
    }
  }
}
