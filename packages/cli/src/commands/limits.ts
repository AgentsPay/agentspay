import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function limitsCommand(options: {
  tx?: string;
  session?: string;
  daily?: string;
  clear?: boolean;
}): Promise<void> {
  const config = loadConfig();

  if (!config.walletId || !config.apiKey) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  // If no options provided, show current limits
  if (!options.tx && !options.session && !options.daily && !options.clear) {
    const spinner = ora('Fetching spending limits...').start();
    try {
      const data = await apiRequest(`/api/wallets/${config.walletId}`);
      const wallet = data.wallet || data;
      spinner.stop();

      console.log('');
      console.log(chalk.bold.cyan('  ⚡ Spending Limits'));
      console.log(chalk.dim('  ─────────────────────────────'));
      console.log(`  ${chalk.cyan('Per TX:')}     ${wallet.txLimit ? `${wallet.txLimit.toLocaleString()} sats` : chalk.dim('none')}`);
      console.log(`  ${chalk.cyan('Session:')}    ${wallet.sessionLimit ? `${wallet.sessionLimit.toLocaleString()} sats` : chalk.dim('none')}`);
      console.log(`  ${chalk.cyan('Daily:')}      ${wallet.dailyLimit ? `${wallet.dailyLimit.toLocaleString()} sats` : chalk.dim('none')}`);
      if (wallet.dailySpent !== undefined) {
        console.log(`  ${chalk.cyan('Spent today:')} ${wallet.dailySpent.toLocaleString()} sats`);
      }
      console.log('');
      console.log(chalk.dim('  Set limits: agentspay limits --tx 10000 --daily 100000'));
      console.log('');
    } catch (err: any) {
      spinner.fail(`Failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Set limits
  const spinner = ora('Updating spending limits...').start();

  try {
    const body: Record<string, any> = {};

    if (options.clear) {
      body.txLimit = null;
      body.sessionLimit = null;
      body.dailyLimit = null;
    } else {
      if (options.tx) body.txLimit = parseInt(options.tx, 10);
      if (options.session) body.sessionLimit = parseInt(options.session, 10);
      if (options.daily) body.dailyLimit = parseInt(options.daily, 10);
    }

    await apiRequest(`/api/wallets/${config.walletId}/limits`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    spinner.succeed(options.clear ? 'Limits cleared!' : 'Limits updated!');

    if (!options.clear) {
      if (body.txLimit) console.log(chalk.dim(`  Per TX:  ${body.txLimit.toLocaleString()} sats`));
      if (body.sessionLimit) console.log(chalk.dim(`  Session: ${body.sessionLimit.toLocaleString()} sats`));
      if (body.dailyLimit) console.log(chalk.dim(`  Daily:   ${body.dailyLimit.toLocaleString()} sats`));
    }
    console.log('');
  } catch (err: any) {
    spinner.fail(`Failed: ${err.message}`);
    process.exit(1);
  }
}
