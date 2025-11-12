export class TaskExecutor {
  constructor(conversationManager, commandExecutor, sessionManager) {
    this.conversationManager = conversationManager;
    this.commandExecutor = commandExecutor;
    this.sessionManager = sessionManager;
    this.isInterrupted = false;
  }

  interrupt() {
    this.isInterrupted = true;
  }

  async executeTaskLoop(initialPrompt, systemPrompt, cliInstance = null) {
    // Réinitialiser le flag d'interruption au début
    this.isInterrupted = false;
    
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
      // Vérifier l'interruption au début de chaque itération
      if (cliInstance && cliInstance.isInterrupted) {
        this.isInterrupted = true;
        break;
      }

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
          this.sessionManager.workingDirectory, 
          systemPrompt
        );

        const sizeStatusAfterAPI = this.conversationManager.checkConversationSize();
        if (sizeStatusAfterAPI === "needs_compact") {
          needsCompaction = true;
        }

        if (this.isInterrupted || (cliInstance && cliInstance.isInterrupted)) {
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

        if (this.isInterrupted || (cliInstance && cliInstance.isInterrupted) || result.interrupted) {
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
      console.log('🔄 Task interrupted - returning to main prompt...');
      this.isInterrupted = false;
    } else if (!shouldBreak && iteration > maxIterations) {
      console.log(`\n🔁 Maximum iterations (${maxIterations}) reached`);
    } else if (!shouldBreak) {
      console.log(`\n✅ Task completed`);
    }
  }
}