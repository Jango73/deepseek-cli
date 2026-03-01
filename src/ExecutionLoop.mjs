import { ConsoleOutput } from "./ConsoleOutput.mjs";

export class ExecutionLoop {
  constructor(commandExecutor, sessionManager, conversationManager) {
    this.commandExecutor = commandExecutor;
    this.sessionManager = sessionManager;
    this.conversationManager = conversationManager;
    this.isInterrupted = false;
  }

  interrupt() {
    this.isInterrupted = true;
  }

  async execute({
    initialPrompt,
    systemPrompt,
    cliInstance = null,
    agentId = null,
    depth = 0,
    onAgentDelegation = null,
    maxIterations = 100
  }) {
    this.isInterrupted = false;
    const basePrefix = depth > 0 ? "│ ".repeat(depth) : "";

    // Store the initial prompt as session description
    if (this.sessionManager.getInitialPrompt() === "" && initialPrompt) {
      this.sessionManager.setInitialPrompt(initialPrompt);
    }

    let currentPrompt = initialPrompt;
    let iteration = 1;
    let shouldBreak = false;
    let needsCompaction = false;

    const initialSizeStatus = this.conversationManager.checkConversationSize();
    if (initialSizeStatus === "needs_compact") {
      needsCompaction = true;
    }

    while (iteration <= maxIterations && !shouldBreak && !this.isInterrupted) {
      // Check interruption at the beginning of each iteration
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
        if (agentId) {
          process.stdout.write(`${basePrefix}`);
        }
        ConsoleOutput.info("");

        const apiAbortController = cliInstance?.createAIAbortController
          ? cliInstance.createAIAbortController()
          : null;
        let response;
        try {
          response = await this.conversationManager.askDeepSeek(
            currentPrompt,
            this.sessionManager.workingDirectory,
            systemPrompt,
            apiAbortController,
          );
        } catch (error) {
          if (
            apiAbortController &&
            typeof cliInstance?.releaseAIAbortController === "function"
          ) {
            cliInstance.releaseAIAbortController(apiAbortController);
          }
          if (
            error.name === "AbortError" &&
            (this.isInterrupted || cliInstance?.isInterrupted)
          ) {
            if (agentId) {
              process.stdout.write(`${basePrefix}🛑 Interruption confirmed - stopping task...\n`);
            } else {
              ConsoleOutput.info("🛑 Interruption confirmed - stopping task...");
            }
            shouldBreak = true;
            break;
          }
          throw error;
        }
        if (
          apiAbortController &&
          typeof cliInstance?.releaseAIAbortController === "function"
        ) {
          cliInstance.releaseAIAbortController(apiAbortController);
        }

        const sizeStatusAfterAPI =
          this.conversationManager.checkConversationSize();
        if (sizeStatusAfterAPI === "needs_compact") {
          needsCompaction = true;
        }

        if (this.isInterrupted || (cliInstance && cliInstance.isInterrupted)) {
          if (agentId) {
            process.stdout.write(`${basePrefix}🛑 Interruption confirmed - stopping task...\n`);
          } else {
            ConsoleOutput.info("🛑 Interruption confirmed - stopping task...");
          }
          shouldBreak = true;
          break;
        }

        const parsedResponse = this.commandExecutor.parseAIResponse(response);
        if (parsedResponse.diagnostics?.unclosedBlocks?.length) {
          for (const block of parsedResponse.diagnostics.unclosedBlocks) {
            const preview = block.preview.replace(/\s+/g, " ").trim();
            if (agentId) {
              process.stdout.write(`${basePrefix}⚠️ Incomplete command block detected (missing <<<). Preview: ${preview}\n`);
            } else {
              ConsoleOutput.warning(
                `⚠️ Incomplete command block detected (missing <<<). Preview: ${preview}`,
              );
            }
          }
        }
        const actions = parsedResponse.actions || [];

        if (actions.length === 0) {
          if (agentId) {
            process.stdout.write(`${basePrefix}❓ AI response contained no executable command. Waiting for clarification.\n`);
          } else {
            ConsoleOutput.info("❌ No valid command found");
          }
          currentPrompt = "Give me a valid shell command to execute";
          iteration++;
          continue;
        }

        let lastSummaryPrompt = null;
        let executedSomething = false;

        for (const action of actions) {
          if (action.type === "comment") {
            if (action.content) {
              if (agentId) {
                process.stdout.write(`${basePrefix}${action.content}\n`);
              } else {
                ConsoleOutput.info(action.content);
              }
            }
            continue;
          }

          if (action.type === "agent") {
            if (onAgentDelegation) {
              executedSomething = true;
              await onAgentDelegation(action.agentId, action.message);
              this.sessionManager.addHistoryEntry({
                command: `agent ${action.agentId} ${action.message}`,
                success: true,
                output: `Delegated to agent ${action.agentId}`,
              });
              lastSummaryPrompt = `Delegated to agent ${action.agentId}. Continue.`;
            } else if (agentId) {
              // In AgentRunner, we delegate directly
              executedSomething = true;
              if (agentId) {
                process.stdout.write(`${basePrefix}🤝 Delegating to agent "${action.agentId}"\n`);
              }
              // Delegation will be handled by the caller via onAgentDelegation
              lastSummaryPrompt = `Delegated to agent ${action.agentId}. Continue.`;
            }
            continue;
          }

          if (action.type === "shell") {
            const commandLines = action.content.split("\n");

            if (agentId) {
              // Affichage pour AgentRunner
              ConsoleOutput.printBlock("Command", commandLines);
            } else {
              // Affichage pour TaskExecutor
              ConsoleOutput.printBlock("COMMAND", commandLines);
            }

            const result = await this.commandExecutor.executeCommand(
              action.content,
            );
            executedSomething = true;

            if (result.paused) {
              shouldBreak = true;
            }

            if (result.error === "COMMAND_TOO_LONG") {
              const maxLines =
                this.commandExecutor.constructor?.MAX_COMMAND_LINES || 20;
              const warningMessage = [
                `Your command contained ${result.lineCount} lines. The maximum allowed is ${maxLines}.`,
                "Split large scripts into multiple >>>/<<< blocks (each ≤50 lines) before resubmitting.",
              ].join(" ");
              this.sessionManager.addConversationMessage(
                "system",
                warningMessage,
              );
              this.sessionManager.saveSession();
            }

            if (result.error === "UNTERMINATED_HEREDOC") {
              this.sessionManager.addConversationMessage("system", result.output);
              this.sessionManager.saveSession();
            }

            if (
              this.isInterrupted ||
              (cliInstance && cliInstance.isInterrupted) ||
              result.interrupted
            ) {
              if (agentId) {
                process.stdout.write(`${basePrefix}🛑 Interruption confirmed - stopping task...\n`);
              } else {
                ConsoleOutput.info("🛑 Interruption confirmed - stopping task...");
              }
              shouldBreak = true;
              break;
            }

            this.sessionManager.addHistoryEntry({
              command: action.content,
              success: result.success,
              output: result.output,
            });

            const outputLines = (result.output || "No output").split("\n");
            const outcome = result.success
              ? "OUTPUT (SUCCESS)"
              : "OUTPUT (FAILURE)";
              
            if (agentId) {
              ConsoleOutput.printBlock(outcome, outputLines);
            } else {
              ConsoleOutput.printBlock(outcome, outputLines);
            }

            lastSummaryPrompt = this.commandExecutor.createSummaryPrompt(
              action.content,
              result.success,
              result.output,
              result.error,
            );
          }
        }

        if (shouldBreak) {
          break;
        }

        if (executedSomething && lastSummaryPrompt) {
          currentPrompt = lastSummaryPrompt;
        } else if (!executedSomething) {
          currentPrompt =
            "Give me a valid shell command wrapped between >>> and <<<";
        } else if (!lastSummaryPrompt) {
          currentPrompt = "Command handled. Continue with next instruction.";
        }

        const sizeStatusAfterCmd =
          this.conversationManager.checkConversationSize();
        if (sizeStatusAfterCmd === "needs_compact") {
          needsCompaction = true;
        }
        iteration++;
      } catch (error) {
        if (error.message === "INTERRUPTED_BY_USER") {
          shouldBreak = true;
          break;
        } else {
          if (agentId) {
            process.stdout.write(`${basePrefix} ${error.message}\n`);
          } else {
            ConsoleOutput.error(`Error: ${error.message}`);
          }
          currentPrompt = `Error: ${error.message}. What next?`;
          iteration++;
        }
      }
    }

    if (this.isInterrupted) {
      if (agentId) {
        process.stdout.write(`${basePrefix}⏹️ Agent "${agentId}" interrupted.\n`);
      } else {
        ConsoleOutput.info("🔄 Task interrupted - returning to main prompt...");
      }
      this.isInterrupted = false;
    } else if (!shouldBreak && iteration > maxIterations) {
      if (agentId) {
        process.stdout.write(`${basePrefix}🔁 Maximum iterations (${maxIterations}) reached\n`);
      } else {
        ConsoleOutput.info(`\n🔁 Maximum iterations (${maxIterations}) reached`);
      }
    } else if (!shouldBreak && agentId) {
      process.stdout.write(`${basePrefix}✅ Task completed\n`);
    } else if (!shouldBreak) {
      ConsoleOutput.info(`\n✅ Task completed`);
    }

    return { interrupted: this.isInterrupted, iterations: iteration };
  }
}