import { BookPlus, CheckCircle2, Circle, FileText, Star } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { Article, SearchResponseItem } from '@shared/types'
import { useT } from '../i18n'
import { useArticleDisplay } from '../lib/articleText'
import { cn, formatAuthors, formatDate, truncateText } from '../lib/utils'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/primitives'
import {
  ArticleMetaLine,
  CategoryChips,
  InterestScoreBadge,
  PdfBadge,
  TranslationBadge
} from './ArticleBits'

function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>[\s\S]*?<\/mark>)/g)
  return (
    <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
      {parts.map((part, index) =>
        part.startsWith('<mark>') ? (
          <mark key={index} className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/25">
            {part.replace(/<\/?mark>/g, '')}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  )
}

export type FeedView = 'list' | 'compact' | 'detailed'

export function ArticleFeedItem({
  article,
  active,
  view,
  interestScore,
  onSelect,
  onToggleStar,
  onToggleRead,
  onAddToLibrary,
  onContextMenu
}: {
  article: Article
  active: boolean
  view: FeedView
  interestScore?: number | null
  onSelect: () => void
  onToggleStar: () => void
  onToggleRead: () => void
  onAddToLibrary: () => void
  onContextMenu?: (event: MouseEvent) => void
}) {
  const { t, language } = useT()
  const display = useArticleDisplay(article, { includeAbstract: view !== 'compact' })
  const unread = article.readStatus === 'unread'
  const hasPdf = article.pdfFiles.length > 0

  if (view === 'compact') {
    return (
      <div
        onClick={onSelect}
        onContextMenu={onContextMenu}
        data-article-id={article.id}
        className={cn(
          'group flex cursor-default items-center gap-2 border-b border-border/60 px-3.5 py-2 transition hover:bg-muted/40',
          active && 'bg-accent/50 hover:bg-accent/50'
        )}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-[13px]', unread ? 'font-medium text-foreground' : 'text-foreground/75')}>
            {display.title}
          </div>
        </div>
        {view === 'compact' ? <TranslationBadge translated={display.translatedTitle} /> : null}
        <span className="hidden max-w-[120px] truncate text-[11px] text-muted-foreground md:inline">
          {article.journalTitle}
        </span>
        <InterestScoreBadge score={interestScore} />
        <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{article.year ?? ''}</span>
        {hasPdf ? <FileText size={11} className="text-muted-foreground/60" /> : <span className="w-[11px]" />}
        {article.inLibrary ? (
          <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />
        ) : (
          <button
            type="button"
            title={t('discover.saveToLibrary')}
            onClick={(event) => {
              event.stopPropagation()
              onAddToLibrary()
            }}
            className="shrink-0 text-muted-foreground/45 transition hover:text-primary"
          >
            <BookPlus size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleStar()
          }}
          className={cn('text-muted-foreground/40 hover:text-amber-500', article.starred && 'text-amber-500')}
        >
          <Star size={12} fill={article.starred ? 'currentColor' : 'none'} />
        </button>
      </div>
    )
  }

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      data-article-id={article.id}
      className={cn(
        'group relative cursor-default border-b border-border/60 px-4 py-3 transition hover:bg-muted/35',
        active && 'bg-accent/45 hover:bg-accent/45'
      )}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-primary" /> : null}
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleRead()
          }}
          className={cn('mt-[3px] shrink-0 transition', unread ? 'text-primary/80 hover:text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground')}
          title={unread ? t('discover.markRead') : t('discover.markUnread')}
        >
          {unread ? <Circle size={9} fill="currentColor" /> : <CheckCircle2 size={12} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3
              className={cn(
                'line-clamp-2 text-[13.5px] leading-snug tracking-[-0.005em]',
                unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/75'
              )}
            >
              {display.title}
            </h3>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggleStar()
              }}
              className={cn(
                'mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 transition hover:text-amber-500',
                article.starred && 'text-amber-500'
              )}
            >
              <Star size={13} fill={article.starred ? 'currentColor' : 'none'} />
            </button>
          </div>
          <ArticleMetaLine article={article} className="mt-1" />
          {display.abstract ? (
            <p className={cn('mt-1.5 text-[12px] leading-relaxed text-muted-foreground', view === 'detailed' ? 'line-clamp-4' : 'line-clamp-2')}>
              {display.abstract}
            </p>
          ) : null}
          {view === 'detailed' && article.aiSummary ? (
            <div className="mt-2 rounded-md border border-primary/15 bg-primary/[0.04] px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/75">
              <span className="mr-1 font-semibold text-primary">{t('article.summary')}:</span>
              {article.aiSummary}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <InterestScoreBadge score={interestScore} />
            <TranslationBadge translated={display.translatedTitle} />
            <CategoryChips categories={article.categories} max={2} />
            {article.categories.length === 0 ? (
              <Badge variant="outline">{t('library.unclassified')}</Badge>
            ) : null}
            {article.needsReview ? <Badge variant="warning">{t('library.needsReview')}</Badge> : null}
            <PdfBadge available={hasPdf} />
            {article.inLibrary ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={10} /> {t('discover.inLibrary')}
              </span>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onAddToLibrary()
                }}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition hover:border-primary/50 hover:text-primary"
              >
                <BookPlus size={10} /> {t('discover.saveToLibrary')}
              </button>
            )}
            {article.publicationDate ? (
              <span className="text-[10.5px] text-muted-foreground/70">{formatDate(article.publicationDate, language)}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export const ARTICLE_TABLE_GRID =
  'grid grid-cols-[22px_8px_minmax(120px,1fr)_100px_96px_40px_70px_20px_20px] items-center gap-x-2'

export function ArticleTableRow({
  item,
  active,
  checked,
  onSelect,
  onCheck,
  onToggleStar,
  onOpen,
  onContextMenu
}: {
  item: SearchResponseItem | { article: Article; snippet?: string }
  active: boolean
  checked: boolean
  onSelect: () => void
  onCheck: (checked: boolean) => void
  onToggleStar: () => void
  onOpen: () => void
  onContextMenu?: (event: MouseEvent) => void
}) {
  const article = item.article
  const snippet = 'snippet' in item ? item.snippet : undefined
  const display = useArticleDisplay(article)
  const unread = article.readStatus === 'unread'
  const hasPdf = article.pdfFiles.length > 0
  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={article.title}
      className={cn(
        ARTICLE_TABLE_GRID,
        'group cursor-default border-b border-border/55 px-3 py-2 transition hover:bg-muted/40',
        active && 'bg-accent/45 hover:bg-accent/45'
      )}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        className="flex items-center justify-center"
      >
        <Checkbox checked={checked} onCheckedChange={(value) => onCheck(value === true)} />
      </div>
      <span className={cn('h-1.5 w-1.5 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-1 truncate text-[13px]', unread ? 'font-medium' : 'text-foreground/75')}>
          <span className="truncate">{display.title}</span>
          {display.translatedTitle ? <TranslationBadge translated /> : null}
        </div>
        {snippet ? (
          <div className="mt-0.5 flex items-center text-[11px] text-muted-foreground">
            <HighlightedSnippet text={snippet} />
          </div>
        ) : null}
      </div>
      <div className="truncate text-[11px] text-muted-foreground" title={formatAuthors(article.authors, 20)}>
        {formatAuthors(article.authors, 2)}
      </div>
      <div className="truncate text-[11px] text-muted-foreground" title={article.journalTitle ?? undefined}>
        {article.journalTitle ?? '—'}
      </div>
      <div className="text-right text-[11px] tabular-nums text-muted-foreground">{article.year ?? '—'}</div>
      <div className="whitespace-nowrap text-right text-[10.5px] tabular-nums text-muted-foreground/80">
        {article.createdAt.slice(0, 10)}
      </div>
      <div className="flex justify-center text-muted-foreground/55">
        {hasPdf ? <FileText size={12} /> : null}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleStar()
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn('flex justify-center text-muted-foreground/35 transition hover:text-amber-500', article.starred && 'text-amber-500')}
      >
        <Star size={12} fill={article.starred ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}
