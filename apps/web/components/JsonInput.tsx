'use client'

import { useState, useCallback, useRef } from 'react'

interface JsonInputProps {
  value: string
  onChange: (value: string, isValid: boolean, parsed?: any) => void
  placeholder?: string
  rows?: number
}

export function JsonInput({ value, onChange, placeholder = '{}', rows = 6 }: JsonInputProps) {
  const [error, setError] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const handleChange = useCallback((rawValue: string) => {
    if (!rawValue.trim()) {
      setError(null)
      onChangeRef.current(rawValue, false)
      return
    }

    try {
      const parsed = JSON.parse(rawValue)
      setError(null)
      onChangeRef.current(rawValue, true, parsed)
    } catch (err: any) {
      setError(err.message)
      onChangeRef.current(rawValue, false)
    }
  }, [])

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
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
