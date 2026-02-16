#!/usr/bin/env node
/**
 * AgentPay MCP Server
 * 
 * Model Context Protocol server that exposes AgentPay tools to AI agents.
 * Any MCP-compatible client (Claude, OpenAI, etc.) can use this to:
 * - Create wallets
 * - Send payments
 * - Register services
 * - Execute services (pay → run → settle)
 * - Check balances
 * 
 * Usage:
 *   npx @agentspay/mcp
 *   AGENTPAY_API_URL=http://localhost:3100 npx @agentspay/mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

// AGENTSPAY_* is kept only as legacy fallback.
const API_URL = process.env.AGENTPAY_API_URL || process.env.AGENTSPAY_API_URL || 'http://localhost:3100';
const API_KEY = process.env.AGENTPAY_API_KEY || process.env.AGENTSPAY_API_KEY || '';

// ─── HTTP Client ───

async function apiRequest(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }

  return data;
}

// ─── Tool Definitions ───

const TOOLS: Tool[] = [
  {
    name: 'create_wallet',
    description: 'Create a new AgentPay wallet. Returns wallet ID, address, API key, and private key (shown once). The wallet can hold BSV (satoshis) and MNEE (stablecoin) for paying other AI agents.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_balance',
    description: 'Check the balance of an AgentPay wallet. Shows BSV and MNEE balances, plus spending limits if set.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletId: {
          type: 'string',
          description: 'The wallet ID to check',
        },
      },
      required: ['walletId'],
    },
  },
  {
    name: 'fund_wallet',
    description: 'Fund a wallet with test BSV or MNEE tokens (testnet/demo mode only). Use this to add balance before executing services.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletId: {
          type: 'string',
          description: 'The wallet ID to fund',
        },
        amount: {
          type: 'number',
          description: 'Amount to add (satoshis for BSV, cents for MNEE)',
          default: 100000,
        },
        currency: {
          type: 'string',
          enum: ['BSV', 'MNEE'],
          description: 'Currency to fund',
          default: 'BSV',
        },
      },
      required: ['walletId'],
    },
  },
  {
    name: 'search_services',
    description: 'Search the AgentPay marketplace for services offered by other AI agents. Returns service IDs, names, prices, and descriptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword (e.g. "vulnerability scanner", "translation", "data analysis")',
        },
        category: {
          type: 'string',
          description: 'Category filter (e.g. "security", "ai", "data")',
        },
        currency: {
          type: 'string',
          enum: ['BSV', 'MNEE'],
          description: 'Filter by currency',
        },
        maxPrice: {
          type: 'number',
          description: 'Maximum price in satoshis',
        },
      },
    },
  },
  {
    name: 'register_service',
    description: 'Register your AI agent as a service provider on the AgentPay marketplace. No endpoint needed — providers poll for jobs via the job queue.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'Your wallet ID (acts as your agent identity)',
        },
        name: {
          type: 'string',
          description: 'Service name',
        },
        description: {
          type: 'string',
          description: 'What your service does',
        },
        category: {
          type: 'string',
          description: 'Category (e.g. "security", "ai", "data", "translation")',
        },
        price: {
          type: 'number',
          description: 'Price per execution in satoshis',
        },
        currency: {
          type: 'string',
          enum: ['BSV', 'MNEE'],
          default: 'BSV',
        },
      },
      required: ['agentId', 'name', 'description', 'category', 'price'],
    },
  },
  {
    name: 'execute_service',
    description: 'Submit a job to a service on the marketplace. This escrows payment and creates a pending job. The provider polls for jobs, accepts, and submits results. Returns a jobId to poll for results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        serviceId: {
          type: 'string',
          description: 'The service ID to execute',
        },
        buyerWalletId: {
          type: 'string',
          description: 'Your wallet ID to pay from',
        },
        input: {
          type: 'object',
          description: 'Input data for the service (varies by service)',
        },
      },
      required: ['serviceId', 'buyerWalletId'],
    },
  },
  {
    name: 'get_job',
    description: 'Get the status and result of a job. Poll this after execute_service to check if the provider has completed the work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID returned from execute_service',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'list_jobs',
    description: 'List your jobs as a buyer or provider. Providers use this to discover pending jobs to accept.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        role: {
          type: 'string',
          enum: ['buyer', 'provider'],
          description: 'Filter by role (buyer or provider)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'failed', 'expired'],
          description: 'Filter by job status',
        },
      },
    },
  },
  {
    name: 'accept_job',
    description: 'Accept a pending job as a provider. Changes job status to in_progress.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID to accept',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'submit_job_result',
    description: 'Submit the result of a job as a provider. Payment is released to you automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID to submit result for',
        },
        output: {
          type: 'object',
          description: 'The output/result data',
        },
      },
      required: ['jobId', 'output'],
    },
  },
  {
    name: 'fail_job',
    description: 'Report that a job failed as a provider. Payment is refunded to the buyer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        jobId: {
          type: 'string',
          description: 'The job ID that failed',
        },
        error: {
          type: 'string',
          description: 'Error message explaining the failure',
        },
      },
      required: ['jobId', 'error'],
    },
  },
  {
    name: 'send_payment',
    description: 'Send a direct payment to another wallet address (not tied to a service). For peer-to-peer payments between agents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromWalletId: {
          type: 'string',
          description: 'Source wallet ID',
        },
        toAddress: {
          type: 'string',
          description: 'Destination BSV address',
        },
        amount: {
          type: 'number',
          description: 'Amount in satoshis',
        },
      },
      required: ['fromWalletId', 'toAddress', 'amount'],
    },
  },
  {
    name: 'set_spending_limits',
    description: 'Set spending limits on a wallet to prevent runaway costs. Supports per-transaction, per-session, and daily limits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletId: {
          type: 'string',
          description: 'Wallet ID to set limits on',
        },
        txLimit: {
          type: 'number',
          description: 'Maximum satoshis per transaction (null to remove)',
        },
        sessionLimit: {
          type: 'number',
          description: 'Maximum satoshis per session (null to remove)',
        },
        dailyLimit: {
          type: 'number',
          description: 'Maximum satoshis per day (null to remove)',
        },
      },
      required: ['walletId'],
    },
  },
  {
    name: 'get_receipt',
    description: 'Get a cryptographic receipt for a payment. Receipts prove that a service was executed and paid for, with provider and platform signatures.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        paymentId: {
          type: 'string',
          description: 'The payment ID',
        },
      },
      required: ['paymentId'],
    },
  },
  {
    name: 'get_reputation',
    description: 'Get the reputation score and transaction history of an agent on the marketplace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent/wallet ID to check',
        },
      },
      required: ['agentId'],
    },
  },
];

// ─── Tool Handlers ───

async function handleToolCall(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'create_wallet': {
      const result = await apiRequest('/api/wallets', { method: 'POST' });
      return JSON.stringify({
        walletId: result.wallet?.id || result.id,
        address: result.wallet?.address || result.address,
        apiKey: result.apiKey,
        privateKey: result.privateKey,
        message: 'Wallet created! Save your private key — it is shown only once.',
      }, null, 2);
    }

    case 'check_balance': {
      const result = await apiRequest(`/api/wallets/${args.walletId}`);
      const w = result.wallet || result;
      return JSON.stringify({
        walletId: w.id,
        address: w.address,
        balances: w.balances || { BSV: { amount: w.balance || 0 }, MNEE: { amount: w.balanceMnee || 0 } },
        limits: {
          txLimit: w.txLimit || null,
          sessionLimit: w.sessionLimit || null,
          dailyLimit: w.dailyLimit || null,
          dailySpent: w.dailySpent || 0,
        },
      }, null, 2);
    }

    case 'fund_wallet': {
      const currency = args.currency || 'BSV';
      const amount = args.amount || 100000;
      const endpoint = currency === 'MNEE'
        ? `/api/wallets/${args.walletId}/fund-mnee`
        : `/api/wallets/${args.walletId}/fund`;
      const result = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      return JSON.stringify({
        funded: true,
        amount,
        currency,
        newBalance: result.wallet?.balance || result.balance,
      }, null, 2);
    }

    case 'search_services': {
      const params = new URLSearchParams();
      if (args.query) params.set('q', args.query);
      if (args.category) params.set('category', args.category);
      if (args.currency) params.set('currency', args.currency);
      if (args.maxPrice) params.set('maxPrice', String(args.maxPrice));
      const result = await apiRequest(`/api/services?${params}`);
      const services = (result.services || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        price: s.price,
        currency: s.currency,
      }));
      return JSON.stringify({ services, count: services.length }, null, 2);
    }

    case 'register_service': {
      const body: Record<string, any> = {
        agentId: args.agentId,
        name: args.name,
        description: args.description,
        category: args.category,
        price: args.price,
        currency: args.currency || 'BSV',
      };
      const result = await apiRequest('/api/services', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return JSON.stringify({
        registered: true,
        serviceId: result.service?.id || result.id,
        name: args.name,
        price: args.price,
        message: 'Service registered. Buyers submit jobs through the queue. Poll GET /api/jobs?role=provider&status=pending to receive work.',
      }, null, 2);
    }

    case 'execute_service': {
      const result = await apiRequest(`/api/execute/${args.serviceId}`, {
        method: 'POST',
        body: JSON.stringify({
          buyerWalletId: args.buyerWalletId,
          input: args.input || {},
        }),
      });
      return JSON.stringify({
        submitted: true,
        jobId: result.jobId,
        paymentId: result.paymentId,
        status: result.status || 'pending',
        expiresAt: result.expiresAt,
        message: 'Job submitted. Poll get_job with the jobId to check for results.',
      }, null, 2);
    }

    case 'get_job': {
      const result = await apiRequest(`/api/jobs/${args.jobId}`);
      const job = result.job || result;
      return JSON.stringify({
        id: job.id,
        status: job.status,
        output: job.output,
        error: job.error,
        createdAt: job.createdAt,
        acceptedAt: job.acceptedAt,
        completedAt: job.completedAt,
        expiresAt: job.expiresAt,
      }, null, 2);
    }

    case 'list_jobs': {
      const params = new URLSearchParams();
      if (args.role) params.set('role', args.role);
      if (args.status) params.set('status', args.status);
      const result = await apiRequest(`/api/jobs?${params}`);
      const jobs = (result.jobs || []).map((j: any) => ({
        id: j.id,
        serviceId: j.serviceId,
        status: j.status,
        createdAt: j.createdAt,
        expiresAt: j.expiresAt,
      }));
      return JSON.stringify({ jobs, count: jobs.length }, null, 2);
    }

    case 'accept_job': {
      const result = await apiRequest(`/api/jobs/${args.jobId}/accept`, { method: 'POST' });
      return JSON.stringify({
        accepted: true,
        jobId: args.jobId,
        status: result.job?.status || 'in_progress',
        input: result.job?.input,
        message: 'Job accepted. Process the input and submit result with submit_job_result.',
      }, null, 2);
    }

    case 'submit_job_result': {
      const result = await apiRequest(`/api/jobs/${args.jobId}/result`, {
        method: 'POST',
        body: JSON.stringify({ output: args.output }),
      });
      return JSON.stringify({
        completed: true,
        jobId: args.jobId,
        status: result.job?.status || 'completed',
        message: 'Job completed. Payment has been released to your wallet.',
      }, null, 2);
    }

    case 'fail_job': {
      const result = await apiRequest(`/api/jobs/${args.jobId}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error: args.error }),
      });
      return JSON.stringify({
        failed: true,
        jobId: args.jobId,
        status: result.job?.status || 'failed',
        message: 'Job marked as failed. Payment has been refunded to the buyer.',
      }, null, 2);
    }

    case 'send_payment': {
      // Direct P2P payment (if supported by the API)
      const result = await apiRequest('/api/payments/send', {
        method: 'POST',
        body: JSON.stringify({
          fromWalletId: args.fromWalletId,
          toAddress: args.toAddress,
          amount: args.amount,
        }),
      });
      return JSON.stringify({
        sent: true,
        amount: args.amount,
        txId: result.txId || result.txid,
      }, null, 2);
    }

    case 'set_spending_limits': {
      const body: Record<string, any> = {};
      if ('txLimit' in args) body.txLimit = args.txLimit;
      if ('sessionLimit' in args) body.sessionLimit = args.sessionLimit;
      if ('dailyLimit' in args) body.dailyLimit = args.dailyLimit;
      const result = await apiRequest(`/api/wallets/${args.walletId}/limits`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return JSON.stringify({
        updated: true,
        limits: result.limits,
      }, null, 2);
    }

    case 'get_receipt': {
      const result = await apiRequest(`/api/receipts/${args.paymentId}`);
      return JSON.stringify(result.receipt || result, null, 2);
    }

    case 'get_reputation': {
      const result = await apiRequest(`/api/agents/${args.agentId}/reputation`);
      return JSON.stringify(result.reputation || result, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server Setup ───

const server = new Server(
  {
    name: 'agentspay-mcp',
    version: '0.3.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleToolCall(name, args || {});
    return {
      content: [{ type: 'text' as const, text: result }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentPay MCP server running on stdio');
  console.error(`API: ${API_URL}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
