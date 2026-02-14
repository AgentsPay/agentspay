'use client'

import { useState, useEffect } from 'react'
import { getBsvPriceUsd } from './utils'

/**
 * Hook that fetches and caches BSV/USD price.
 * Refreshes every 5 minutes.
 */
export function useBsvPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    let active = true

    const fetch = async () => {
      const p = await getBsvPriceUsd()
      if (active) setPrice(p)
    }

    fetch()
    const interval = setInterval(fetch, 300_000) // 5 min

    return () => { active = false; clearInterval(interval) }
  }, [])

  return price
}
