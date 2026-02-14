'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/utils'

interface CopyButtonProps {
  text: string
  label?: string
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md hover:border-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? '✓ Copied' : label || 'Copy'}
    </button>
  )
}
