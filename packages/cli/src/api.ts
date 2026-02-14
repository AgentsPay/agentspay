import { loadConfig } from './config';

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const config = loadConfig();

  if (!config.apiUrl) {
    throw new Error('API URL not configured. Run: agentspay init');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }

  const url = `${config.apiUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json() as any;

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
  }

  return data;
}
