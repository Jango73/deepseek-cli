import { DeepSeekCLI } from './DeepSeekCLI.mjs';
import { runAgent } from './AgentRunner.mjs';
import { SessionManager } from './SessionManager.mjs';

const main = async () => {
    const args = process.argv.slice(2);

    const agentIdx = args.indexOf('--agent');
    if (agentIdx > -1) {
        // Mode agent - ne pas setup de signal handlers
        const agentId = args[agentIdx + 1];
        const inputIdx = args.indexOf('--input');
        const inputMsg = inputIdx > -1 ? args[inputIdx + 1] : '';
        const depthIdx = args.indexOf('--depth');
        const depth = depthIdx > -1 ? parseInt(args[depthIdx + 1]) : 0;
        const configIdx = args.indexOf('--config');
        const configPath = configIdx > -1 ? args[configIdx + 1] : './.deepseek_config.json';
        const parentSessionIdx = args.indexOf('--parent-session');
        const parentSessionId = parentSessionIdx > -1 ? args[parentSessionIdx + 1] : null;
        const apiKey = process.env.DEEPSEEK_API_KEY;

        if (!apiKey) {
            console.error('Missing DEEPSEEK_API_KEY');
            process.exit(1);
        }

        let parentSessionManager = null;
        if (parentSessionId) {
            parentSessionManager = new SessionManager(process.cwd());
        }

        await runAgent(agentId, inputMsg, { 
            configPath, 
            depth, 
            apiKey, 
            parentSessionManager 
        });
        process.exit(0);
    }

    // Handle interactive mode - SEULEMENT ici setup les handlers
    const nonInteractive = args.includes('--non-interactive');
    const workingDir = args[0];
    const apiKey = process.env.DEEPSEEK_API_KEY || args[1];

    if (!workingDir) {
        console.log('Missing working directory');
        process.exit(1);
    }

    // Setup global signal handlers only for main process
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down...');
        process.exit(0);
    });

    const cli = new DeepSeekCLI(apiKey, workingDir);

    if (!nonInteractive) {
        await cli.startInteractiveSession();
    }
};

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
