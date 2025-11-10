import { DeepSeekCLI } from './DeepSeekCLI.mjs';

const main = async () => {
  const workingDir = process.argv[2];
  const apiKey = process.env.DEEPSEEK_API_KEY || process.argv[3];

  if (!workingDir) {
    console.log('Missing working directory');
    process.exit(1);
  }

  const cli = new DeepSeekCLI(apiKey, workingDir);
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