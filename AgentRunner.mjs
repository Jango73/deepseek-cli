import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DeepSeekAPI } from './DeepSeekAPI.mjs';
import { SessionManager } from './SessionManager.mjs';
import { CommandExecutor } from './CommandExecutor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const agentStack = [];

async function askDeepseek(conversation, apiKey) {
    const api = new DeepSeekAPI(apiKey);
    return await api.makeApiRequest(conversation);
}

export async function runAgent(agentId, inputMessage = '', opts = {}) {
    const {
        configPath = './.deepseek_config.json',
        depth = 0,
        apiKey,
        parentSessionManager = null,
        workingDirectory = null
    } = opts;

    if (!apiKey) throw new Error('Missing API key in runAgent() options');

    const resolvedConfigPath = configPath.startsWith('.') 
        ? join(__dirname, '..', configPath)
        : configPath;

    const config = JSON.parse(await fs.readFile(resolvedConfigPath, 'utf8'));
    const agent = config.agents.find(a => a.id === agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found in config.`);

    const agentWorkingDir = workingDirectory 
        ? workingDirectory 
        : parentSessionManager 
            ? parentSessionManager.workingDirectory 
            : process.cwd();
    const agentSessionManager = new SessionManager(agentWorkingDir);
    const commandExecutor = new CommandExecutor(agentWorkingDir, []);
    
    const parentSessionId = parentSessionManager?.currentSessionId || 'main';
    agentSessionManager.currentSessionId = `${parentSessionId}_agent_${agentId}_${Date.now().toString(36)}`;
    agentSessionManager.currentSessionDescription = `Agent: ${agentId} - ${inputMessage.substring(0, 50)}${inputMessage.length > 50 ? '...' : ''}`;
    agentSessionManager.setInitialPrompt(`Agent ${agentId} task: ${inputMessage}`);
    
    const configDir = dirname(resolvedConfigPath);
    const resolvedSystemPromptPath = agent.systemPrompt.startsWith('.') 
        ? join(configDir, agent.systemPrompt)
        : agent.systemPrompt;

    const systemPrompt = await fs.readFile(resolvedSystemPromptPath, 'utf8');
    
    agentSessionManager.addConversationMessage('system', systemPrompt);
    agentSessionManager.addConversationMessage('user', inputMessage);
    agentSessionManager.saveSession();

    agentStack.push(agentId);

    try {
        while (true) {
            const messages = agentSessionManager.getConversationHistory();
            const response = await askDeepseek(messages, apiKey);
            
            const prefix = depth > 0 ? '│ '.repeat(depth) : '';
            process.stdout.write(`${prefix}${response.trim()}\n`);

            agentSessionManager.addConversationMessage('assistant', response);
            agentSessionManager.saveSession();

            if (/\>\>\s*(exit|pause|done)/i.test(response)) {
                const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                process.stdout.write(`${prefix}🏁 Agent "${agentId}" finished.\n`);
                
                await agentSessionManager.archiveCurrentSession();
                return;
            }

            // handle inter-agent call
            const lines = response.split('\n');
            for (const line of lines) {
                const match = line.match(/^>> agent (\w+)\s*:\s*(.+)$/i);
                if (match) {
                    const targetId = match[1];
                    const message = match[2].trim();
                    const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                    process.stdout.write(`${prefix}🤝 Delegating to agent "${targetId}"\n`);
                    await runAgent(targetId, message, {
                        configPath: resolvedConfigPath,
                        depth: depth + 1,
                        apiKey,
                        parentSessionManager: agentSessionManager
                    });
                    continue;
                }
                
                // EXECUTE SHELL COMMANDS
                if (line.startsWith('>>') && line.length > 2) {
                    const command = line.substring(2).trim();
                    if (command && !command.toLowerCase().startsWith('agent ')) {
                        try {
                            const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                            process.stdout.write(`${prefix}🔧 Executing: ${command}\n`);
                            
                            const result = await commandExecutor.executeCommand(command);
                            
                            process.stdout.write(`${prefix}${result.output}\n`);
                            
                            const resultMessage = `Command: ${command}\nOutput: ${result.output}\nSuccess: ${result.success}`;
                            agentSessionManager.addConversationMessage('system', resultMessage);
                            agentSessionManager.saveSession();
                        } catch (error) {
                            const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                            process.stdout.write(`${prefix}❌ Command failed: ${error.message}\n`);
                        }
                    }
                }
            }
        }
    } finally {
        agentStack.pop();
    }
}
