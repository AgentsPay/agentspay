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

  // Execute (creates escrowed payment + pending job)
  const execSpinner = ora('Submitting job...').start();

  try {
    const result = await apiRequest(`/api/execute/${serviceId}`, {
      method: 'POST',
      body: JSON.stringify({ buyerWalletId, input }),
    });

    const jobId = result.jobId;
    if (!jobId) {
      // Legacy sync response
      execSpinner.succeed('Execution complete!');
      console.log('');
      console.log(chalk.bold('  Result'));
      console.log(chalk.dim('  ─────────────────────────────'));
      if (result.output) console.log(`  ${chalk.cyan('Output:')}   ${JSON.stringify(result.output)}`);
      if (result.paymentId) console.log(`  ${chalk.cyan('Payment:')}  ${result.paymentId}`);
      console.log('');
      return;
    }

    execSpinner.succeed(`Job created: ${jobId}`);
    console.log(`  ${chalk.cyan('Payment:')}  ${result.paymentId}`);
    console.log('');

    // Poll for job completion
    const pollSpinner = ora('Waiting for provider...').start();
    const pollInterval = 2000;
    const maxPollTime = (service.timeout || 30) * 1000 + 10000; // timeout + grace
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const jobResult = await apiRequest(`/api/jobs/${jobId}`);
        const job = jobResult.job || jobResult;

        if (job.status === 'in_progress') {
          pollSpinner.text = 'Provider working...';
        } else if (job.status === 'completed') {
          pollSpinner.succeed('Job completed!');
          console.log('');
          console.log(chalk.bold('  Result'));
          console.log(chalk.dim('  ─────────────────────────────'));
          if (job.output) console.log(`  ${chalk.cyan('Output:')}   ${JSON.stringify(job.output)}`);
          console.log(`  ${chalk.cyan('Payment:')}  ${job.paymentId}`);
          console.log(`  ${chalk.cyan('Status:')}   ${chalk.green('completed — payment released')}`);
          console.log('');
          return;
        } else if (job.status === 'failed') {
          pollSpinner.fail('Job failed');
          console.log(`  ${chalk.red('Error:')}    ${job.error || 'Unknown error'}`);
          console.log(`  ${chalk.cyan('Status:')}   ${chalk.yellow('payment refunded')}`);
          console.log('');
          process.exit(1);
        } else if (job.status === 'expired') {
          pollSpinner.fail('Job expired — provider did not respond in time');
          console.log(`  ${chalk.cyan('Status:')}   ${chalk.yellow('payment refunded')}`);
          console.log('');
          process.exit(1);
        }
      } catch {
        // Poll error — retry
      }
    }

    pollSpinner.fail('Timed out waiting for provider');
    console.log(chalk.dim(`  Job ${jobId} may still be processing. Check status with the API.`));
    console.log('');
  } catch (err: any) {
    execSpinner.fail(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}
