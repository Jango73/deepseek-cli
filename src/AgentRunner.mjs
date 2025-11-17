import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DeepSeekAPI } from "./DeepSeekAPI.mjs";
import { SessionManager } from "./SessionManager.mjs";
import { CommandExecutor } from "./CommandExecutor.mjs";
import { ConsoleOutput } from "./ConsoleOutput.mjs";
import { ExecutionLoop } from "./ExecutionLoop.mjs";

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
  const conversationManager = null; // To create if necessary, or use the API directly
  
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

  // Create a simple conversation manager for ExecutionLoop
  const simpleConversationManager = {
    checkConversationSize: () => "normal",
    compactConversationWithAI: async () => false,
    askDeepSeek: async (prompt, workingDir, systemPrompt, abortController) => {
      const messages = agentSessionManager.getConversationHistory();
      const apiController = abortController || new AbortController();
      currentApiAbortController = apiController;
      try {
        const response = await askDeepseek(messages, apiKey, apiController);
        agentSessionManager.addConversationMessage("assistant", response);
        agentSessionManager.saveSession();
        return response;
      } catch (error) {
        if (error.name === "AbortError" && interrupted) {
          throw new Error("INTERRUPTED_BY_USER");
        }
        throw error;
      } finally {
        currentApiAbortController = null;
      }
    }
  };

  const executionLoop = new ExecutionLoop(commandExecutor, agentSessionManager, simpleConversationManager);

  try {
    await executionLoop.execute({
      initialPrompt: inputMessage,
      systemPrompt,
      agentId,
      depth,
      onAgentDelegation: async (targetAgentId, message) => {
        // Delegation to another agent
        await runAgent(targetAgentId, message, {
          configPath: resolvedConfigPath,
          depth: depth + 1,
          apiKey,
          parentSessionManager: agentSessionManager,
          workingDirectory: agentWorkingDir,
          interruptController,
        });
      }
    });

    await agentSessionManager.archiveCurrentSession();
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