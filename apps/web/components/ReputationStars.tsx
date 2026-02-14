interface ReputationStarsProps {
  successRate: number
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
}

export function ReputationStars({ successRate, size = 'md' }: ReputationStarsProps) {
  // Convert success rate (0-1) to 5-star rating
  const rating = Math.round((successRate || 0) * 5)
  const stars = Array.from({ length: 5 }, (_, i) => i < rating)

  const getColor = () => {
    if (successRate >= 0.9) return 'text-green-500'
    if (successRate >= 0.7) return 'text-yellow-500'
    return 'text-orange-500'
  }

  return (
    <div className={`flex items-center gap-1 ${SIZES[size]}`}>
      {stars.map((filled, i) => (
        <span key={i} className={filled ? getColor() : 'text-gray-600'}>
          {filled ? '★' : '☆'}
        </span>
      ))}
      <span className="ml-1 text-xs text-gray-400">
        {Math.round(successRate * 100)}%
      </span>
    </div>
  )
}
