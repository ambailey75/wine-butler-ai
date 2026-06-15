'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface UploadCardProps {
  title: string
  description: string
  icon: ReactNode
  accept: Record<string, string[]>
}

export function UploadCard({ title, description, icon, accept }: UploadCardProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0]
      if (!file) return

      setUploading(true)
      setError(null)

      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch('/api/import/upload', { method: 'POST', body: formData })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(body?.error || 'Upload failed')
        }

        const query = body.mappingSuggestion
          ? `?mapping=${encodeURIComponent(JSON.stringify(body.mappingSuggestion))}`
          : ''
        router.push(`/dashboard/import/${body.id}${query}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
        setUploading(false)
      }
    },
    [router]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
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
