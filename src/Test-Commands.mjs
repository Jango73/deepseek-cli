import { CommandExecutor } from "./CommandExecutor.mjs";

class CommandParserTester {
  constructor() {
    this.executor = new CommandExecutor(process.cwd(), []);
    this.passed = 0;
    this.failed = 0;
  }

  logResult(name, condition, details = "") {
    if (condition) {
      this.passed++;
      console.log(`✅ ${name}`);
    } else {
      this.failed++;
      const suffix = details ? ` — ${details}` : "";
      console.log(`❌ ${name}${suffix}`);
    }
  }

  testSingleBlock() {
    const response = [
      "Explaining what will be executed",
      ">>>",
      "ls -la",
      "<<<",
      "Great, moving on",
    ].join("\n");

    const parsed = this.executor.parseAIResponse(response);
    this.logResult(
      "Single command block",
      parsed.type === "command" &&
        parsed.commands.length === 1 &&
        parsed.commands[0] === "ls -la" &&
        parsed.actions[0].type === "comment" &&
        parsed.actions[1].type === "shell",
    );
  }

  testInlineBlock() {
    const response = "First block >>>pwd<<< followed by more chat";
    const parsed = this.executor.parseAIResponse(response);
    this.logResult(
      "Inline block parsing",
      parsed.commands.length === 1 && parsed.commands[0] === "pwd",
    );
  }

  testMultipleBlocks() {
    const response = [
      "Plan:",
      ">>>",
      "ls src",
      "<<<",
      "agent Helper: audit tests",
      ">>>",
      "npm run lint",
      "<<<",
    ].join("\n");
    const parsed = this.executor.parseAIResponse(response);
    const hasAgent = parsed.actions.some(
      (action) => action.type === "agent" && action.agentId === "Helper",
    );
    this.logResult(
      "Multiple command blocks + agent actions",
      parsed.commands.length === 2 &&
        parsed.commands[0] === "ls src" &&
        parsed.commands[1] === "npm run lint" &&
        hasAgent,
    );
  }

  testChatOnly() {
    const response = "No commands in this response.";
    const parsed = this.executor.parseAIResponse(response);
    this.logResult(
      "Chat-only responses",
      parsed.type === "comment" && parsed.commands.length === 0,
    );
  }

  testUnmatchedMarker() {
    const response = 'Here is a broken block >>> echo "hi"';
    const parsed = this.executor.parseAIResponse(response);
    this.logResult(
      "Graceful handling of unmatched markers",
      parsed.type === "comment" && parsed.commands.length === 0,
    );
  }

  runAll() {
    console.log("\n🧪 Command parser regression tests\n");
    this.testSingleBlock();
    this.testInlineBlock();
    this.testMultipleBlocks();
    this.testChatOnly();
    this.testUnmatchedMarker();

    console.log(
      `\nSummary: ${this.passed} passed, ${this.failed} failed\n${
        this.failed === 0 ? "🎉 All good!" : "⚠️ Issues detected"
      }`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new CommandParserTester();
  tester.runAll();
}
