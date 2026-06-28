'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Extensions that Windows/Chrome may assign an unexpected or empty MIME type.
// If react-dropzone rejects these, we bypass the rejection and upload anyway.
const EXTENSION_BYPASS = new Set(['mhtml', 'mht', 'eml'])

interface UploadCardProps {
  title: string
  description: string
  icon: ReactNode
  accept: Record<string, string[]>
  sourceHint?: 'invoice' | 'label'
  importType: 'NEW_INVENTORY' | 'MATCH_CONSUMED' | 'HISTORICAL_CONSUMED'
  historicalConsumedDate?: string
}

export function UploadCard({ title, description, icon, accept, sourceHint, importType, historicalConsumedDate }: UploadCardProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true)
      setError(null)

      const formData = new FormData()
      formData.append('file', file)
      if (sourceHint) formData.append('sourceHint', sourceHint)
      formData.append('importType', importType)
      if (importType === 'HISTORICAL_CONSUMED' && historicalConsumedDate) {
        formData.append('historicalConsumedDate', historicalConsumedDate)
      }

      try {
        const res = await fetch('/api/import/upload', { method: 'POST', body: formData })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(body?.error || 'Upload failed')
        }

        const params = new URLSearchParams()
        if (body.mappingSuggestion) {
          params.set('mapping', JSON.stringify(body.mappingSuggestion))
        }
        if (body.regionSplitColumns && Object.keys(body.regionSplitColumns).length > 0) {
          params.set('regionSplits', JSON.stringify(body.regionSplitColumns))
        }
        if (body.countryStateSplitColumns && Object.keys(body.countryStateSplitColumns).length > 0) {
          params.set('countryStateSplits', JSON.stringify(body.countryStateSplitColumns))
        }
        const query = params.toString() ? `?${params.toString()}` : ''
        router.push(`/dashboard/import/${body.id}${query}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
        setUploading(false)
      }
    },
    [router, sourceHint, importType, historicalConsumedDate]
  )

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0]
      if (!file) return
      console.log('[UploadCard] Accepted file:', file.name, '| type:', file.type || '(empty)')
      await uploadFile(file)
    },
    [uploadFile]
  )

  const onDropRejected = useCallback(
    (fileRejections: FileRejection[]) => {
      const rejection = fileRejections[0]
      if (!rejection) return

      const { file, errors } = rejection
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      console.log(
        '[UploadCard] Rejected file:', file.name,
        '| type:', file.type || '(empty)',
        '| ext:', ext,
        '| errors:', errors.map((e) => e.code).join(', ')
      )

      if (EXTENSION_BYPASS.has(ext)) {
        // MIME type varies by OS/browser for these formats — upload by extension
        console.log('[UploadCard] Bypassing rejection — uploading by extension:', ext)
        void uploadFile(file)
      } else {
        setError('File type not supported. Use PDF, HTML, MHTML, EML, or image files.')
      }
    },
    [uploadFile]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept,
    maxFiles: 1,
    disabled: uploading,
  })

  return (
    <Card
      {...getRootProps()}
      className={cn(
        'cursor-pointer border-dashed text-center transition-colors hover:border-primary/50',
        isDragActive && 'border-primary bg-primary/5',
        uploading && 'cursor-default opacity-80'
      )}
    >
      <input {...getInputProps()} />
      <CardHeader className="items-center">
        {uploading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : icon}
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {uploading ? 'Uploading and processing...' : 'Drag & drop a file or click to browse'}
        {error && <p className="mt-2 text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
