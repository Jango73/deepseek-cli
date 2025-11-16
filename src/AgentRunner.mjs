import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DeepSeekAPI } from "./DeepSeekAPI.mjs";
import { SessionManager } from "./SessionManager.mjs";
import { CommandExecutor } from "./CommandExecutor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const agentStack = [];

async function askDeepseek(conversation, apiKey, abortController = null) {
  const api = new DeepSeekAPI(apiKey);
  return await api.makeApiRequest(conversation, null, abortController);
}

export async function runAgent(agentId, inputMessage = "", opts = {}) {
  const {
    configPath = "./.deepseek_config.json",
    depth = 0,
    apiKey,
    parentSessionManager = null,
    workingDirectory = null,
    interruptController = null,
  } = opts;

  if (!apiKey) throw new Error("Missing API key in runAgent() options");

  const resolvedConfigPath = configPath.startsWith(".")
    ? join(__dirname, "..", configPath)
    : configPath;

  const config = JSON.parse(await fs.readFile(resolvedConfigPath, "utf8"));
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config.`);

  const agentWorkingDir = workingDirectory
    ? workingDirectory
    : parentSessionManager
      ? parentSessionManager.workingDirectory
      : process.cwd();
  const sessionNamespace = parentSessionManager
    ? `${parentSessionManager.currentSessionId || "main"}_${agentId}_${Date.now().toString(36)}`
    : `${agentId}_${Date.now().toString(36)}`;
  const agentSessionManager = new SessionManager(agentWorkingDir, {
    sessionNamespace,
  });
  const commandExecutor = new CommandExecutor(agentWorkingDir, []);
  let currentApiAbortController = null;
  let interrupted = false;
  const unregisterInterrupt = interruptController
    ? interruptController.onInterrupt(() => {
        if (interrupted) return;
        interrupted = true;
        const prefix = depth > 0 ? "│ ".repeat(depth) : "";
        process.stdout.write(
          `${prefix}\n⏹️ Interruption requested. Stopping "${agentId}"…\n`,
        );
        currentApiAbortController?.abort();
        commandExecutor.killCurrentProcess();
      })
    : null;

  const basePrefix = depth > 0 ? "│ ".repeat(depth) : "";
  const parentSessionId = parentSessionManager?.currentSessionId || "main";
  agentSessionManager.currentSessionId = `${parentSessionId}_agent_${agentId}_${Date.now().toString(36)}`;
  agentSessionManager.currentSessionDescription = `Agent: ${agentId} - ${inputMessage.substring(0, 50)}${inputMessage.length > 50 ? "..." : ""}`;
  agentSessionManager.setInitialPrompt(
    `Agent ${agentId} task: ${inputMessage}`,
  );

  const configDir = dirname(resolvedConfigPath);
  const resolvedSystemPromptPath = agent.systemPrompt.startsWith(".")
    ? join(configDir, agent.systemPrompt)
    : agent.systemPrompt;

  const systemPrompt = await fs.readFile(resolvedSystemPromptPath, "utf8");

  const previewLines = systemPrompt
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 5);
  const truncatedPreview = previewLines.length
    ? previewLines.join(" / ")
    : systemPrompt.substring(0, 120);
  const taskPreview = inputMessage
    ? inputMessage
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" / ")
    : "(empty)";
  process.stdout.write(`${basePrefix}🗒️ Task (${agentId}): ${taskPreview}\n`);

  agentSessionManager.addConversationMessage("system", systemPrompt);
  agentSessionManager.addConversationMessage("user", inputMessage);
  agentSessionManager.saveSession();

  agentStack.push(agentId);
  process.stdout.write(
    `${basePrefix}🚀 Agent "${agentId}" instantiated (depth ${depth})\n`,
  );

  const checkInterruption = () => {
    if (interrupted || interruptController?.isInterrupted()) {
      throw new Error("INTERRUPTED_BY_USER");
    }
  };

  try {
    while (true) {
      checkInterruption();
      const messages = agentSessionManager.getConversationHistory();
      const apiController = new AbortController();
      currentApiAbortController = apiController;
      let response;
      try {
        response = await askDeepseek(messages, apiKey, apiController);
      } catch (error) {
        if (
          error.name === "AbortError" &&
          (interrupted || interruptController?.isInterrupted())
        ) {
          throw new Error("INTERRUPTED_BY_USER");
        }
        throw error;
      } finally {
        currentApiAbortController = null;
      }
      checkInterruption();

      agentSessionManager.addConversationMessage("assistant", response);
      agentSessionManager.saveSession();

      const parsed = commandExecutor.parseAIResponse(response);
      if (parsed.diagnostics?.unclosedBlocks?.length) {
        for (const block of parsed.diagnostics.unclosedBlocks) {
          const preview = block.preview.replace(/\s+/g, " ").trim();
          process.stdout.write(
            `${basePrefix}⚠️ Incomplete command block detected (missing <<<). Preview: ${preview}\n`,
          );
        }
      }
      const actions = parsed.actions || [];

      if (actions.length === 0) {
        process.stdout.write(
          `${basePrefix}❓ AI response contained no executable command. Waiting for clarification.\n`,
        );
        const reminderMessage = [
          "No executable command was detected in your last response.",
          'Provide the next shell command wrapped between >>> and <<<, delegate to another agent, or reply with "done" when finished.',
        ].join(" ");
        agentSessionManager.addConversationMessage("system", reminderMessage);
        agentSessionManager.saveSession();
      }

      for (const action of actions) {
        checkInterruption();

        if (action.type === "comment") {
          process.stdout.write(`${basePrefix}${action.content}\n`);
          continue;
        }

        if (action.type === "agent") {
          const targetId = action.agentId;
          const message = action.message || "";
          process.stdout.write(
            `${basePrefix}🤝 Delegating to agent "${targetId}"\n`,
          );
          await runAgent(targetId, message, {
            configPath: resolvedConfigPath,
            depth: depth + 1,
            apiKey,
            parentSessionManager: agentSessionManager,
            workingDirectory: agentWorkingDir,
            interruptController,
          });
          continue;
        }

        if (action.type === "shell") {
          try {
            const commandLines = action.content.split("\n");

            ConsoleOutput.printBlock("Command", commandLines);

            const result = await commandExecutor.executeCommand(action.content);
            checkInterruption();

            if (result.error === "COMMAND_TOO_LONG") {
              const warningMessage = [
                `Your command contained ${result.lineCount} lines. The maximum allowed is ${CommandExecutor.MAX_COMMAND_LINES}.`,
                "Split large scripts into multiple >>>/<<< blocks (each ≤20 lines) before resubmitting.",
              ].join(" ");
              agentSessionManager.addConversationMessage(
                "system",
                warningMessage,
              );
              agentSessionManager.saveSession();
            }

            if (result.error === "UNTERMINATED_HEREDOC") {
              agentSessionManager.addConversationMessage(
                "system",
                result.output,
              );
              agentSessionManager.saveSession();
            }

            const outputLines = (result.output || "No output").split("\n");
            const outcome = result.success
              ? "OUTPUT (SUCCESS)"
              : "OUTPUT (FAILURE)";
            ConsoleOutput.printBlock(outcome, outputLines);

            const resultMessage = commandExecutor.createSummaryPrompt(
              action.content,
              result.success,
              result.output,
              result.error,
            );
            agentSessionManager.addConversationMessage("system", resultMessage);
            agentSessionManager.saveSession();
          } catch (error) {
            process.stdout.write(
              `${basePrefix}❌ Command failed: ${error.message}\n`,
            );
          }
        }
      }

      const trimmed = response.trim();
      if (/^(>>\s*)?(exit|pause|done)$/i.test(trimmed)) {
        process.stdout.write(`${basePrefix}🏁 Agent "${agentId}" finished.\n`);

        await agentSessionManager.archiveCurrentSession();
        return;
      }
    }
  } catch (error) {
    if (error.message === "INTERRUPTED_BY_USER") {
      process.stdout.write(`${basePrefix}⏹️ Agent "${agentId}" interrupted.\n`);
      await agentSessionManager.archiveCurrentSession();
    }
    throw error;
  } finally {
    process.stdout.write(`${basePrefix}🧹 Agent "${agentId}" destroyed\n`);
    unregisterInterrupt?.();
    interruptController?.clearInterrupt();
    agentStack.pop();
  }
}
