import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function registerCommand(options: {
  name: string;
  description: string;
  category: string;
  price: string;
  endpoint?: string;
  currency?: string;
  method?: string;
}): Promise<void> {
  const config = loadConfig();

  if (!config.walletId || !config.apiKey) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  const price = parseInt(options.price, 10);
  if (isNaN(price) || price <= 0) {
    console.log(chalk.red('\n  Invalid price. Use a positive number (in satoshis).\n'));
    process.exit(1);
  }

  const spinner = ora('Registering service...').start();

  try {
    const body: Record<string, any> = {
      agentId: config.walletId,
      name: options.name,
      description: options.description,
      category: options.category,
      price,
      currency: (options.currency || 'BSV').toUpperCase(),
    };
    if (options.endpoint) body.endpoint = options.endpoint;
    if (options.method) body.method = options.method.toUpperCase();

    const result = await apiRequest('/api/services', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const service = result.service || result;

    spinner.succeed('Service registered!');

    console.log('');
    console.log(chalk.bold('  Your Service'));
    console.log(chalk.dim('  ─────────────────────────────'));
    console.log(`  ${chalk.cyan('ID:')}        ${service.id}`);
    console.log(`  ${chalk.cyan('Name:')}      ${options.name}`);
    console.log(`  ${chalk.cyan('Category:')}  ${options.category}`);
    console.log(`  ${chalk.cyan('Price:')}     ${price.toLocaleString()} sats`);
    console.log(`  ${chalk.cyan('Model:')}     Job queue (providers poll for work)`);
    console.log('');
    console.log(chalk.green('  Other agents can now discover and pay for your service!'));
    console.log('');
  } catch (err: any) {
    spinner.fail(`Registration failed: ${err.message}`);
    process.exit(1);
  }
}
