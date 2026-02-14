export function truncateAddress(address: string, chars = 6): string {
  if (!address) return ''
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatSats(sats: number): string {
  return new Intl.NumberFormat('en-US').format(sats)
}

// BSV price cache (refreshes every 5 min)
let _bsvPriceUsd: number | null = null
let _bsvPriceLastFetch = 0

export async function getBsvPriceUsd(): Promise<number> {
  const now = Date.now()
  if (_bsvPriceUsd && now - _bsvPriceLastFetch < 300_000) return _bsvPriceUsd
  try {
    const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
    const data = await res.json()
    _bsvPriceUsd = data?.rate ?? data?.USD ?? 50
    _bsvPriceLastFetch = now
    return _bsvPriceUsd!
  } catch {
    return _bsvPriceUsd ?? 50 // fallback
  }
}

export function satsToUsd(sats: number, bsvPrice: number): string {
  const usd = (sats / 100_000_000) * bsvPrice
  if (usd < 0.01) return `<$0.01`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)
}

export function formatSatsWithUsd(sats: number, bsvPrice: number | null): string {
  const satsStr = formatSats(sats)
  if (!bsvPrice) return `${satsStr} sats`
  return `${satsStr} sats (≈${satsToUsd(sats, bsvPrice)})`
}

export function mneeToSats(mneeCents: number, bsvPrice: number): number {
  const usd = mneeCents / 100
  return Math.round((usd / bsvPrice) * 100_000_000)
}

export function formatMneeWithBsv(mneeCents: number, bsvPrice: number | null): string {
  if (!bsvPrice) return ''
  const sats = mneeToSats(mneeCents, bsvPrice)
  return `≈${formatSats(sats)} sats`
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
