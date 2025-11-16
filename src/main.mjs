import { DeepSeekCLI } from "./DeepSeekCLI.mjs";
import { runAgent } from "./AgentRunner.mjs";
import { SessionManager } from "./SessionManager.mjs";
import { InterruptController } from "./InterruptController.mjs";
import { ConsoleOutput } from "./ConsoleOutput.mjs";

const args = process.argv.slice(2);

const hasFlag = (flag) =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
const getFlagValue = (flag) => {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    return inline.substring(flag.length + 1);
  }
  const idx = args.indexOf(flag);
  if (idx > -1) {
    return args[idx + 1];
  }
  return undefined;
};

const getAgentTrailingInput = () => {
  const agentFlagIndex = args.findIndex(
    (arg) => arg === "--agent" || arg.startsWith("--agent="),
  );
  if (agentFlagIndex === -1) {
    return "";
  }

  let startIndex;
  if (args[agentFlagIndex].includes("=")) {
    // Format --agent=ProjectLeader, trailing input starts right after this arg
    startIndex = agentFlagIndex + 1;
  } else {
    // Format --agent ProjectLeader <input?>
    startIndex = agentFlagIndex + 2;
  }

  if (startIndex >= args.length) {
    return "";
  }

  const collected = [];
  for (let i = startIndex; i < args.length; i++) {
    const token = args[i];
    if (token.startsWith("--")) {
      break;
    }
    collected.push(token);
  }

  return collected.join(" ").trim();
};

const main = async () => {
  const interruptController = new InterruptController();
  interruptController.start();

  const nonInteractive = hasFlag("--non-interactive");
  const agentMode = hasFlag("--agent");
  let agentInterrupted = false;

  if (agentMode) {
    // Mode agent - ne pas setup de signal handlers
    const agentId = getFlagValue("--agent");
    if (!agentId) {
      ConsoleOutput.error("Missing value for --agent");
      process.exit(1);
    }

    const workingDirectory =
      getFlagValue("--working-directory") || process.cwd();
    const fallbackInput = getAgentTrailingInput();
    const inputMsg = getFlagValue("--input") || fallbackInput || "";
    const depth = parseInt(getFlagValue("--depth") || "0", 10);
    const configPath = getFlagValue("--config") || "./.deepseek_config.json";
    const parentSessionId = getFlagValue("--parent-session") || null;
    const apiKey = getFlagValue("--api-key") || process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      ConsoleOutput.error("Missing DEEPSEEK_API_KEY");
      process.exit(1);
    }

    let parentSessionManager = null;
    if (parentSessionId) {
      parentSessionManager = new SessionManager(workingDirectory);
    }

    try {
      await runAgent(agentId, inputMsg, {
        configPath,
        depth,
        apiKey,
        parentSessionManager,
        workingDirectory,
        interruptController,
      });
    } catch (error) {
      if (error.message === "INTERRUPTED_BY_USER") {
        agentInterrupted = true;
      } else {
        interruptController.pause();
        throw error;
      }
    }

    if (nonInteractive) {
      interruptController.pause();
      process.exit(agentInterrupted ? 130 : 0);
    }

    if (agentInterrupted) {
      ConsoleOutput.info("↩️ Agent interrupted. Back to the interactive CLI.");
    } else {
      ConsoleOutput.info("✅ Agent completed. You can continue from the CLI.");
    }
  }

  // Handle interactive mode - SEULEMENT ici setup les handlers
  const workingDir = getFlagValue("--working-directory") || process.cwd();
  const apiKey = getFlagValue("--api-key") || process.env.DEEPSEEK_API_KEY;

  if (!workingDir) {
    ConsoleOutput.info("Missing working directory");
    process.exit(1);
  }

  // Setup global signal handlers only for main process
  process.on("SIGINT", () => {
    ConsoleOutput.info("\n🛑 Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    ConsoleOutput.info("\n🛑 Shutting down...");
    process.exit(0);
  });

  const cli = new DeepSeekCLI(apiKey, workingDir, interruptController);

  if (!nonInteractive) {
    await cli.startInteractiveSession();
  } else {
    interruptController.pause();
  }
};

process.on("unhandledRejection", (error) => {
  ConsoleOutput.error("Unhandled rejection:", error);
  process.exit(1);
});

main().catch((error) => {
  ConsoleOutput.error("Fatal error:", error);
  process.exit(1);
});
