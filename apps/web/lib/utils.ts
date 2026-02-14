export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatSats(sats: number): string {
  return new Intl.NumberFormat('en-US').format(sats)
}

export function formatCurrency(amount: number, currency: 'BSV' | 'MNEE'): string {
  if (currency === 'BSV') {
    return `${formatSats(amount)} sats`
  } else {
    // MNEE is USD-pegged
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100) // assuming MNEE is in cents
  }
}

export function formatPrice(price: number, currency: 'BSV' | 'MNEE'): string {
  if (currency === 'BSV') {
    return formatSats(price)
  } else {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price / 100)
  }
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
