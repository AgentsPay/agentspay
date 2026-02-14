import { truncateAddress, formatSats } from '@/lib/utils'

interface WalletBadgeProps {
  address: string
  balance?: number
}

export function WalletBadge({ address, balance }: WalletBadgeProps) {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
      <span className="text-sm font-mono text-gray-400">{truncateAddress(address)}</span>
      {balance !== undefined && (
        <>
          <span className="text-gray-600">•</span>
          <span className="text-sm font-semibold text-green-500">{formatSats(balance)} sats</span>
        </>
      )}
    </div>
  )
}
