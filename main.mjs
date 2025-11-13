import readline from 'readline';
import { runAgent } from './AgentRunner.mjs';

function parseArgs(rawArgs) {
    const options = {};
    const positional = [];

    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = rawArgs[i + 1];
            if (next && !next.startsWith('--')) {
                options[key] = next;
                i++;
            } else {
                options[key] = true;
            }
        } else {
            positional.push(arg);
        }
    }

    return { options, positional };
}

function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

const main = async () => {
    const rawArgs = process.argv.slice(2);
    const { options, positional } = parseArgs(rawArgs);

    const configPath = typeof options.config === 'string'
        ? options.config
        : './.deepseek_config.json';
    const apiKeyFromEnv = process.env.DEEPSEEK_API_KEY || null;

    if (options.agent) {
        const agentId = typeof options.agent === 'string' ? options.agent : null;
        if (!agentId) {
            console.error('Missing value for --agent');
            process.exit(1);
        }

        const apiKey = apiKeyFromEnv;
        if (!apiKey) {
            console.error('Missing DEEPSEEK_API_KEY for agent mode');
            process.exit(1);
        }

        const inputMsg = typeof options.input === 'string' ? options.input : '';
        const depth = options.depth ? parseInt(options.depth, 10) || 0 : 0;
        const workingDirectory = options['working-dir'] || positional[0] || process.cwd();

        await runAgent(agentId, inputMsg, {
            configPath,
            depth,
            apiKey,
            workingDirectory
        });
        return;
    }

    const workingDirectory = positional[0];
    if (!workingDirectory) {
        console.error('Missing working directory argument');
        process.exit(1);
    }

    const apiKey = apiKeyFromEnv || positional[1];
    if (!apiKey) {
        console.error('Missing DEEPSEEK_API_KEY');
        process.exit(1);
    }

    let inputMessage = typeof options.input === 'string' ? options.input : '';
    if (!inputMessage) {
        if (options['non-interactive']) {
            console.error('Missing --input while in non-interactive mode');
            process.exit(1);
        }
        inputMessage = await ask('Describe the task for agent "Generic": ');
        if (!inputMessage) {
            console.error('Task description cannot be empty');
            process.exit(1);
        }
    }

    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down...');
        process.exit(0);
    });

    console.log('🚀 Launching default agent "Generic"...');
    await runAgent('Generic', inputMessage, {
        configPath,
        apiKey,
        workingDirectory
    });
};

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
