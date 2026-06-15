import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getRecentImports } from '@/lib/import/queries'
import { UploadCard } from '@/components/import/UploadCard'
import { ImportStatusBadge } from '@/components/import/ImportStatusBadge'
import { Button } from '@/components/ui/button'

export default async function ImportHubPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const recentImports = await getRecentImports(user.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Import Your Collection</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a spreadsheet, an invoice, or photos of your wine labels — we&apos;ll do the rest.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/import/history">Import history</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <UploadCard
          title="Spreadsheet"
          description="Excel or CSV export of your cellar"
          icon={<FileSpreadsheet className="h-8 w-8 text-primary" />}
          accept={{
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          }}
        />
        <UploadCard
          title="PDF Invoice"
          description="A wine shop or auction invoice"
          icon={<FileText className="h-8 w-8 text-primary" />}
          accept={{ 'application/pdf': ['.pdf'] }}
        />
        <UploadCard
          title="Label Photos"
          description="A photo of a wine label"
          icon={<ImageIcon className="h-8 w-8 text-primary" />}
          accept={{
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
          }}
        />
      </div>

      {recentImports.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Recent imports</h2>
          <div className="space-y-2">
            {recentImports.map((importRecord) => (
              <div
                key={importRecord.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {importRecord.originalFilename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                      importRecord.createdAt
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <ImportStatusBadge status={importRecord.status} />
                  {importRecord.status === 'REVIEW' && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/import/${importRecord.id}`}>Review</Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Link href="/dashboard/import/history" className="text-sm text-primary hover:underline">
            View all imports
          </Link>
        </div>
      )}
    </div>
  )
}
