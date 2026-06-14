import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { MobileNav } from '@/components/dashboard/MobileNav'
import { TooltipProvider } from '@/components/ui/tooltip'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-border">
          <Sidebar />
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3 md:justify-end md:px-8">
            <MobileNav />
            <span className="text-sm text-muted-foreground">{user.email}</span>
          </header>
          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
