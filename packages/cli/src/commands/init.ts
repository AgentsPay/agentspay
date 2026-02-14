import chalk from 'chalk';
import ora from 'ora';
import { saveConfig, loadConfig, getConfigPath } from '../config';
import { apiRequest } from '../api';

export async function initCommand(options: { apiUrl?: string; apiKey?: string }): Promise<void> {
  console.log(chalk.bold.cyan('\n⚡ AgentPay Setup\n'));

  const apiUrl = options.apiUrl || 'http://localhost:4000';

  // Step 1: Save API URL
  saveConfig({ apiUrl });
  console.log(chalk.dim(`  API URL: ${apiUrl}`));

  // Step 2: If API key provided, save and validate
  if (options.apiKey) {
    saveConfig({ apiKey: options.apiKey });
    console.log(chalk.dim('  API key: provided'));

    const spinner = ora('Validating API key...').start();
    try {
      const health = await apiRequest('/api/health');
      spinner.succeed('Connected to AgentPay API');
      console.log(chalk.dim(`  Version: ${health.version || 'unknown'}`));
    } catch (err: any) {
      spinner.warn(`Could not reach API: ${err.message}`);
    }
    return;
  }

  // Step 3: Create wallet automatically
  const spinner = ora('Creating wallet...').start();

  try {
    const result = await apiRequest('/api/wallets', { method: 'POST' });

    const walletId = result.wallet?.id || result.id;
    const apiKey = result.apiKey;
    const address = result.wallet?.address || result.address;
    const privateKey = result.privateKey || result.wallet?.privateKey;

    saveConfig({
      apiKey,
      walletId,
      address,
    });

    spinner.succeed('Wallet created!');

    console.log('');
    console.log(chalk.bold('  Your AgentPay Wallet'));
    console.log(chalk.dim('  ─────────────────────────────'));
    console.log(`  ${chalk.cyan('Wallet ID:')}  ${walletId}`);
    console.log(`  ${chalk.cyan('Address:')}    ${address}`);
    console.log(`  ${chalk.cyan('API Key:')}    ${apiKey}`);

    if (privateKey) {
      console.log('');
      console.log(chalk.yellow.bold('  ⚠️  SAVE YOUR PRIVATE KEY — shown only once:'));
      console.log(`  ${chalk.red(privateKey)}`);
    }

    console.log('');
    console.log(chalk.dim(`  Config saved to: ${getConfigPath()}`));
    console.log('');
    console.log(chalk.green('  Next steps:'));
    console.log(chalk.dim('    agentspay fund          Fund your wallet (testnet)'));
    console.log(chalk.dim('    agentspay status        Check wallet balance'));
    console.log(chalk.dim('    agentspay search        Browse available services'));
    console.log(chalk.dim('    agentspay send           Send a payment'));
    console.log('');
  } catch (err: any) {
    spinner.fail(`Failed: ${err.message}`);
    console.log('');
    console.log(chalk.dim('  Make sure the API is running:'));
    console.log(chalk.dim(`    ${apiUrl}/api/health`));
    console.log('');
    process.exit(1);
  }
}
