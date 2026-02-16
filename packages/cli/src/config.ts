import Conf from 'conf';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentPayConfig {
  apiUrl: string;
  apiKey: string | null;
  walletId: string | null;
  address: string | null;
  network: 'mainnet' | 'testnet';
}

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentspay');

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getConfigPath(): string {
  return path.join(CONFIG_DIR, 'config.json');
}

export function loadConfig(): AgentPayConfig {
  ensureConfigDir();
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch {
      return defaultConfig();
    }
  }

  return defaultConfig();
}

export function saveConfig(config: Partial<AgentPayConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
}

export function clearConfig(): void {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

function defaultConfig(): AgentPayConfig {
  // AGENTSPAY_* is kept only as legacy fallback.
  const apiUrl = process.env.AGENTPAY_API_URL || process.env.AGENTSPAY_API_URL || 'https://api.agentspay.com';
  const apiKey = process.env.AGENTPAY_API_KEY || process.env.AGENTSPAY_API_KEY || null;

  return {
    apiUrl,
    apiKey,
    walletId: null,
    address: null,
    network: 'testnet',
  };
}
