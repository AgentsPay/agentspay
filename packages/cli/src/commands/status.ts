import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function statusCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.walletId || !config.apiKey) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  const spinner = ora('Fetching wallet status...').start();

  try {
    const data = await apiRequest(`/api/wallets/${config.walletId}`);
    const wallet = data.wallet || data;

    spinner.stop();

    console.log('');
    console.log(chalk.bold.cyan('  ⚡ Wallet Status'));
    console.log(chalk.dim('  ─────────────────────────────'));
    console.log(`  ${chalk.cyan('ID:')}        ${wallet.id}`);
    console.log(`  ${chalk.cyan('Address:')}   ${wallet.address || config.address}`);
    console.log(`  ${chalk.cyan('Network:')}   ${config.network}`);
    console.log('');

    // Balance display
    const bsvBalance = typeof wallet.balance === 'object'
      ? wallet.balance.bsv || 0
      : wallet.balance || 0;
    const mneeBalance = typeof wallet.balance === 'object'
      ? wallet.balance.mnee || 0
      : 0;

    console.log(chalk.bold('  Balances'));
    console.log(chalk.dim('  ─────────────────────────────'));
    console.log(`  ${chalk.yellow('BSV:')}   ${formatSats(bsvBalance)} sats`);
    console.log(`  ${chalk.green('MNEE:')}  ${mneeBalance.toLocaleString()} tokens`);
    console.log('');

    // Spending limits if set
    if (wallet.sessionLimit || wallet.txLimit || wallet.dailyLimit) {
      console.log(chalk.bold('  Spending Limits'));
      console.log(chalk.dim('  ─────────────────────────────'));
      if (wallet.txLimit) console.log(`  ${chalk.cyan('Per TX:')}     ${formatSats(wallet.txLimit)} sats`);
      if (wallet.sessionLimit) console.log(`  ${chalk.cyan('Session:')}    ${formatSats(wallet.sessionLimit)} sats`);
      if (wallet.dailyLimit) console.log(`  ${chalk.cyan('Daily:')}      ${formatSats(wallet.dailyLimit)} sats`);
      if (wallet.dailySpent !== undefined) console.log(`  ${chalk.cyan('Spent today:')} ${formatSats(wallet.dailySpent)} sats`);
      console.log('');
    }

    // API connection
    console.log(chalk.dim(`  API: ${config.apiUrl}`));
    console.log('');
  } catch (err: any) {
    spinner.fail(`Failed: ${err.message}`);
    process.exit(1);
  }
}

function formatSats(sats: number): string {
  if (sats >= 100_000_000) {
    return `${(sats / 100_000_000).toFixed(8)} BSV`;
  }
  return sats.toLocaleString();
}
