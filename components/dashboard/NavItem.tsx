import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface NavItemProps {
  href: string
  label: string
  icon: LucideIcon
  soon?: boolean
  tooltip?: string
  active?: boolean
}

export function NavItem({ href, label, icon: Icon, soon, tooltip, active }: NavItemProps) {
  const baseClasses =
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors'

  if (soon) {
    const item = (
      <div
        aria-disabled="true"
        className={cn(baseClasses, 'cursor-default text-muted-foreground/60')}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{label}</span>
        <Badge variant="outline" className="border-primary/40 text-[10px] font-normal text-primary">
          Soon
        </Badge>
      </div>
    )

    if (!tooltip) return item

    return (
      <Tooltip>
        <TooltipTrigger asChild>{item}</TooltipTrigger>
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        baseClasses,
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  )
}
