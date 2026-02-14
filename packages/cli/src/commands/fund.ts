import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function fundCommand(options: { amount?: string; currency?: string }): Promise<void> {
  const config = loadConfig();

  if (!config.walletId || !config.apiKey) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  const amount = parseInt(options.amount || '100000', 10);
  const currency = (options.currency || 'BSV').toUpperCase();

  if (isNaN(amount) || amount <= 0) {
    console.log(chalk.red('\n  Invalid amount. Use a positive number.\n'));
    process.exit(1);
  }

  const spinner = ora(`Funding ${amount.toLocaleString()} ${currency === 'MNEE' ? 'MNEE tokens' : 'satoshis'}...`).start();

  try {
    const endpoint = currency === 'MNEE'
      ? `/api/wallets/${config.walletId}/fund-mnee`
      : `/api/wallets/${config.walletId}/fund`;

    const result = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });

    spinner.succeed(`Funded! ${amount.toLocaleString()} ${currency === 'MNEE' ? 'MNEE tokens' : 'satoshis'} added`);

    const newBalance = result.wallet?.balance || result.balance;
    if (newBalance !== undefined) {
      const display = typeof newBalance === 'object'
        ? `BSV: ${(newBalance.bsv || 0).toLocaleString()} sats | MNEE: ${(newBalance.mnee || 0).toLocaleString()}`
        : `${newBalance.toLocaleString()} sats`;
      console.log(chalk.dim(`  New balance: ${display}`));
    }
    console.log('');
  } catch (err: any) {
    spinner.fail(`Funding failed: ${err.message}`);

    if (err.message.includes('AGENTPAY_DEMO')) {
      console.log(chalk.dim('\n  Funding only available in demo/testnet mode.'));
      console.log(chalk.dim('  For mainnet, send BSV directly to your wallet address.\n'));
    }
    process.exit(1);
  }
}
