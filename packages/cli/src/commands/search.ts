import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { loadConfig } from '../config';
import { apiRequest } from '../api';

export async function searchCommand(
  query: string | undefined,
  options: { category?: string; currency?: string; limit?: string }
): Promise<void> {
  const config = loadConfig();

  if (!config.apiUrl) {
    console.log(chalk.red('\n  Not initialized. Run: agentspay init\n'));
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (options.category) params.set('category', options.category);
  if (options.currency) params.set('currency', options.currency);

  const spinner = ora('Searching services...').start();

  try {
    const data = await apiRequest(`/api/services?${params}`);
    const services = data.services || data || [];

    spinner.stop();

    if (services.length === 0) {
      console.log(chalk.yellow('\n  No services found.\n'));
      return;
    }

    const limit = parseInt(options.limit || '20', 10);
    const display = services.slice(0, limit);

    console.log('');
    console.log(chalk.bold.cyan(`  ⚡ ${services.length} service(s) found`));
    console.log('');

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Name'),
        chalk.cyan('Category'),
        chalk.cyan('Price'),
        chalk.cyan('Currency'),
        chalk.cyan('Rating'),
      ],
      colWidths: [10, 25, 15, 12, 10, 8],
      style: { head: [], border: [] },
    });

    for (const svc of display) {
      table.push([
        (svc.id || '').substring(0, 8),
        svc.name || 'unnamed',
        svc.category || '-',
        `${(svc.price || 0).toLocaleString()} sat`,
        svc.currency || 'BSV',
        svc.reputation?.score ? `${svc.reputation.score}/5` : '-',
      ]);
    }

    console.log(table.toString());
    console.log('');
    console.log(chalk.dim('  Execute a service: agentspay send <service-id>'));
    console.log('');
  } catch (err: any) {
    spinner.fail(`Search failed: ${err.message}`);
    process.exit(1);
  }
}
