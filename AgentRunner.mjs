import { spawn } from 'child_process';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DeepSeekAPI } from './DeepSeekAPI.mjs';
import { SessionManager } from './SessionManager.mjs';
import { CommandExecutor } from './CommandExecutor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const activeChildren = new Set();

async function askDeepseek(conversation, apiKey) {
    const api = new DeepSeekAPI(apiKey);
    return await api.makeApiRequest(conversation);
}

export async function runAgent(agentId, inputMessage = '', opts = {}) {
    const { configPath = './.deepseek_config.json', depth = 0, apiKey, parentSessionManager } = opts;

    if (!apiKey) throw new Error('Missing API key in runAgent() options');

    const resolvedConfigPath = configPath.startsWith('.') 
        ? join(__dirname, '..', configPath)
        : configPath;

    const config = JSON.parse(await fs.readFile(resolvedConfigPath, 'utf8'));
    const agent = config.agents.find(a => a.id === agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found in config.`);

    const agentWorkingDir = parentSessionManager ? parentSessionManager.workingDirectory : process.cwd();
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
                await spawnAgent(targetId, message, resolvedConfigPath, depth + 1, apiKey, agentSessionManager);
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
}

async function spawnAgent(agentId, message, configPath, depth, apiKey, parentSessionManager) {
    return new Promise((resolve, reject) => {
        const args = [
            join(__dirname, 'main.mjs'),  // Utiliser le chemin absolu
            '--agent', agentId,
            '--input', message,
            '--non-interactive',
            '--config', configPath,
            '--depth', String(depth),
            '--parent-session', parentSessionManager.currentSessionId
        ];

        const proc = spawn('node', args, {
            stdio: ['pipe', 'pipe', 'pipe'],  // Ne pas utiliser 'inherit'
            env: { 
                ...process.env, 
                DEEPSEEK_API_KEY: apiKey,
                PARENT_SESSION_ID: parentSessionManager.currentSessionId
            },
            cwd: parentSessionManager.workingDirectory
        });

        activeChildren.add(proc);

        // Capturer la sortie pour l'afficher avec l'indentation
        proc.stdout.on('data', (data) => {
            const output = data.toString();
            const prefix = depth > 0 ? '│ '.repeat(depth) : '';
            process.stdout.write(`${prefix}${output}`);
        });

        proc.stderr.on('data', (data) => {
            const error = data.toString();
            const prefix = depth > 0 ? '│ '.repeat(depth) : '';
            process.stderr.write(`${prefix}${error}`);
        });

        proc.on('close', (code) => {
            activeChildren.delete(proc);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Agent ${agentId} exited with code ${code}`));
            }
        });

        proc.on('error', (error) => {
            activeChildren.delete(proc);
            reject(error);
        });
    });
}

function killAll() {
    if (activeChildren.size > 0) {
        console.log('🛑 Stopping agent child processes...');
        for (const child of activeChildren) {
            try {
                child.kill('SIGTERM');
            } catch (error) {
                // Ignore
            }
        }
    }
}