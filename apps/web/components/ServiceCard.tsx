import Link from 'next/link'
import type { Service } from '@/lib/types'
import { formatSats, formatPrice, satsToUsd, formatMneeWithBsv } from '@/lib/utils'
import { useBsvPrice } from '@/lib/useBsvPrice'
import { ReputationStars } from './ReputationStars'

interface ServiceCardProps {
  service: Service
  reputation?: { successRate: number }
}

export function ServiceCard({ service, reputation }: ServiceCardProps) {
  const bsvPrice = useBsvPrice()
  const getCurrencyBadge = (currency: string) => {
    const colors = {
      BSV: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      MNEE: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    }
    return (
      <span className={`inline-block px-2 py-0.5 text-xs font-medium border rounded ${colors[currency as keyof typeof colors]}`}>
        {currency}
      </span>
    )
  }

  return (
    <Link href={`/execute/${service.id}`} className="block">
      <div className="card hover:border-blue-500/30 cursor-pointer h-full flex flex-col">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">{service.name}</h3>
            <div className="flex items-center gap-2">
              <span className="inline-block px-2 py-0.5 text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded">
                {service.category}
              </span>
              {getCurrencyBadge(service.currency)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-green-500">
              {service.currency === 'BSV' ? formatSats(service.price) : formatPrice(service.price, service.currency)}
            </div>
            {service.currency === 'BSV' && (
              <div className="text-xs text-gray-500">sats</div>
            )}
            {service.currency === 'BSV' && bsvPrice && (
              <div className="text-xs text-gray-400">≈{satsToUsd(service.price, bsvPrice)}</div>
            )}
            {service.currency === 'MNEE' && bsvPrice && (
              <div className="text-xs text-gray-400">{formatMneeWithBsv(service.price, bsvPrice)}</div>
            )}
          </div>
        </div>
        
        <p className="text-sm text-gray-400 mb-4 line-clamp-2">{service.description}</p>
        
        {/* Timeout and Dispute Window */}
        {(service.timeoutMs || service.disputeWindowMs) && (
          <div className="text-xs text-gray-500 mb-3 space-y-1">
            {service.timeoutMs && (
              <div>⏱️ Timeout: {Math.round(service.timeoutMs / 1000)}s</div>
            )}
            {service.disputeWindowMs && (
              <div>⚖️ Dispute window: {Math.round(service.disputeWindowMs / 1000 / 60)}min</div>
            )}
          </div>
        )}
        
        <div className="mt-auto">
          {reputation && (
            <ReputationStars successRate={reputation.successRate} size="sm" />
          )}
          
          {!service.active && (
            <div className="mt-3 px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded border border-red-500/20">
              Inactive
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
