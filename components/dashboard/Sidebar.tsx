'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wine, Upload, Sparkles, Bell, Settings } from 'lucide-react'
import { NavItem } from './NavItem'

const NAV_ITEMS = [
  { href: '/dashboard/cellar', label: 'Cellar', icon: Wine },
  {
    href: '/dashboard/import',
    label: 'Import',
    icon: Upload,
    soon: true,
    tooltip: 'Upload Excel, PDF invoices, or label photos (Phase 3)',
  },
  {
    href: '/dashboard/assistant',
    label: 'Assistant',
    icon: Sparkles,
    soon: true,
    tooltip: 'AI sommelier chat for your collection (Phase 4)',
  },
  {
    href: '/dashboard/alerts',
    label: 'Alerts',
    icon: Bell,
    soon: true,
    tooltip: 'Drink-window notifications (Phase 5)',
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    soon: true,
    tooltip: 'Account and preferences (Phase 6)',
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav className="flex h-full flex-col gap-1 p-4">
      <Link
        href="/dashboard"
        className="mb-4 px-3 font-serif text-lg font-bold text-primary"
      >
        Wine Butler AI
      </Link>
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.label} {...item} active={pathname.startsWith(item.href)} />
      ))}
    </nav>
  )
}
