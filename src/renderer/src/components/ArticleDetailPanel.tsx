import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Brain,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Languages,
  Maximize2,
  Info,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { Article, Category, ClassificationHistoryEntry } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { retryArticleTranslation, useArticleDisplay } from '../lib/articleText'
import { cn, errorMessage, formatAuthors, formatBytes, formatDate, formatDateTime, percent } from '../lib/utils'
import { Badge, Dot } from './ui/badge'
import { Button } from './ui/button'
import { IconButton } from './ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { EmptyState } from './ui/layout-bits'
import { Spinner } from './ui/feedback'
import { Textarea } from './ui/input'
import {
  CategoryChips,
  CategoryPicker,
  ConfidenceBadge,
  DoiBadge,
  StatusBadge,
  TranslationBadge
} from './ArticleBits'
import { MetadataEditDialog } from './MetadataEditDialog'
import { MatchEvaluationDialog } from './MatchEvaluationDialog'
import { PdfViewer } from './PdfViewer'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from './ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

type ConfirmKind = 'trash' | 'delete' | 'pdf'

export function ArticleDetailPanel({
  articleId,
  onChanged,
  onRead,
  onClose,
  className
}: {
  articleId: string | null
  onChanged?: () => void
  onRead?: (article: Article) => void
  onClose?: () => void
  className?: string
}) {
  const { t, language } = useT()
  const dataVersion = useAppStore((state) => state.dataVersion)
  const bumpData = useAppStore((state) => state.bumpData)
  const openPdfReader = useAppStore((state) => state.openPdfReader)
  const [article, setArticle] = useState<Article | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [history, setHistory] = useState<ClassificationHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('details')
  const [classifying, setClassifying] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null)
  const [deletePdfFile, setDeletePdfFile] = useState(false)
  const [activePdfId, setActivePdfId] = useState<string | null>(null)
  const [matchOpen, setMatchOpen] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const lastLoaded = useRef<string | null>(null)
  const display = useArticleDisplay(article ?? { id: '', title: '', abstract: null }, {
    detail: true,
    includeAbstract: true
  })

  const reload = useCallback(async () => {
    if (!articleId) {
      setArticle(null)
      return
    }
    setLoading(true)
    try {
      const [next, categoryList, historyList] = await Promise.all([
        window.api.articles.get(articleId),
        window.api.categories.flat(),
        window.api.articles.classificationHistory(articleId)
      ])
      setArticle(next)
      setCategories(categoryList)
      setHistory(historyList)
      if (next) {
        if (next.pdfFiles.length && (!activePdfId || !next.pdfFiles.some((pdf) => pdf.id === activePdfId))) {
          setActivePdfId(next.pdfFiles[0].id)
        }
        if (!next.pdfFiles.length) setActivePdfId(null)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [articleId, activePdfId])

  useEffect(() => {
    void reload()
  }, [reload, dataVersion])

  useEffect(() => {
    setShowOriginal(false)
  }, [articleId])

  useEffect(() => {
    if (article?.readStatus === 'unread' && lastLoaded.current !== article.id) {
      lastLoaded.current = article.id
      void window.api.articles.setRead(article.id, 'read').then(() => {
        setArticle((current) => (current ? { ...current, readStatus: 'read' } : current))
        onRead?.({ ...article, readStatus: 'read' })
        bumpData()
      })
    }
  }, [article, bumpData, onRead])

  const refresh = async (): Promise<void> => {
    await reload()
    bumpData()
    onChanged?.()
  }

  const toggleStar = async (): Promise<void> => {
    if (!article) return
    await window.api.articles.setStarred(article.id, !article.starred)
    setArticle({ ...article, starred: !article.starred })
    bumpData()
  }

  const toggleRead = async (): Promise<void> => {
    if (!article) return
    const next = article.readStatus === 'unread' ? 'read' : 'unread'
    await window.api.articles.setRead(article.id, next)
    setArticle({ ...article, readStatus: next })
    bumpData()
  }

  const classify = async (): Promise<void> => {
    if (!article) return
    setClassifying(true)
    try {
      const outcome = await window.api.articles.classify(article.id, true)
      toast.success(
        `${t('library.classificationDone')} · ${outcome.provider}${outcome.preservedManual ? ` · ${t('library.manualOverride')}: ${outcome.preservedManual}` : ''}`
      )
      setTab('ai')
      await refresh()
    } catch (error) {
      toast.error(t('library.classificationFailed', { error: errorMessage(error) }))
    } finally {
      setClassifying(false)
    }
  }

  const downloadPdf = async (): Promise<void> => {
    if (!article) return
    setDownloading(true)
    try {
      const result = await window.api.pdf.downloadOA(article.id)
      if (result.error) toast.warning(result.error)
      else toast.success(t('article.oaDownloaded'))
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  const attachPdf = async (): Promise<void> => {
    if (!article) return
    try {
      const result = await window.api.pdf.importForArticle(article.id)
      if (result.errors) toast.error(t('library.importFailed', { error: result.errors }))
      else if (result.imported || result.duplicates) {
        toast.success(t('library.importDone', { imported: result.imported, duplicates: result.duplicates, errors: 0 }))
      }
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const removePdf = async (): Promise<void> => {
    const pdf = article?.pdfFiles.find((item) => item.id === activePdfId) ?? article?.pdfFiles[0]
    if (!pdf) return
    try {
      await window.api.pdf.delete(pdf.id, deletePdfFile && pdf.storageMode === 'managed')
      toast.success(t('library.pdfDeleted'))
      setConfirmKind(null)
      setDeletePdfFile(false)
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const addNote = async (): Promise<void> => {
    if (!article || !noteText.trim()) return
    await window.api.articles.addNote(article.id, noteText.trim())
    setNoteText('')
    toast.success(t('article.noteAdded'))
    await refresh()
  }

  const saveNoteEdit = async (): Promise<void> => {
    if (!editingNoteId || !editingNoteText.trim()) return
    await window.api.articles.updateNote(editingNoteId, editingNoteText.trim())
    setEditingNoteId(null)
    setEditingNoteText('')
    await refresh()
  }

  const deleteNote = async (noteId: string): Promise<void> => {
    await window.api.articles.deleteNote(noteId)
    toast.success(t('article.noteDeleted'))
    await refresh()
  }

  const assignCategory = async (categoryId: string): Promise<void> => {
    if (!article) return
    try {
      await window.api.categories.assign(article.id, categoryId)
      toast.success(t('article.manualCategoryAdded'))
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const removeCategory = async (categoryId: string): Promise<void> => {
    if (!article) return
    await window.api.categories.remove(article.id, categoryId)
    await refresh()
  }

  const acceptCategory = async (categoryId: string): Promise<void> => {
    if (!article) return
    await window.api.categories.accept(article.id, categoryId)
    toast.success(t('article.categoryAccepted'))
    await refresh()
  }

  const handleConfirm = async (): Promise<void> => {
    if (!article) return
    if (confirmKind === 'pdf') {
      await removePdf()
      return
    }
    if (confirmKind === 'trash') {
      await window.api.articles.trash(article.id)
      toast.success(t('library.moveToTrash'))
      bumpData()
      setConfirmKind(null)
      return
    }
    if (confirmKind === 'delete') {
      await window.api.articles.delete(article.id)
      toast.success(t('common.deletePermanently'))
      bumpData()
      setConfirmKind(null)
      return
    }
  }

  if (!articleId) {
    return (
      <aside className={cn('flex h-full flex-col border-l border-border/70 bg-card/30', className)}>
        <EmptyState
          className="m-auto"
          icon={<FileText size={20} />}
          title={t('library.selectArticle')}
          description={t('library.selectArticleDesc')}
        />
      </aside>
    )
  }

  if (loading && !article) {
    return (
      <aside className={cn('flex h-full items-center justify-center border-l border-border/70 bg-card/30', className)}>
        <Spinner />
      </aside>
    )
  }

  if (!article) {
    return (
      <aside className={cn('flex h-full flex-col border-l border-border/70 bg-card/30', className)}>
        <EmptyState className="m-auto" icon={<Info size={20} />} title={t('common.noData')} />
      </aside>
    )
  }

  const activePdf = article.pdfFiles.find((pdf) => pdf.id === activePdfId) ?? article.pdfFiles[0]
  const canDownloadPdf = !article.pdfFiles.length && (Boolean(article.doi) || /\.pdf($|\?)/i.test(article.url ?? ''))
  const shownTitle = showOriginal ? article.title : display.title
  const shownAbstract = showOriginal ? article.abstract : display.abstract
  const hasTranslation = display.translatedTitle || display.translatedAbstract
  const displayTarget = display.target === 'original' ? null : display.target
  const sourceLabel =
    article.source === 'rss'
      ? 'RSS'
      : article.source === 'pdf'
        ? 'PDF'
        : article.source === 'manual'
          ? t('article.sourceManual')
          : article.source === 'doi'
            ? 'DOI'
            : t('common.import')

  return (
    <aside className={cn('flex h-full min-w-0 flex-col border-l border-border/70 bg-card/25', className)}>
      <div className="shrink-0 border-b border-border/70 px-4 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary">{sourceLabel}</Badge>
            {article.inLibrary ? <Badge variant="accent">{t('article.inLibrary')}</Badge> : null}
            {article.needsReview ? <Badge variant="warning">{t('library.needsReview')}</Badge> : null}
            {article.readStatus === 'unread' ? <Badge variant="default">{t('common.unread')}</Badge> : null}
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton label={article.starred ? t('article.unstar') : t('article.star')} onClick={() => void toggleStar()}>
              <Star size={14} fill={article.starred ? 'currentColor' : 'none'} className={article.starred ? 'text-amber-500' : ''} />
            </IconButton>
            <IconButton label={article.readStatus === 'unread' ? t('discover.markRead') : t('discover.markUnread')} onClick={() => void toggleRead()}>
              {article.readStatus === 'unread' ? <Circle size={11} /> : <CheckCircle2 size={14} />}
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil size={13} /> {t('library.editMetadata')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMatchOpen(true)}>
                  <Gauge size={13} /> {t('interest.evaluateAction')}
                </DropdownMenuItem>
                {article.doi ? (
                  <DropdownMenuItem onClick={() => void window.api.app.openExternal(`https://doi.org/${article.doi}`)}>
                    <ExternalLink size={13} /> {t('article.openDoi')}
                  </DropdownMenuItem>
                ) : null}
                {activePdf ? (
                  <DropdownMenuItem onClick={() => void window.api.pdf.reveal(activePdf.id)}>
                    <FolderOpen size={13} /> {t('library.revealFile')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                {article.deletedAt ? (
                  <DropdownMenuItem
                    onClick={() => {
                      void window.api.articles.restore(article.id).then(() => bumpData())
                    }}
                  >
                    <RotateCcw size={13} /> {t('common.restore')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem destructive onClick={() => setConfirmKind('trash')}>
                    <Trash2 size={13} /> {t('library.moveToTrash')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem destructive onClick={() => setConfirmKind('delete')}>
                  <X size={13} /> {t('common.deletePermanently')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onClose ? (
              <IconButton label={t('common.close')} onClick={onClose}>
                <X size={15} />
              </IconButton>
            ) : null}
          </div>
        </div>

        <h2 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{shownTitle}</h2>
        {display.needsTranslation ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            {hasTranslation ? (
              <>
                <TranslationBadge translated />
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 transition hover:bg-muted hover:text-foreground"
                  onClick={() => setShowOriginal((value) => !value)}
                >
                  <Languages size={10} />
                  {showOriginal ? t('article.showTranslation') : t('article.showOriginalText')}
                </button>
              </>
            ) : display.aiAvailable ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-primary transition hover:bg-primary/10"
                title={display.failure ?? undefined}
                onClick={() => {
                  if (displayTarget) retryArticleTranslation(article, displayTarget, true)
                }}
              >
                {display.failure ? <RefreshCw size={9} /> : <Spinner size={9} />}
                {display.failure ? t('common.retry') : t('article.translating')}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground/75">
                <Languages size={10} />
                {t('article.translationNeedsAi')}
              </span>
            )}
          </div>
        ) : null}
        <div className="mt-1.5 space-y-1 text-[11.5px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {article.journalTitle ? <span className="font-medium text-foreground/75">{article.journalTitle}</span> : null}
            {article.year ? <span>· {article.year}</span> : null}
            {article.volume ? <span>· {t('library.volume')} {article.volume}</span> : null}
            {article.issue ? <span>({article.issue})</span> : null}
            {article.pages ? <span>· {article.pages}</span> : null}
          </div>
          <div>{formatAuthors(article.authors, 6)}</div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <DoiBadge doi={article.doi} />
            {article.url ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
                onClick={() => void window.api.app.openExternal(article.url as string)}
              >
                <ExternalLink size={10} /> {t('article.originalPage')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <CategoryChips categories={article.categories} max={6} onRemove={(id) => void removeCategory(id)} />
          <CategoryPicker
            categories={categories}
            excludedIds={article.categories.map((category) => category.categoryId)}
            onSelect={(id) => void assignCategory(id)}
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
              >
                <Sparkles size={10} /> {t('library.addCategory')}
              </button>
            }
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void classify()} disabled={classifying}>
            {classifying ? <Spinner size={12} /> : <Brain size={13} />}
            {classifying ? t('library.reclassifying') : t('library.classifyNow')}
          </Button>
          {!article.inLibrary ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void window.api.articles.setInLibrary(article.id, true).then(() => {
                  toast.success(t('discover.savedToLibrary'))
                  return refresh()
                })
              }
            >
              <Paperclip size={13} /> {t('discover.saveToLibrary')}
            </Button>
          ) : null}
          {canDownloadPdf ? (
            <Button variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={downloading}>
              {downloading ? <Spinner size={12} /> : <Download size={13} />}
              {t('library.downloadPdf')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil size={13} /> {t('library.editMetadata')}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
          <TabsList className="w-full justify-start bg-transparent p-0">
            <TabsTrigger value="details">
              <Info size={12} className="mr-1" /> {t('common.details')}
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Sparkles size={12} className="mr-1" /> {t('library.aiTab')}
              {article.categories.some((category) => category.status === 'provisional' || category.status === 'needs_review') ? (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="notes">
              <MessageSquare size={12} className="mr-1" /> {t('library.notesTab')}
              {article.notes?.length ? <span className="ml-1 text-[9px] text-muted-foreground">{article.notes.length}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="pdf">
              <FileText size={12} className="mr-1" /> {t('common.pdf')}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="details" className="p-4">
            <div className="space-y-4">
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('common.abstract')}
                </h3>
                {shownAbstract ? (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">{shownAbstract}</p>
                ) : (
                  <p className="text-[11.5px] italic text-muted-foreground">{t('article.abstractUnavailable')}</p>
                )}
              </section>

              {article.keywords.length ? (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('common.keywords')}
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {article.keywords.map((keyword) => (
                      <Badge key={keyword} variant="outline">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('article.metadata')}
                </h3>
                <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11.5px]">
                  <dt className="text-muted-foreground">{t('common.journal')}</dt>
                  <dd className="truncate text-foreground/85">{article.journalTitle ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('library.publisher')}</dt>
                  <dd className="truncate text-foreground/85">{article.publisher ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('library.publicationDate')}</dt>
                  <dd className="text-foreground/85">{formatDate(article.publicationDate, language)}</dd>
                  <dt className="text-muted-foreground">{t('common.doi')}</dt>
                  <dd className="truncate font-mono text-[10.5px] text-foreground/85">{article.doi ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('library.articleType')}</dt>
                  <dd className="text-foreground/85">{article.articleType ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('common.source')}</dt>
                  <dd className="text-foreground/85">{sourceLabel}</dd>
                  <dt className="text-muted-foreground">{t('common.createdAt')}</dt>
                  <dd className="text-foreground/85">{formatDateTime(article.createdAt, language)}</dd>
                  <dt className="text-muted-foreground">{t('article.readingStatus')}</dt>
                  <dd className="text-foreground/85">{article.readStatus}</dd>
                </dl>
              </section>

              {article.pdfFiles.length ? (
                <section>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('article.attachments')}
                  </h3>
                  <div className="space-y-1">
                    {article.pdfFiles.map((pdf) => (
                      <div key={pdf.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-[11px]">
                        <FileText size={13} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{pdf.filePath}</span>
                        <Badge variant="secondary">{pdf.storageMode}</Badge>
                        <span className="text-muted-foreground">{formatBytes(pdf.size)}</span>
                        <Button variant="ghost" size="xs" onClick={() => void window.api.pdf.reveal(pdf.id)}>
                          {t('library.revealFile')}
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="ai" className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles size={13} className="text-primary" />
                  {article.lastClassifiedAt
                    ? t('article.classifiedOn', { date: formatDate(article.lastClassifiedAt, language) })
                    : t('library.noClassification')}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="xs" onClick={() => setMatchOpen(true)}>
                    <Gauge size={11} /> {t('interest.evaluateShort')}
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => void classify()} disabled={classifying}>
                    {classifying ? <Spinner size={11} /> : <RefreshCw size={11} />}
                    {t('article.retryClassification')}
                  </Button>
                </div>
              </div>

              {article.needsReview ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {t('library.needsHumanReview')} · {t('library.reviewHint')}
                </div>
              ) : null}

              {article.aiSummary ? (
                <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3">
                  <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-primary">{t('article.summary')}</div>
                  <p className="text-[12px] leading-relaxed text-foreground/85">{article.aiSummary}</p>
                </div>
              ) : null}

              {article.categories.length === 0 ? (
                <EmptyState
                  className="py-8"
                  icon={<Brain size={18} />}
                  title={t('library.noClassification')}
                  description={t('library.noClassificationDesc')}
                />
              ) : (
                <div className="space-y-2">
                  {article.categories.map((category) => (
                    <div key={category.categoryId} className="rounded-lg border border-border/75 bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Dot color={category.color} />
                          <span className="truncate text-[12px] font-semibold">{category.categoryPath}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <ConfidenceBadge value={category.confidence} status={category.status} />
                          <StatusBadge status={category.status} decidedBy={category.decidedBy} />
                        </div>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${percent(category.confidence)}` }} />
                      </div>
                      {category.reasoning ? (
                        <p className="mt-2 text-[11.5px] leading-relaxed text-foreground/80">{category.reasoning}</p>
                      ) : null}
                      {category.evidence ? (
                        <blockquote className="mt-1.5 border-l-2 border-primary/30 pl-2 text-[11px] leading-relaxed text-muted-foreground">
                          {category.evidence}
                        </blockquote>
                      ) : null}
                      {category.matchedKeywords.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {category.matchedKeywords.map((keyword) => (
                            <Badge key={keyword} variant="outline" className="text-[9.5px]">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                        <span className="truncate text-[9.5px] text-muted-foreground">
                          {category.source === 'manual' ? t('library.manualOverride') : category.model || 'AI'}
                        </span>
                        <div className="flex items-center gap-1">
                          {category.status !== 'confirmed' ? (
                            <Button variant="outline" size="xs" onClick={() => void acceptCategory(category.categoryId)}>
                              <CheckCircle2 size={10} /> {t('library.accept')}
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => void removeCategory(category.categoryId)}
                          >
                            <X size={10} /> {t('library.removeCategory')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <details className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2">
                <summary className="cursor-pointer select-none text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('library.classificationHistory')} ({history.length})
                </summary>
                <p className="mt-1 text-[10px] text-muted-foreground/70">{t('library.historyHint')}</p>
                <div className="mt-2 space-y-1">
                  {history.length ? (
                    history.slice(0, 20).map((entry) => {
                      const labels: Record<string, { zh: string; en: string }> = {
                        assigned: { zh: '分配', en: 'Assigned' },
                        removed: { zh: '移除', en: 'Removed' },
                        reclassified: { zh: '重新分类', en: 'Reclassified' },
                        manual_add: { zh: '手动添加', en: 'Manual add' },
                        rejected: { zh: '拒绝', en: 'Rejected' },
                        accepted: { zh: '确认', en: 'Accepted' }
                      }
                      const label = labels[entry.action]?.[language] ?? entry.action
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2 rounded-md bg-card px-2 py-1 text-[10px] text-muted-foreground"
                        >
                          <Badge variant={entry.actor === 'user' ? 'accent' : 'secondary'}>{label}</Badge>
                          <span className="min-w-0 flex-1 truncate text-foreground/75">{entry.categoryName ?? '—'}</span>
                          <span>{entry.actor === 'user' ? (language === 'zh' ? '人工' : 'Human') : 'AI'}</span>
                          <span className="tabular-nums">{formatDateTime(entry.createdAt, language)}</span>
                        </div>
                      )
                    })
                  ) : (
                    <div className="py-2 text-center text-[10px] text-muted-foreground">{t('library.historyEmpty')}</div>
                  )}
                </div>
              </details>
            </div>
          </TabsContent>

          <TabsContent value="notes" className="p-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Textarea
                  rows={4}
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder={t('library.notePlaceholder')}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void addNote()} disabled={!noteText.trim()}>
                    <MessageSquare size={13} /> {t('library.addNote')}
                  </Button>
                </div>
              </div>
              {article.notes?.length ? (
                <div className="space-y-2">
                  {article.notes.map((note) => (
                    <div key={note.id} className="rounded-lg border border-border/70 bg-card p-2.5">
                      {editingNoteId === note.id ? (
                        <div className="space-y-1.5">
                          <Textarea rows={3} value={editingNoteText} onChange={(event) => setEditingNoteText(event.target.value)} />
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="xs" onClick={() => setEditingNoteId(null)}>
                              {t('common.cancel')}
                            </Button>
                            <Button size="xs" onClick={() => void saveNoteEdit()}>
                              {t('common.save')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-foreground/85">{note.content}</p>
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-[9.5px] text-muted-foreground">{formatDateTime(note.updatedAt, language)}</span>
                            <div className="flex items-center gap-0.5">
                              <IconButton
                                label={t('common.edit')}
                                onClick={() => {
                                  setEditingNoteId(note.id)
                                  setEditingNoteText(note.content)
                                }}
                              >
                                <Pencil size={11} />
                              </IconButton>
                              <IconButton label={t('library.deleteNote')} onClick={() => void deleteNote(note.id)}>
                                <Trash2 size={11} />
                              </IconButton>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState className="py-8" icon={<MessageSquare size={18} />} title={t('library.noNotes')} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="pdf" className="h-full">
            {activePdf ? (
              <div className="flex h-full flex-col">
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
                  {article.pdfFiles.length > 1
                    ? article.pdfFiles.map((pdf, index) => (
                        <Button
                          key={pdf.id}
                          variant={pdf.id === activePdf.id ? 'secondary' : 'ghost'}
                          size="xs"
                          onClick={() => setActivePdfId(pdf.id)}
                        >
                          PDF {index + 1}
                        </Button>
                      ))
                    : null}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        openPdfReader({ articleId: article.id, pdfId: activePdf.id, title: article.title })
                      }
                    >
                      <Maximize2 size={11} /> {t('reader.openFull')}
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => void window.api.pdf.reveal(activePdf.id)}>
                      <FolderOpen size={11} /> {t('library.revealFile')}
                    </Button>
                    <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmKind('pdf')}>
                      <Trash2 size={11} /> {t('library.removePdf')}
                    </Button>
                  </div>
                </div>
                <PdfViewer pdfId={activePdf.id} title={article.title} className="min-h-0 flex-1" />
              </div>
            ) : (
              <EmptyState
                className="py-12"
                icon={<FileText size={20} />}
                title={t('library.pdfNotAvailable')}
                description={t('library.pdfNotAvailableDesc')}
                action={
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void attachPdf()}>
                      <Paperclip size={13} /> {t('library.importPdfForArticle')}
                    </Button>
                    {canDownloadPdf ? (
                      <Button variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={downloading}>
                        {downloading ? <Spinner size={12} /> : <Download size={13} />}
                        {t('library.downloadPdf')}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            )}
          </TabsContent>
        </div>
      </Tabs>

      <MetadataEditDialog article={article} open={editOpen} onOpenChange={setEditOpen} onSaved={() => void refresh()} />

      <MatchEvaluationDialog open={matchOpen} onOpenChange={setMatchOpen} articleId={article.id} />

      <AlertDialog
        open={confirmKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKind(null)
            setDeletePdfFile(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirmKind === 'pdf' ? t('library.removePdf') : confirmKind === 'trash' ? t('library.moveToTrash') : t('common.deletePermanently')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmKind === 'pdf'
              ? t('library.removePdfConfirm', { extra: '' })
              : confirmKind === 'trash'
                ? t('library.moveToTrash')
                : t('library.deleteForeverConfirm')}
          </AlertDialogDescription>
          {confirmKind === 'pdf' && activePdf?.storageMode === 'managed' ? (
            <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={deletePdfFile} onChange={(event) => setDeletePdfFile(event.target.checked)} />
              {t('library.deleteManagedFile')}
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
