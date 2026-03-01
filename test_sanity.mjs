import { tokenizeShellCommand } from "./src/ShellTokenizer.mjs";
import { CommandExecutor } from "./src/CommandExecutor.mjs";

console.log("Sanity check tokenization:");
const cases = [
  ["echo hello", ["echo", "hello"]],
  ["echo 'hello world'", ["echo", "hello world"]],
  ['echo "hello world"', ["echo", "hello world"]],
  ["ls -la", ["ls", "-la"]],
  ["git commit -m 'fix bug'", ["git", "commit", "-m", "fix bug"]],
  ["command with\\ space", ["command", "with space"]],
];

let ok = true;
for (const [input, expected] of cases) {
  const result = tokenizeShellCommand(input);
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    console.error(`FAIL: "${input}" -> ${JSON.stringify(result)} expected ${JSON.stringify(expected)}`);
    ok = false;
  }
}
console.log(ok ? "✅ All tokenization passed" : "❌ Tokenization failures");

console.log("\nSanity check extraction:");
const executor = new CommandExecutor(process.cwd(), []);
const extractCases = [
  ["ls src", "src"],
  ["ls -la src", "src"],
  ["cat 'my file.txt'", "my file.txt"],
  ["grep -r pattern src/", "src/"],
  ["mv src dest", "src"],
  ["cp -r dir1 dir2", "dir1"],
  ["rm -rf node_modules", "node_modules"],
  ["cd ..", ".."],
  ["git add file.txt", "file.txt"],
  ["npm run lint", ""],
  ["echo hello", ""],
  ["pwd", ""],
];

let ok2 = true;
for (const [cmd, expected] of extractCases) {
  const result = executor.extractCommandTarget(cmd);
  if (result !== expected) {
    console.error(`FAIL: "${cmd}" -> "${result}" expected "${expected}"`);
    ok2 = false;
  }
}
console.log(ok2 ? "✅ All extraction passed" : "❌ Extraction failures");

process.exit(ok && ok2 ? 0 : 1);