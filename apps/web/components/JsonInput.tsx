'use client'

import { useState, useEffect } from 'react'

interface JsonInputProps {
  value: string
  onChange: (value: string, isValid: boolean, parsed?: any) => void
  placeholder?: string
  rows?: number
}

export function JsonInput({ value, onChange, placeholder = '{}', rows = 6 }: JsonInputProps) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!value.trim()) {
      setError(null)
      onChange(value, false)
      return
    }

    try {
      const parsed = JSON.parse(value)
      setError(null)
      onChange(value, true, parsed)
    } catch (err: any) {
      setError(err.message)
      onChange(value, false)
    }
  }, [value, onChange])

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value, false)}
        placeholder={placeholder}
        rows={rows}
        className={`font-mono text-sm w-full bg-[var(--surface)] border rounded-lg px-4 py-3 text-white focus:outline-none transition-colors ${
          error ? 'border-red-500' : 'border-[var(--border)] focus:border-blue-500'
        }`}
      />
      {error && (
        <p className="mt-2 text-sm text-red-500">
          Invalid JSON: {error}
        </p>
      )}
    </div>
  )
}
