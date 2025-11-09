#!/usr/bin/env node

import { exec } from 'child_process';
import fs from 'fs';
import readline from 'readline';

class DeepSeekCLI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.conversationHistory = [];
    this.fullHistory = [];
    this.alwaysYes = false;
    this.sessionFile = '.deepseek_session.json';
    this.configFile = '.deepseek_config.json';
    this.forbiddenCommands = this.loadForbiddenCommands();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.loadSession();
  }

  loadForbiddenCommands() {
    const defaultForbidden = [
      'rm -rf /', 'rm -rf /*', 'rm -rf .', 'rm -rf *',
      'dd if=/dev/random', 'mkfs', 'fdisk', ':(){ :|:& };:',
      'chmod -R 000', 'chown -R root:root', 'mv / /dev/null',
      '> /dev/sda', 'dd if=/dev/zero'
    ];
    
    try {
      if (fs.existsSync(this.configFile)) {
        const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        return [...defaultForbidden, ...(config.forbiddenCommands || [])];
      }
    } catch (error) {
      console.log('⚠️  Using default forbidden commands');
    }
    
    return defaultForbidden;
  }

  isCommandForbidden(command) {
    const cleanCommand = command.split('#')[0].trim().toLowerCase();
    return this.forbiddenCommands.some(forbidden => 
      cleanCommand.includes(forbidden.toLowerCase())
    );
  }

  loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.conversationHistory = data.conversationHistory || [];
        this.fullHistory = data.fullHistory || [];
        console.log('📁 Previous session loaded');
      }
    } catch (error) {
      this.conversationHistory = [];
      this.fullHistory = [];
    }
  }

  saveSession() {
    try {
      const data = { 
        conversationHistory: this.conversationHistory,
        fullHistory: this.fullHistory
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Ignore save errors
    }
  }

  truncateOutput(text, maxLines = 4) {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n') + `\n... [${lines.length - maxLines} more lines]`;
  }

  createSummaryPrompt(command, success, output) {
    // Create intelligent summary for API context
    const lines = output.split('\n');
    
    if (output.length < 1000) {
      return `Command: ${command}\nResult: ${success ? 'SUCCESS' : 'FAILED'}\nOutput: ${output}\n\nNext command?`;
    }
    
    // For long outputs, extract meaningful parts
    const firstLines = lines.slice(0, 5).join('\n');
    const lastLines = lines.slice(-3).join('\n');
    
    // Look for errors, warnings, or key patterns
    const errorLines = lines.filter(line => 
      line.toLowerCase().includes('error:') || 
      line.toLowerCase().includes('fatal:') ||
      line.toLowerCase().includes('warning:') ||
      line.toLowerCase().includes('failed') ||
      line.match(/\.(c|cpp|h|py|js|ts|rs):\d+:/) // code references
    ).slice(0, 10);
    
    let summary = `${firstLines}\n... [${lines.length - 8} more lines]\n`;
    
    if (errorLines.length > 0) {
      summary += `Key messages:\n${errorLines.join('\n')}\n`;
    }
    
    summary += `${lastLines}`;
    
    return `Command: ${command}\nResult: ${success ? 'SUCCESS' : 'FAILED'}\nOutput: ${summary}\n\nNext command?`;
  }

  async askDeepSeek(prompt) {
    // Read AGENTS.md only at the beginning of a session
    let agentsContent = '';
    if (this.conversationHistory.length === 0) {
      try {
        if (fs.existsSync('AGENTS.md')) {
          agentsContent = fs.readFileSync('AGENTS.md', 'utf8');
          console.log('📖 Loaded AGENTS.md');
        }
      } catch (error) {
        // Ignore if AGENTS.md doesn't exist or can't be read
      }
    }

    const systemPrompt = `
You are an expert in c/asm coding and debugging.
You have access to the user's full codebase.
The user will run your commands directly in shell.
${agentsContent ? `\nProject-specific context from AGENTS.md:\n${agentsContent}\n` : ''}
    
IMPORTANT RULES:
1. You may respond with EITHER a valid shell command that can be executed immediately OR a comment starting with #
2. No markdown, no code blocks
3. Only one command per response
4. Commands must be specific and actionable
5. If you need to wait for the user to execute something before continuing, yield a "pause" command

Current directory: ${process.cwd()}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: prompt }
    ];

    try {
      console.log('🤔 Asking DeepSeek...');
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-coder',
          messages: messages,
          max_tokens: 500,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`API Error: ${data.error.message}`);
      }
      
      if (!data.choices || !data.choices[0]) {
        throw new Error('Invalid response format from API');
      }
      
      const result = data.choices[0].message.content;

      this.conversationHistory.push({ role: 'user', content: prompt });
      this.conversationHistory.push({ role: 'assistant', content: result });
      this.saveSession();

      return result;
    } catch (error) {
      console.error('❌ API call failed:', error.message);
      throw error;
    }
  }

  executeCommand(command) {
    return new Promise((resolve) => {
      // Remove comments from command but keep them for debugging
      const cleanCommand = command.split('#')[0].trim();
      const comment = command.includes('#') ? command.split('#').slice(1).join('#').trim() : null;
      
      // Handle "pause" command
      if (cleanCommand.toLowerCase() === 'pause') {
        console.log('⏸️  Pause requested by AI');
        if (comment) {
          console.log(`💬 ${comment}`);
        }
        resolve({ 
          success: true, 
          output: 'PAUSE: Waiting for user action. Continue when ready.',
          paused: true
        });
        return;
      }
      
      if (!cleanCommand) {
        resolve({ 
          success: false, 
          output: `❌ Empty command after removing comments${comment ? `\nOriginal with comment: ${command}` : ''}`,
          error: 'Empty command'
        });
        return;
      }

      // Check if command is forbidden
      if (this.isCommandForbidden(cleanCommand)) {
        resolve({ 
          success: false, 
          output: `❌ FORBIDDEN COMMAND: "${cleanCommand}" is not allowed for safety reasons.`,
          error: 'Forbidden command'
        });
        return;
      }

      console.log(`💻 Running: ${cleanCommand}`);
      if (comment) {
        console.log(`💬 Note: ${comment}`);
      }

      exec(cleanCommand, { timeout: 60000 }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        const success = error === null;

        resolve({ success, output, error: error ? error.message : null });
      });
    });
  }

  askPermission(command) {
    return new Promise((resolve) => {
      // Show clean command without comments
      const cleanCommand = command.split('#')[0].trim();
      
      // Check if command is forbidden
      if (this.isCommandForbidden(cleanCommand)) {
        console.log(`🚫 FORBIDDEN: "${cleanCommand}"`);
        resolve('no');
        return;
      }

      this.rl.question(`🤖 Execute: ${cleanCommand}\n(y/n/always/stop) > `, (answer) => {
        resolve(answer.trim().toLowerCase());
      });
    });
  }

  async askUserPrompt() {
    return new Promise((resolve) => {
      this.rl.question('\n🎯 What task? > ', (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async waitForInterrupt() {
    return new Promise((resolve) => {
      const handleInterrupt = () => {
        console.log('\n🛑 Interrupted by user');
        resolve(true);
      };

      process.on('SIGINT', handleInterrupt);
      
      // Auto-continue after a brief moment
      setTimeout(() => {
        process.removeListener('SIGINT', handleInterrupt);
        resolve(false);
      }, 100);
    });
  }

  async startInteractiveSession() {
    console.log('🔧 DeepSeek CLI - Kernel Debug Mode');
    console.log('====================================\n');
    console.log('Press Ctrl+C at any time to interrupt current task\n');

    while (true) {
      try {
        const userPrompt = await this.askUserPrompt();
        
        if (!userPrompt) {
          continue;
        }

        if (userPrompt.toLowerCase() === '/quit' || userPrompt.toLowerCase() === '/exit') {
          break;
        }

        if (userPrompt.toLowerCase() === '/clear') {
          this.conversationHistory = [];
          this.fullHistory = [];
          this.saveSession();
          console.log('🧹 History cleared');
          continue;
        }

        if (userPrompt.toLowerCase() === '/help') {
          console.log(`
Commands:
- <task> : Execute debugging task
- /clear : Clear history  
- /help : Show this help
- /quit | /exit : Quit
- /forbidden : Show forbidden commands
- /history : Show full command history

Press Ctrl+C to interrupt any operation
          `);
          continue;
        }

        if (userPrompt.toLowerCase() === '/forbidden') {
          console.log('🚫 Forbidden commands:');
          this.forbiddenCommands.forEach(cmd => console.log(`  - ${cmd}`));
          continue;
        }

        if (userPrompt.toLowerCase() === '/history') {
          console.log('📜 Full command history:');
          this.fullHistory.forEach((entry, index) => {
            console.log(`\n--- Step ${index + 1} ---`);
            console.log(`Command: ${entry.command}`);
            console.log(`Result: ${entry.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Output: ${this.truncateOutput(entry.output)}`);
          });
          continue;
        }

        console.log(`\n🔄 Task: ${userPrompt}`);

        let currentPrompt = userPrompt;
        let iteration = 1;
        const maxIterations = 100;
        let alwaysThisTask = false;

        while (iteration <= maxIterations) {
          console.log(`\n________________________________ ${iteration}`);

          try {
            // Check for user interrupt
            const interrupted = await this.waitForInterrupt();
            if (interrupted) break;

            const response = await this.askDeepSeek(currentPrompt);
            console.log(`💡 DeepSeek: ${this.truncateOutput(response)}`);

            // Extract the actual command (first line usually)
            const command = response.split('\n')[0].trim();
            
            if (!command || command.length < 2) {
              console.log('❌ No valid command found');
              currentPrompt = 'Give me a valid shell command to execute';
              iteration++;
              continue;
            }

            // Ask for permission (unless alwaysThisTask is enabled)
            let permission = (this.alwaysYes || alwaysThisTask) ? 'y' : 'n';
            if (!this.alwaysYes && !alwaysThisTask) {
              permission = await this.askPermission(command);
            }

            if (permission === 'stop') {
              break;
            }

            if (permission === 'n' || permission === 'no') {
              const newInstruction = await new Promise((resolve) => {
                this.rl.question('🎯 New instruction > ', resolve);
              });
              currentPrompt = newInstruction;
              iteration++;
              continue;
            }

            if (permission === 'always' || permission === 'a') {
              alwaysThisTask = true;
              console.log('✅ Always-execute mode ON (for this task only)');
            }

            // Execute command
            const result = await this.executeCommand(command);

            if (result.paused) {
              // Pause requested by AI - wait for user confirmation
              console.log('⏸️  AI is waiting for you to complete an action');
              const userInput = await new Promise((resolve) => {
                this.rl.question('✅ Press Enter when ready to continue, or type new instruction > ', resolve);
              });
              
              if (userInput.trim()) {
                // User provided new instruction
                currentPrompt = userInput;
              } else {
                // User just pressed Enter - continue with next command
                currentPrompt = 'Action completed. Continue with next command.';
              }
              
              iteration++;
              continue;
            }

            if (result.output) {
              console.log(`📋 Output:\n${this.truncateOutput(result.output)}`);
            }

            if (result.error) {
              console.log(`❌ Command failed: ${result.error}`);
            }

            // Save full history and create intelligent summary for next prompt
            this.fullHistory.push({
              command,
              success: result.success,
              output: result.output,
              timestamp: new Date().toISOString()
            });

            currentPrompt = this.createSummaryPrompt(command, result.success, result.output);
            iteration++;

          } catch (error) {
            console.error(`❌ Error: ${error.message}`);
            currentPrompt = `Error: ${error.message}. What next?`;
            iteration++;
          }
        }

        console.log(`\n✅ Task completed`);

      } catch (error) {
        console.error(`❌ Session error: ${error.message}`);
      }
    }

    this.rl.close();
    console.log('👋 Goodbye!');
  }
}

// Main
const main = async () => {
  const apiKey = process.argv[2];

  if (!apiKey) {
    console.log('Usage: ./deepseek.mjs API_KEY');
    process.exit(1);
  }

  const cli = new DeepSeekCLI(apiKey);
  await cli.startInteractiveSession();
};

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
