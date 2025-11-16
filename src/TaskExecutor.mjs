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

        const apiAbortController = cliInstance?.createAIAbortController
          ? cliInstance.createAIAbortController()
          : null;
        let response;
        try {
          response = await this.conversationManager.askDeepSeek(
            currentPrompt, 
            this.sessionManager.workingDirectory, 
            systemPrompt,
            apiAbortController
          );
        } catch (error) {
          if (apiAbortController && typeof cliInstance?.releaseAIAbortController === 'function') {
            cliInstance.releaseAIAbortController(apiAbortController);
          }
          if (error.name === 'AbortError' && (this.isInterrupted || cliInstance?.isInterrupted)) {
            console.log("🛑 Interruption confirmed - stopping task...");
            shouldBreak = true;
            break;
          }
          throw error;
        }
        if (apiAbortController && typeof cliInstance?.releaseAIAbortController === 'function') {
          cliInstance.releaseAIAbortController(apiAbortController);
        }

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
        if (parsedResponse.diagnostics?.unclosedBlocks?.length) {
          for (const block of parsedResponse.diagnostics.unclosedBlocks) {
            const preview = block.preview.replace(/\s+/g, ' ').trim();
            console.warn(`⚠️ Incomplete command block detected (missing <<<). Preview: ${preview}`);
          }
        }
        const actions = parsedResponse.actions || [];

        if (actions.length === 0) {
          console.log('❌ No valid command found');
          currentPrompt = "Give me a valid shell command to execute";
          iteration++;
          continue;
        }

        let lastSummaryPrompt = null;
        let executedSomething = false;

        for (const action of actions) {
          if (action.type === 'comment') {
            if (action.content) {
              console.log(action.content);
            }
            continue;
          }

          if (action.type === 'agent') {
            if (cliInstance && typeof cliInstance.launchAgentFromAI === 'function') {
              executedSomething = true;
              await cliInstance.launchAgentFromAI(action.agentId, action.message);
              this.sessionManager.addHistoryEntry({
                command: `agent ${action.agentId} ${action.message}`,
                success: true,
                output: `Delegated to agent ${action.agentId}`
              });
              lastSummaryPrompt = `Delegated to agent ${action.agentId}. Continue.`;
            } else {
              console.log(`❌ Agent delegation unsupported: ${action.agentId}`);
            }
            continue;
          }

          if (cliInstance && typeof cliInstance.handleSpecialCommand === 'function') {
            const handled = await cliInstance.handleSpecialCommand(action.content);
            if (handled) {
              executedSomething = true;
              lastSummaryPrompt = "Agent command handled. Continue with the next instruction.";
              continue;
            }
          }

          if (action.content.toLowerCase() === 'pause' || action.content.toLowerCase() === 'exit') {
            shouldBreak = true;
            executedSomething = true;
            break;
          }

          const commandLines = action.content.split('\n');

          const printBlock = (title, lines) => {
            console.log(`${title}`); // header
            const maxLines = 4;
            const limitedLines = lines.slice(0, maxLines);
            for (const line of limitedLines) {
              console.log(line);
            }
            if (lines.length > maxLines) {
              console.log(`... (${lines.length - maxLines} more lines)`);
            }
            console.log('\n');
          };

          printBlock('COMMAND', ['>>>', ...commandLines, '<<<']);
          const result = await this.commandExecutor.executeCommand(action.content);
          executedSomething = true;

          if (result.error === 'COMMAND_TOO_LONG') {
            const maxLines = this.commandExecutor.constructor?.MAX_COMMAND_LINES || 20;
            const warningMessage = [
              `Your command contained ${result.lineCount} lines. The maximum allowed is ${maxLines}.`,
              'Split large scripts into multiple >>>/<<< blocks (each ≤20 lines) before resubmitting.'
            ].join(' ');
            this.sessionManager.addConversationMessage('system', warningMessage);
            this.sessionManager.saveSession();
          }

          if (result.error === 'UNTERMINATED_HEREDOC') {
            this.sessionManager.addConversationMessage('system', result.output);
            this.sessionManager.saveSession();
          }

          if (this.isInterrupted || (cliInstance && cliInstance.isInterrupted) || result.interrupted) {
            console.log("🛑 Interruption confirmed - stopping task...");
            shouldBreak = true;
            break;
          }

          this.sessionManager.addHistoryEntry({
            command: action.content,
            success: result.success,
            output: result.output
          });

          const outputLines = (result.output || 'No output').split('\n');
          const outcome = result.success ? 'OUTPUT (SUCCESS)' : 'OUTPUT (FAILURE)';
          printBlock(outcome, outputLines);

          lastSummaryPrompt = this.commandExecutor.createSummaryPrompt(
            action.content, 
            result.success, 
            result.output, 
            result.error
          );
        }

        if (shouldBreak) {
          break;
        }

        if (executedSomething && lastSummaryPrompt) {
          currentPrompt = lastSummaryPrompt;
        } else if (!executedSomething) {
          currentPrompt = "Give me a valid shell command wrapped between >>> and <<<";
        } else if (!lastSummaryPrompt) {
          currentPrompt = "Command handled. Continue with next instruction.";
        }

        const sizeStatusAfterCmd = this.conversationManager.checkConversationSize();
        if (sizeStatusAfterCmd === "needs_compact") {
          needsCompaction = true;
        }
        iteration++;

      } catch (error) {
        if (error.message === 'INTERRUPTED_BY_USER') {
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
