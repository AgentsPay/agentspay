interface PaymentStatusProps {
  status: 'escrowed' | 'released' | 'refunded' | 'disputed'
}

const STATUS_STYLES = {
  escrowed: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  released: 'bg-green-500/10 text-green-500 border-green-500/20',
  refunded: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  disputed: 'bg-red-500/10 text-red-500 border-red-500/20',
}

const STATUS_LABELS = {
  escrowed: 'Escrowed',
  released: 'Released',
  refunded: 'Refunded',
  disputed: 'Disputed',
}

export function PaymentStatus({ status }: PaymentStatusProps) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
