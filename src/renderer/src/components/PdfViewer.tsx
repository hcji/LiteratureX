import { useEffect, useState } from 'react'
import { PDFViewer as EmbedPdfViewer } from '@embedpdf/react-pdf-viewer'
import wasmAssetUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { cn, errorMessage } from '../lib/utils'
import { Spinner } from './ui/feedback'

interface LoadedDocument {
  pdfId: string
  buffer: ArrayBuffer
  wasmUrl: string
}

let wasmBlobUrl: string | null = null
let wasmBlobPromise: Promise<string> | null = null

async function loadWasmUrl(): Promise<string> {
  if (wasmBlobUrl) return wasmBlobUrl
  if (!wasmBlobPromise) {
    wasmBlobPromise = fetch(wasmAssetUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load the PDF engine (HTTP ${response.status})`)
        return response.blob()
      })
      .then((blob) => {
        wasmBlobUrl = URL.createObjectURL(blob)
        return wasmBlobUrl
      })
      .catch((error) => {
        wasmBlobPromise = null
        throw error
      })
  }
  return wasmBlobPromise
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer
}

export function PdfViewer({
  pdfId,
  title,
  className
}: {
  pdfId: string
  title?: string
  className?: string
}) {
  const { t, language } = useT()
  const theme = useAppStore((state) => state.settings?.appearance.theme ?? 'system')
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setLoaded(null)
    void (async () => {
      try {
        const [bytes, wasmUrl] = await Promise.all([window.api.pdf.read(pdfId), loadWasmUrl()])
        if (cancelled) return
        setLoaded({ pdfId, buffer: toArrayBuffer(bytes), wasmUrl })
        setLoading(false)
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfId])

  if (loading || !loaded || loaded.pdfId !== pdfId) {
    return (
      <div className={cn('flex h-full items-center justify-center gap-2 text-xs text-muted-foreground', className)}>
        <Spinner /> {t('common.loading')}
      </div>
    )
  }
  if (error) {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-xs text-destructive', className)}>
        {error}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <EmbedPdfViewer
        key={`${pdfId}:${theme}:${language}`}
        className="h-full w-full"
        style={{ width: '100%', height: '100%' }}
        config={{
          wasmUrl: loaded.wasmUrl,
          worker: true,
          log: false,
          fontFallback: null,
          fonts: { ui: null, signature: null },
          tabBar: 'never',
          theme: { preference: theme },
          i18n: { defaultLocale: language === 'zh' ? 'zh-CN' : 'en' },
          disabledCategories: [
            'annotation',
            'redaction',
            'form',
            'signature',
            'stamp',
            'attachment',
            'export',
            'print',
            'openFile',
            'save',
            'pan',
            'panel-comment',
            'panel-annotation',
            'mode-insert'
          ],
          documentManager: {
            maxDocuments: 1,
            initialDocuments: [
              {
                buffer: loaded.buffer,
                name: title || 'document.pdf',
                documentId: pdfId,
                autoActivate: true
              }
            ]
          }
        }}
      />
    </div>
  )
}
