import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function sendCommand(
  serviceId: string,
  options: { input?: string; wallet?: string }
): Promise<void> {
  const config = loadConfig();

  if (!config.walletId || !config.apiKey) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  const buyerWalletId = options.wallet || config.walletId;

  // Parse input JSON
  let input: Record<string, unknown> = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input);
    } catch {
      console.log(chalk.red('\n  Invalid JSON input. Use: --input \'{"key": "value"}\'\n'));
      process.exit(1);
    }
  }

  // First, get service info
  const infoSpinner = ora('Fetching service info...').start();
  let service: any;

  try {
    const data = await apiRequest(`/api/services/${serviceId}`);
    service = data.service || data;
    infoSpinner.succeed(`Service: ${service.name}`);
  } catch (err: any) {
    infoSpinner.fail(`Service not found: ${err.message}`);
    process.exit(1);
  }

  console.log(chalk.dim(`  Price: ${service.price?.toLocaleString() || '?'} sats | By: ${service.agentId || 'unknown'}`));
  console.log('');

  // Execute
  const execSpinner = ora('Executing service (pay → run → settle)...').start();

  try {
    const result = await apiRequest(`/api/execute/${serviceId}`, {
      method: 'POST',
      body: JSON.stringify({ buyerWalletId, input }),
    });

    execSpinner.succeed('Execution complete!');

    console.log('');
    console.log(chalk.bold('  Result'));
    console.log(chalk.dim('  ─────────────────────────────'));

    if (result.output) {
      console.log(`  ${chalk.cyan('Output:')}   ${JSON.stringify(result.output)}`);
    }
    if (result.paymentId) {
      console.log(`  ${chalk.cyan('Payment:')}  ${result.paymentId}`);
    }
    if (result.txid) {
      console.log(`  ${chalk.cyan('TX ID:')}    ${result.txid}`);
    }
    if (result.receipt) {
      console.log(`  ${chalk.cyan('Receipt:')}  ${result.receipt.id || 'generated'}`);
    }
    console.log('');
  } catch (err: any) {
    execSpinner.fail(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}
