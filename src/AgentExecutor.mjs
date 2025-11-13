import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AgentExecutor {
    static async executeAgent(agentId, message, configPath, depth, apiKey) {
        return new Promise((resolve, reject) => {
            const args = [
                join(__dirname, 'main.mjs'),
                '--agent', agentId,
                '--input', message,
                '--non-interactive',
                '--config', configPath,
                '--depth', String(depth)
            ];

            const proc = spawn('node', args, {
                env: { ...process.env, DEEPSEEK_API_KEY: apiKey }
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                // Afficher la sortie avec l'indentation appropriée
                const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                process.stdout.write(`${prefix}${output}`);
            });

            proc.stderr.on('data', (data) => {
                const error = data.toString();
                stderr += error;
                const prefix = depth > 0 ? '│ '.repeat(depth) : '';
                process.stderr.write(`${prefix}${error}`);
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Agent ${agentId} exited with code ${code}: ${stderr}`));
                }
            });

            proc.on('error', (error) => {
                reject(error);
            });
        });
    }
}