import { CommandExecutor } from "../CommandExecutor.mjs";
import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

describe("CommandExecutor", () => {
  let tempDir;
  let executor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-test-"));
    executor = new CommandExecutor(tempDir, []);
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Internal commands", () => {
    test("read command reads lines from file", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");

      const cmd = `read "${filePath}" from 2 to 4`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("read");
      expect(parsed.filePath).toBe(filePath);
      expect(parsed.start).toBe(2);
      expect(parsed.end).toBe(4);

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toBe(`2: line2\n3: line3\n4: line4`);
    });

    test("write command inserts lines at position", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "original1\noriginal2\noriginal3");

      const cmd = `write "${filePath}" at 2\ninserted line A\ninserted line B`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("write");
      expect(parsed.line).toBe(2);

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toContain("Written 2 line(s) at line 2");

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      expect(lines[0]).toBe("original1");
      expect(lines[1]).toBe("inserted line A");
      expect(lines[2]).toBe("inserted line B");
      expect(lines[3]).toBe("original2");
      expect(lines[4]).toBe("original3");
    });

    test("replace command replaces line range", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "a\nb\nc\nd\ne");

      const cmd = `replace "${filePath}" from 2 to 4\nnew B\nnew C\nnew D`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("replace");

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toContain("Replaced lines 2-4 with 3 line(s)");

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      expect(lines[0]).toBe("a");
      expect(lines[1]).toBe("new B");
      expect(lines[2]).toBe("new C");
      expect(lines[3]).toBe("new D");
      expect(lines[4]).toBe("e");
    });

    test("delete command removes line range", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "keep1\ndel1\ndel2\ndel3\nkeep2");

      const cmd = `delete "${filePath}" from 2 to 4`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("delete");

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toBe("Deleted lines 2-4 from " + filePath);

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      expect(lines[0]).toBe("keep1");
      expect(lines[1]).toBe("keep2");
    });

    test("read with from-end modifier", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");

      const cmd = `read "${filePath}" from 2 to 4 from-end`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.fromEnd).toBe(true);

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);

      expect(result.output).toBe(`2: line2\n3: line3\n4: line4`);
    });

    test("read command without range reads entire file", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5");

      const cmd = `read "${filePath}"`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("read");
      expect(parsed.start).toBe(1);
      expect(parsed.end).toBe(Infinity);

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toBe(`1: line1\n2: line2\n3: line3\n4: line4\n5: line5`);
    });

    test("file-size command returns file size in bytes", async () => {
      const filePath = path.join(tempDir, "test.txt");
      const content = "Hello, World!\nThis is a test file.\nThird line.";
      fs.writeFileSync(filePath, content);

      const cmd = `file-size "${filePath}"`;
      const parsed = executor.parseInternalCommand(cmd);
      expect(parsed.error).toBeUndefined();
      expect(parsed.type).toBe("file-size");

      const result = executor.executeInternalCommand(parsed);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/File size: \d+ bytes/);
      
      // Verify the size is correct
      const stats = fs.statSync(filePath);
      expect(result.output).toBe(`File size: ${stats.size} bytes`);
    });
  });

  describe("Bash commands", () => {
    test("ls lists directory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "file1.txt"), "");
      fs.writeFileSync(path.join(tempDir, "file2.txt"), "");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const result = await executor.executeCommand("ls -la");
      expect(result.success).toBe(true);
      expect(result.output).toContain("file1.txt");
      expect(result.output).toContain("file2.txt");
      expect(result.output).toContain("subdir");
    });

    test("pwd shows working directory", async () => {
      const result = await executor.executeCommand("pwd");
      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe(tempDir);
    });

    test("echo prints text", async () => {
      const result = await executor.executeCommand("echo hello world");
      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("hello world");
    });

    test("cat displays file content", async () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "content line 1\ncontent line 2");

      const result = await executor.executeCommand(`cat "${filePath}"`);
      expect(result.success).toBe(true);
      expect(result.output).toBe("content line 1\ncontent line 2");
    });
  });

  describe("AI response parsing and execution", () => {
    test("parses internal command blocks correctly", () => {
      const aiResponse = `>>> 
read "test.txt" from 1 to 5
<<<
Some chat >>> 
write "test.txt" at 3
new line
<<<
More chat.`;
      const parsed = executor.parseAIResponse(aiResponse);
      expect(parsed.type).toBe("command");
      expect(parsed.commands).toHaveLength(2);
      expect(parsed.actions).toHaveLength(4);
      expect(parsed.actions[0].type).toBe("internal");
      expect(parsed.actions[0].content).toBe('read "test.txt" from 1 to 5');
      expect(parsed.actions[1].type).toBe("comment");
      expect(parsed.actions[1].content).toBe('Some chat');
      expect(parsed.actions[2].type).toBe("internal");
      expect(parsed.actions[2].content).toBe('write "test.txt" at 3\nnew line');
      expect(parsed.actions[3].type).toBe("comment");
      expect(parsed.actions[3].content).toBe('More chat.');
    });

    test("parses file-size command as internal command", () => {
      const aiResponse = `>>> 
file-size "test.txt"
<<<
Some chat >>> 
read "test.txt"
<<<
More chat.`;
      const parsed = executor.parseAIResponse(aiResponse);
      expect(parsed.type).toBe("command");
      expect(parsed.commands).toHaveLength(2);
      expect(parsed.actions).toHaveLength(4);
      expect(parsed.actions[0].type).toBe("internal");
      expect(parsed.actions[0].content).toBe('file-size "test.txt"');
      expect(parsed.actions[1].type).toBe("comment");
      expect(parsed.actions[1].content).toBe('Some chat');
      expect(parsed.actions[2].type).toBe("internal");
      expect(parsed.actions[2].content).toBe('read "test.txt"');
      expect(parsed.actions[3].type).toBe("comment");
      expect(parsed.actions[3].content).toBe('More chat.');
    });

    test("full scenario: AI creates and modifies file using internal commands and bash", async () => {

      const aiResponse = `
Let me create a test file and modify it.
>>> 
printf 'initial line 1\ninitial line 2\ninitial line 3\ninitial line 4\ninitial line 5' > "${tempDir}/test.txt"
<<<
Now I'll read lines 2-4.
>>> 
read "${tempDir}/test.txt" from 2 to 4
<<<
Now insert two lines at line 3.
>>> 
write "${tempDir}/test.txt" at 3
inserted A
inserted B
<<<
Replace lines 5-6.
>>> 
replace "${tempDir}/test.txt" from 5 to 6
replaced line 5
replaced line 6
<<<
Delete line 7.
>>> 
delete "${tempDir}/test.txt" from 7 to 7
<<<
Let's verify the file content.
>>> 
cat "${tempDir}/test.txt"
<<<
And list directory.
>>> 
ls -la "${tempDir}"
<<<
Done.
`;

      const parsed = executor.parseAIResponse(aiResponse);
      expect(parsed.type).toBe("command");
      expect(parsed.commands).toHaveLength(7);


      for (const action of parsed.actions) {
        if (action.type === "shell") {
          const result = await executor.executeCommand(action.content);
          expect(result.success).toBe(true);
        } else if (action.type === "internal") {
          const parsedCmd = executor.parseInternalCommand(action.content);
          expect(parsedCmd.error).toBeUndefined();
          const result = executor.executeInternalCommand(parsedCmd);
          expect(result.success).toBe(true);
        }

      }


      const finalContent = fs.readFileSync(path.join(tempDir, "test.txt"), "utf-8");
      const lines = finalContent.split("\n").filter(line => line !== "");
      expect(lines).toEqual([
        "initial line 1",
        "initial line 2",
        "inserted A",
        "inserted B",
        "replaced line 5",
        "replaced line 6"
      ]);
    });
  });
});