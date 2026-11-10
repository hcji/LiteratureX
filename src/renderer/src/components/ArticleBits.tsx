import { useState } from 'react'
import { Check, Copy, ExternalLink, FileText, Plus, Star, X } from 'lucide-react'
import type { Article, ArticleCategory, Category } from '@shared/types'
import { useT } from '../i18n'
import { cn, errorMessage, formatAuthors, formatDate, percent } from '../lib/utils'
import { Badge, Dot } from './ui/badge'
import { IconButton } from './ui/tooltip'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { toast } from 'sonner'

export function CategoryChips({
  categories,
  onRemove,
  max = 4,
  className
}: {
  categories: ArticleCategory[]
  onRemove?: (categoryId: string) => void
  max?: number
  className?: string
}) {
  const visible = categories.slice(0, max)
  const rest = categories.length - visible.length
  if (!categories.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {visible.map((category) => (
        <span
          key={category.categoryId}
          title={`${category.categoryPath} · ${percent(category.confidence)}`}
          className="group inline-flex max-w-[190px] items-center gap-1 rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 text-[11px] text-foreground/85"
        >
          <Dot color={category.color} className="h-1.5 w-1.5" />
          <span className="truncate">{category.categoryName}</span>
          {category.decidedBy === 'user' ? <Check size={9} className="text-primary" /> : null}
          {onRemove ? (
            <button
              type="button"
              className="hidden text-muted-foreground hover:text-destructive group-hover:inline-flex"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(category.categoryId)
              }}
            >
              <X size={10} />
            </button>
          ) : null}
        </span>
      ))}
      {rest > 0 ? <span className="text-[10px] text-muted-foreground">+{rest}</span> : null}
    </div>
  )
}

export function ConfidenceBadge({ value, status }: { value: number; status?: ArticleCategory['status'] }) {
  const variant = value >= 0.78 ? 'success' : value >= 0.52 ? 'warning' : 'danger'
  return (
    <Badge variant={status === 'confirmed' ? 'success' : variant} className="tabular-nums">
      {percent(value)}
    </Badge>
  )
}

export function StatusBadge({ status, decidedBy }: { status: ArticleCategory['status']; decidedBy?: 'ai' | 'user' }) {
  const { t } = useT()
  if (status === 'confirmed') return <Badge variant="success">{t('library.accept')}</Badge>
  if (status === 'provisional') return <Badge variant="warning">{t('library.provisional')}</Badge>
  if (status === 'needs_review') return <Badge variant="danger">{t('library.needsHumanReview')}</Badge>
  return <Badge variant="secondary">{decidedBy === 'user' ? t('library.manualOverride') : t('library.autoAssigned')}</Badge>
}

export function ArticleMetaLine({ article, className }: { article: Article; className?: string }) {
  const { language } = useT()
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground', className)}>
      <span className="max-w-[220px] truncate font-medium text-foreground/70">{article.journalTitle ?? '—'}</span>
      {article.year ? (
        <>
          <span className="opacity-40">·</span>
          <span>{article.year}</span>
        </>
      ) : article.publicationDate ? (
        <>
          <span className="opacity-40">·</span>
          <span>{formatDate(article.publicationDate, language)}</span>
        </>
      ) : null}
      {article.authors.length ? (
        <>
          <span className="opacity-40">·</span>
          <span className="max-w-[280px] truncate">{formatAuthors(article.authors, 3)}</span>
        </>
      ) : null}
    </div>
  )
}

export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(value)
  } catch {
    toast.error('Copy failed')
  }
}

export function DoiBadge({ doi, className }: { doi?: string | null; className?: string }) {
  if (!doi) return null
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground', className)}>
      <span className="max-w-[220px] truncate">{doi}</span>
      <button
        type="button"
        onClick={() => void copyText(doi)}
        className="text-muted-foreground/70 hover:text-foreground"
        title="Copy DOI"
      >
        <Copy size={10} />
      </button>
      <button
        type="button"
        onClick={() => void window.api.app.openExternal(`https://doi.org/${doi}`)}
        className="text-muted-foreground/70 hover:text-foreground"
        title="Open DOI"
      >
        <ExternalLink size={10} />
      </button>
    </span>
  )
}

export function OpenOriginalButton({ url }: { url?: string | null }) {
  const { t } = useT()
  if (!url) return null
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void window.api.app.openExternal(url).catch((error) => toast.error(errorMessage(error)))}
    >
      <ExternalLink size={13} />
      {t('discover.openOriginal')}
    </Button>
  )
}

export function StarButton({ starred, onToggle, size = 14 }: { starred: boolean; onToggle: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-muted',
        starred ? 'text-amber-500' : 'text-muted-foreground/50 hover:text-muted-foreground'
      )}
    >
      <Star size={size} fill={starred ? 'currentColor' : 'none'} />
    </button>
  )
}

export function PdfBadge({ available }: { available: boolean }) {
  const { t } = useT()
  if (!available) return null
  return (
    <Badge variant="secondary" className="gap-0.5">
      <FileText size={9} />
      {t('common.pdf')}
    </Badge>
  )
}

export function CategoryPicker({
  categories,
  excludedIds = [],
  onSelect,
  trigger
}: {
  categories: Category[]
  excludedIds?: string[]
  onSelect: (categoryId: string) => void
  trigger?: React.ReactNode
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const excluded = new Set(excludedIds)
  const filtered = categories
    .filter((category) => !excluded.has(category.id))
    .filter((category) => !query.trim() || (category.path ?? category.name).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 80)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plus size={13} />
            {t('library.addCategory')}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common.searchPlaceholder')}
            className="h-8 text-xs"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length ? (
            filtered.map((category) => (
              <button
                key={category.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-muted"
                onClick={() => {
                  onSelect(category.id)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <Dot color={category.color} />
                <span className="min-w-0 flex-1 truncate">{category.path ?? category.name}</span>
                {category.isActive ? null : <span className="text-[9px] text-muted-foreground">off</span>}
              </button>
            ))
          ) : (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">{t('common.noData')}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
