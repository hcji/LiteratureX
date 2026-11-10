import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useT } from '../i18n'
import { errorMessage } from '../lib/utils'
import { Spinner } from './ui/feedback'
import { Button } from './ui/button'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfPageProxy {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: Record<string, unknown>) => { promise: Promise<void>; cancel: () => void }
  cleanup?: () => void
}

interface PdfDocument {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageProxy>
  cleanup?: () => Promise<void> | void
  destroy?: () => Promise<void>
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>
  destroy: () => Promise<void>
}

interface PageSize {
  width: number
  height: number
}

const FALLBACK_PAGE: PageSize = { width: 612, height: 792 }

function PdfPageCanvas({
  doc,
  pageNumber,
  zoom,
  size,
  register,
  scrollRoot
}: {
  doc: PdfDocument
  pageNumber: number
  zoom: number
  size: PageSize
  register: (pageNumber: number, element: HTMLDivElement | null) => void
  scrollRoot: () => HTMLElement | null
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { root: scrollRoot(), rootMargin: '800px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollRoot])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    void (async () => {
      try {
        renderTaskRef.current?.cancel()
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: zoom })
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas is not available')
        const task = page.render({
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        })
        renderTaskRef.current = task
        await task.promise
        page.cleanup?.()
      } catch (caught) {
        if ((caught as { name?: string })?.name !== 'RenderingCancelledException') {
          // Keep the page blank; the toolbar still reports document-level errors.
        }
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [visible, doc, pageNumber, zoom])

  const width = Math.max(1, size.width * zoom)
  const height = Math.max(1, size.height * zoom)

  return (
    <div
      ref={(element) => {
        wrapperRef.current = element
        register(pageNumber, element)
      }}
      data-pdf-page={pageNumber}
      className="relative shrink-0 bg-white shadow-lg ring-1 ring-black/5"
      style={{ width: `${Math.floor(width)}px`, height: `${Math.floor(height)}px` }}
    >
      {visible ? <canvas ref={canvasRef} className="block" /> : null}
    </div>
  )
}

export function PdfViewer({ pdfId, className }: { pdfId: string; className?: string }) {
  const { t } = useT()
  const documentRef = useRef<PdfDocument | null>(null)
  const loadingTaskRef = useRef<PdfLoadingTask | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const scrollFrame = useRef<number | null>(null)
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [zoom, setZoom] = useState(1.15)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [sizes, setSizes] = useState<Record<number, PageSize>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setCurrentPage(1)
    setSizes({})
    void (async () => {
      try {
        const bytes = await window.api.pdf.read(pdfId)
        const task = pdfjs.getDocument({ data: bytes }) as unknown as PdfLoadingTask
        loadingTaskRef.current = task
        const loaded = await task.promise
        if (cancelled) return
        documentRef.current = loaded
        setDoc(loaded)
        setNumPages(loaded.numPages)
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
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      setDoc(null)
      if (task) {
        void task.destroy().catch(() => undefined)
      } else if (typeof documentRef.current?.destroy === 'function') {
        void documentRef.current.destroy().catch(() => undefined)
      } else {
        void Promise.resolve(documentRef.current?.cleanup?.()).catch(() => undefined)
      }
      documentRef.current = null
    }
  }, [pdfId])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async () => {
      const next: Record<number, PageSize> = {}
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        try {
          const page = await doc.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })
          next[pageNumber] = { width: viewport.width, height: viewport.height }
        } catch {
          next[pageNumber] = FALLBACK_PAGE
        }
        if (cancelled) return
        if (pageNumber === 1 || pageNumber % 10 === 0 || pageNumber === doc.numPages) {
          setSizes({ ...next })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  const registerPage = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageRefs.current.set(pageNumber, element)
    else pageRefs.current.delete(pageNumber)
  }, [])

  const scrollRoot = useCallback(() => containerRef.current, [])

  const updateCurrentPage = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const threshold = container.getBoundingClientRect().top + 80
    let current = 1
    for (const [pageNumber, element] of pageRefs.current.entries()) {
      if (element.getBoundingClientRect().top <= threshold) current = Math.max(current, pageNumber)
    }
    setCurrentPage(current)
  }, [])

  const handleScroll = (): void => {
    if (scrollFrame.current != null) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null
      updateCurrentPage()
    })
  }

  const scrollToPage = (pageNumber: number): void => {
    const container = containerRef.current
    const target = pageRefs.current.get(pageNumber)
    if (!container || !target) return
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollTo({ top: container.scrollTop + offset - 8, behavior: 'smooth' })
    setCurrentPage(pageNumber)
  }

  const fitWidth = (): void => {
    const container = containerRef.current
    if (!container) return
    const pageWidth = (sizes[1] ?? FALLBACK_PAGE).width
    const available = container.clientWidth - 28
    setZoom(Math.max(0.4, Math.min(3, available / pageWidth)))
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    )
  }
  if (error) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">{error}</div>
  }

  return (
    <div className={className}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-2">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={currentPage <= 1}
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="min-w-[64px] text-center text-[11px] tabular-nums text-muted-foreground">
            {currentPage} / {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={currentPage >= numPages}
            onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
          >
            <ChevronRight size={14} />
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" title={t('reader.zoomOut')} onClick={() => setZoom((value) => Math.max(0.4, value - 0.15))}>
            <ZoomOut size={13} />
          </Button>
          <span className="w-9 text-center text-[10.5px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon-sm" title={t('reader.zoomIn')} onClick={() => setZoom((value) => Math.min(3, value + 0.15))}>
            <ZoomIn size={13} />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('reader.fitWidth')} onClick={fitWidth}>
            <Maximize2 size={12} />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        data-pdf-scroll
        onScroll={handleScroll}
        className="h-[calc(100%-36px)] overflow-auto bg-muted/30 p-3"
      >
        <div className="mx-auto flex w-fit flex-col items-center gap-3">
          {Array.from({ length: numPages }, (_, index) => {
            const pageNumber = index + 1
            return (
              <PdfPageCanvas
                key={pageNumber}
                doc={doc as PdfDocument}
                pageNumber={pageNumber}
                zoom={zoom}
                size={sizes[pageNumber] ?? sizes[1] ?? FALLBACK_PAGE}
                register={registerPage}
                scrollRoot={scrollRoot}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
