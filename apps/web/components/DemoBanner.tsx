'use client'

export function DemoBanner() {
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  if (!isDemoMode) return null

  return (
    <div className="bg-yellow-500/90 text-black text-center text-sm font-medium py-1.5 px-4">
      Demo Mode — Transactions use test balances
    </div>
  )
}
