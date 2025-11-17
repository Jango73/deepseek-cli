import { ConsoleOutput } from "./ConsoleOutput.mjs";
import { ExecutionLoop } from "./ExecutionLoop.mjs";

export class TaskExecutor {
  constructor(conversationManager, commandExecutor, sessionManager) {
    this.conversationManager = conversationManager;
    this.commandExecutor = commandExecutor;
    this.sessionManager = sessionManager;
    this.executionLoop = new ExecutionLoop(commandExecutor, sessionManager, conversationManager);
  }

  interrupt() {
    this.executionLoop.interrupt();
  }

  async executeTaskLoop(initialPrompt, systemPrompt, cliInstance = null) {
    return await this.executionLoop.execute({
      initialPrompt,
      systemPrompt,
      cliInstance
    });
  }
}