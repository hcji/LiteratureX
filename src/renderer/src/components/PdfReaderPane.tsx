import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink, FolderOpen, PanelRight, PanelRightClose, X } from 'lucide-react'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { errorMessage } from '../lib/utils'
import { PdfViewer } from './PdfViewer'
import { Button } from './ui/button'
import { IconButton } from './ui/tooltip'
import { ContextMenu, type ContextMenuItem } from './ui/context-menu'

export function PdfReaderPane({
  metaVisible,
  onToggleMeta
}: {
  metaVisible: boolean
  onToggleMeta: () => void
}) {
  const { t } = useT()
  const reader = useAppStore((state) => state.pdfReader)
  const close = useAppStore((state) => state.closePdfReader)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!reader) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (menu) {
        event.stopPropagation()
        setMenu(null)
        return
      }
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [reader, close, menu])

  if (!reader) return null

  const items: ContextMenuItem[] = [
    {
      key: 'system',
      label: t('reader.openSystem'),
      icon: <ExternalLink size={12} />,
      onSelect: () => {
        void window.api.articles
          .openInSystem(reader.articleId)
          .catch((error) => toast.error(errorMessage(error)))
      }
    },
    {
      key: 'reveal',
      label: t('library.revealFile'),
      icon: <FolderOpen size={12} />,
      onSelect: () => {
        void window.api.pdf.reveal(reader.pdfId).catch((error) => toast.error(errorMessage(error)))
      }
    },
    { separator: true },
    { key: 'close', label: t('reader.back'), icon: <X size={12} />, onSelect: close }
  ]

  return (
    <section
      data-pdf-reader
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card/15"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Button variant="ghost" size="xs" onClick={close}>
          <ArrowLeft size={13} /> {t('reader.back')}
        </Button>
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={reader.title}>
          {reader.title}
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={onToggleMeta}
          title={metaVisible ? t('reader.hideMeta') : t('reader.showMeta')}
        >
          {metaVisible ? <PanelRightClose size={12} /> : <PanelRight size={12} />}
          {metaVisible ? t('reader.hideMeta') : t('reader.showMeta')}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void window.api.articles
              .openInSystem(reader.articleId)
              .catch((error) => toast.error(errorMessage(error)))
          }
        >
          <ExternalLink size={12} /> {t('reader.openSystem')}
        </Button>
        <IconButton label={t('common.close')} onClick={close}>
          <X size={15} />
        </IconButton>
      </header>
      <PdfViewer pdfId={reader.pdfId} className="flex min-h-0 flex-1 flex-col" />
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={items}
        onClose={() => setMenu(null)}
      />
    </section>
  )
}
