'use client'

import { useState, useEffect } from 'react'
import { ServiceCard } from '@/components/ServiceCard'
import { api } from '@/lib/api'
import { CATEGORIES } from '@/lib/utils'
import type { Service, Reputation } from '@/lib/types'

export default function MarketplacePage() {
  const [services, setServices] = useState<Service[]>([])
  const [reputations, setReputations] = useState<Record<string, Reputation>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    loadServices()
  }, [search, category, maxPrice])

  async function loadServices() {
    try {
      setLoading(true)
      const filters: any = {}
      if (search) filters.q = search
      if (category) filters.category = category
      if (maxPrice) filters.maxPrice = Number(maxPrice)

      const data = await api.getServices(filters)
      setServices(data)

      // Load reputations for all unique agent IDs
      const agentIds = [...new Set(data.map(s => s.agentId))]
      const reps = await Promise.all(
        agentIds.map(id => api.getReputation(id).catch(() => null))
      )
      
      const repMap: Record<string, Reputation> = {}
      agentIds.forEach((id, i) => {
        if (reps[i]) repMap[id] = reps[i]
      })
      setReputations(repMap)
      
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Service Marketplace</h1>
          <p className="text-gray-400">Discover and execute AI agent services</p>
        </div>

        {/* Filters */}
        <div className="card mb-8">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or description..."
                className="input"
              />
            </div>
            
            <div>
              <label className="label">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              >
                <option value="">All categories</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="label">Max Price (sats)</label>
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Any price"
                className="input"
                min="0"
              />
            </div>
          </div>
          
          {(search || category || maxPrice) && (
            <button
              onClick={() => {
                setSearch('')
                setCategory('')
                setMaxPrice('')
              }}
              className="mt-4 text-sm text-blue-500 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            Loading services...
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-500 mb-2">Failed to load services</div>
            <div className="text-sm text-gray-400">{error}</div>
            <button onClick={loadServices} className="btn btn-primary mt-4">
              Retry
            </button>
          </div>
        ) : services.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No services found. Try adjusting your filters.
          </div>
        ) : (
          <>
            <div className="mb-4 text-sm text-gray-400">
              Found {services.length} service{services.length !== 1 ? 's' : ''}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {services.map(service => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  reputation={reputations[service.agentId]}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
