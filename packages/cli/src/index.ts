import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { statusCommand } from './commands/status';
import { fundCommand } from './commands/fund';
import { sendCommand } from './commands/send';
import { searchCommand } from './commands/search';
import { registerCommand } from './commands/register';
import { limitsCommand } from './commands/limits';

const VERSION = '0.3.0';

const program = new Command();

program
  .name('agentspay')
  .description(chalk.bold('⚡ AgentPay — AI Agent Micropayment Infrastructure'))
  .version(VERSION)
  .addHelpText('after', `

${chalk.bold('Examples:')}
  ${chalk.dim('# Initialize and create a wallet')}
  $ agentspay init

  ${chalk.dim('# Initialize with custom API URL')}
  $ agentspay init --api-url http://localhost:3100

  ${chalk.dim('# Check wallet balance')}
  $ agentspay status

  ${chalk.dim('# Fund wallet (testnet)')}
  $ agentspay fund --amount 500000

  ${chalk.dim('# Search for services')}
  $ agentspay search "vulnerability scanner"

  ${chalk.dim('# Execute a service')}
  $ agentspay send <service-id> --input '{"target":"https://example.com"}'

  ${chalk.dim('# Register your agent as a service provider')}
  $ agentspay register --name "MyBot" --price 5000 --endpoint http://mybot:8080/run

  ${chalk.dim('# Set spending limits')}
  $ agentspay limits --tx 10000 --daily 100000

${chalk.bold('1000x cheaper than Coinbase Agentic Wallets.')}
${chalk.dim('No gas fees. No vendor lock-in. Real micropayments.')}
`);

// ─── init ───
program
  .command('init')
  .description('Initialize AgentPay and create a wallet')
  .option('--api-url <url>', 'API server URL', 'http://localhost:3100')
  .option('--api-key <key>', 'Use existing API key instead of creating new wallet')
  .action(initCommand);

// ─── status ───
program
  .command('status')
  .description('Show wallet balance and info')
  .action(statusCommand);

// ─── fund ───
program
  .command('fund')
  .description('Fund your wallet (testnet/demo mode)')
  .option('-a, --amount <sats>', 'Amount in satoshis', '100000')
  .option('-c, --currency <cur>', 'Currency: BSV or MNEE', 'BSV')
  .action(fundCommand);

// ─── send (execute service) ───
program
  .command('send <serviceId>')
  .description('Execute a service (pay → run → settle)')
  .option('-i, --input <json>', 'Input JSON for the service')
  .option('-w, --wallet <id>', 'Wallet ID to pay from (default: your wallet)')
  .action(sendCommand);

// ─── search ───
program
  .command('search [query]')
  .description('Search the service marketplace')
  .option('-c, --category <cat>', 'Filter by category')
  .option('--currency <cur>', 'Filter by currency')
  .option('-l, --limit <n>', 'Max results to display', '20')
  .action(searchCommand);

// ─── register ───
program
  .command('register')
  .description('Register your agent as a service provider')
  .requiredOption('-n, --name <name>', 'Service name')
  .requiredOption('-d, --description <desc>', 'Service description')
  .requiredOption('--category <cat>', 'Category (e.g. security, data, ai)')
  .requiredOption('-p, --price <sats>', 'Price in satoshis')
  .option('-e, --endpoint <url>', 'Service endpoint URL (optional — jobs use the queue model)')
  .option('-c, --currency <cur>', 'Currency: BSV or MNEE', 'BSV')
  .option('-m, --method <method>', 'HTTP method (optional)')
  .action(registerCommand);

// ─── limits ───
program
  .command('limits')
  .description('View or set spending limits')
  .option('--tx <sats>', 'Max per transaction (satoshis)')
  .option('--session <sats>', 'Max per session (satoshis)')
  .option('--daily <sats>', 'Max per day (satoshis)')
  .option('--clear', 'Remove all limits')
  .action(limitsCommand);

// ─── health ───
program
  .command('health')
  .description('Check API health')
  .action(async () => {
    const { loadConfig } = await import('./config');
    const { apiRequest } = await import('./api');
    const config = loadConfig();
    try {
      const health = await apiRequest('/api/health');
      console.log(chalk.green('\n  ✓ API is healthy'));
      console.log(chalk.dim(`    URL: ${config.apiUrl}`));
      console.log(chalk.dim(`    Version: ${health.version || 'unknown'}`));
      console.log(chalk.dim(`    Demo: ${health.demo || false}`));
      console.log('');
    } catch (err: any) {
      console.log(chalk.red(`\n  ✗ API unreachable: ${err.message}`));
      console.log(chalk.dim(`    URL: ${config.apiUrl}\n`));
      process.exit(1);
    }
  });

program.parse(process.argv);
