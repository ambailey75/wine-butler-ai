'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Wine,
  Upload,
  BarChart3,
  Search,
  Notebook,
  BookmarkCheck,
  Bell,
  Sparkles,
  Settings,
} from 'lucide-react'
import { NavItem } from './NavItem'

const NAV_ITEMS = [
  { href: '/dashboard/cellar', label: 'Cellar', icon: Wine },
  { href: '/dashboard/insights', label: 'Insights', icon: BarChart3 },
  { href: '/dashboard/import', label: 'Import', icon: Upload },
  { href: '/dashboard/butler', label: 'Butler', icon: Search },
  { href: '/dashboard/tastings', label: 'Tastings', icon: Notebook },
  { href: '/dashboard/watchlist', label: 'Watch List', icon: BookmarkCheck },
  { href: '/dashboard/alerts', label: 'Alerts', icon: Bell },
  {
    href: '/dashboard/assistant',
    label: 'Assistant',
    icon: Sparkles,
    soon: true,
    tooltip: 'AI sommelier chat for your collection (Phase 4)',
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    soon: true,
    tooltip: 'Account and preferences (Phase 6)',
  },
]

export function Sidebar({ alertCount = 0 }: { alertCount?: number }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col">
      <nav className="flex flex-1 flex-col gap-1 p-4">
        <Link href="/dashboard" className="mb-4 flex flex-col items-center px-3">
          <Image
            src="/wine-butler-ai-logo.png"
            alt="Wine Butler AI"
            width={200}
            height={200}
            className="mb-1"
            priority
          />
          <span className="text-xs text-muted-foreground">Wine Butler AI</span>
        </Link>
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.label}
            {...item}
            active={pathname.startsWith(item.href)}
            badgeCount={item.href === '/dashboard/alerts' ? alertCount : undefined}
          />
        ))}
      </nav>
      <div
        className="relative w-full overflow-hidden rounded-t-lg"
        style={{ height: 'clamp(220px, 33vh, 400px)' }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: '200%', height: '100%' }}>
          <Image
            src="/images/grapes-vineyard.png"
            alt="Vineyard grapes"
            fill
            style={{ objectFit: 'cover' }}
          />
        </div>
      </div>
    </div>
  )
}
