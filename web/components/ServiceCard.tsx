import Link from 'next/link'
import type { Service } from '@/lib/types'
import { formatSats } from '@/lib/utils'
import { ReputationStars } from './ReputationStars'

interface ServiceCardProps {
  service: Service
  reputation?: { successRate: number }
}

export function ServiceCard({ service, reputation }: ServiceCardProps) {
  return (
    <Link href={`/execute/${service.id}`} className="block">
      <div className="card hover:border-blue-500/30 cursor-pointer h-full">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">{service.name}</h3>
            <span className="inline-block px-2 py-0.5 text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded">
              {service.category}
            </span>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-green-500">{formatSats(service.price)}</div>
            <div className="text-xs text-gray-500">sats</div>
          </div>
        </div>
        
        <p className="text-sm text-gray-400 mb-4 line-clamp-2">{service.description}</p>
        
        {reputation && (
          <div className="mt-auto">
            <ReputationStars successRate={reputation.successRate} size="sm" />
          </div>
        )}
        
        {!service.active && (
          <div className="mt-3 px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded border border-red-500/20">
            Inactive
          </div>
        )}
      </div>
    </Link>
  )
}
