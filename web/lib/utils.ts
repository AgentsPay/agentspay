export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatSats(sats: number): string {
  return new Intl.NumberFormat('en-US').format(sats)
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function getExplorerUrl(txId: string): string {
  return `https://whatsonchain.com/tx/${txId}`
}

export const CATEGORIES = [
  'security',
  'data',
  'ai',
  'finance',
  'utility',
  'social',
  'other'
] as const

export type Category = typeof CATEGORIES[number]
