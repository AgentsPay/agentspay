'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/marketplace', label: 'Marketplace', icon: '🛒' },
  { href: '/wallet', label: 'Wallet', icon: '👛' },
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/docs', label: 'Docs', icon: '📖' },
]

export function Navigation() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold gradient-text">AgentsPay</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map(item => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-medium transition-colors ${
                    isActive ? 'text-blue-500' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* Desktop Right */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              API Docs
            </a>
            <a
              href="https://github.com/agentspay/agentspay"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              GitHub →
            </a>
          </div>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex flex-col gap-1.5 p-2"
            aria-label="Toggle menu"
          >
            <span className={`block w-6 h-0.5 bg-gray-300 transition-all duration-200 ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-6 h-0.5 bg-gray-300 transition-all duration-200 ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-6 h-0.5 bg-gray-300 transition-all duration-200 ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--bg)] animate-in slide-in-from-top duration-200">
          <div className="px-4 py-3 space-y-1">
            {NAV_ITEMS.map(item => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-500'
                      : 'text-gray-400 hover:bg-[var(--surface)] hover:text-white'
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
            <div className="border-t border-[var(--border)] pt-2 mt-2 space-y-1">
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-[var(--surface)] hover:text-white"
              >
                <span>📖</span> API Docs
              </a>
              <a
                href="https://github.com/agentspay/agentspay"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-[var(--surface)] hover:text-white"
              >
                <span>🐙</span> GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
