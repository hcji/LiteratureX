import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  FileUp,
  Filter,
  FolderOpen,
  FolderTree,
  Gauge,
  Info,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload
} from 'lucide-react'
import type { Article, ArticleSource, Category, DashboardStats } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { cn, errorMessage, splitAuthors, splitKeywords } from '../lib/utils'
import { PageHeader, PanelHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Input, Textarea, Field } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Spinner, Progress } from '../components/ui/feedback'
import { operationPercent } from '../components/layout/OperationProgress'
import { EmptyState } from '../components/ui/layout-bits'
import { IconButton } from '../components/ui/tooltip'
import { ArticleTableRow, ARTICLE_TABLE_GRID } from '../components/ArticleList'
import { ArticleDetailPanel } from '../components/ArticleDetailPanel'
import { PdfReaderPane } from '../components/PdfReaderPane'
import { CategoryPicker } from '../components/ArticleBits'
import { MatchEvaluationDialog } from '../components/MatchEvaluationDialog'
import { Checkbox } from '../components/ui/primitives'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { ContextMenu, type ContextMenuItem } from '../components/ui/context-menu'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '../components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'

type LibraryScope = 'all' | 'recent' | 'favorites' | 'unclassified' | 'review' | 'trash' | 'category'
type SortKey = 'publication_date' | 'created_at' | 'title' | 'journal' | 'author'

export function LibraryPage() {
  const { t } = useT()
  const dataVersion = useAppStore((state) => state.dataVersion)
  const bumpData = useAppStore((state) => state.bumpData)
  const focusArticleId = useAppStore((state) => state.focusArticleId)
  const consumeFocusArticle = useAppStore((state) => state.consumeFocusArticle)
  const pendingLibraryView = useAppStore((state) => state.pendingLibraryView)
  const consumePendingLibraryView = useAppStore((state) => state.consumePendingLibraryView)
  const operations = useAppStore((state) => state.operations)
  const jobProgress = useAppStore((state) => state.jobProgress)
  const openPdfReader = useAppStore((state) => state.openPdfReader)
  const pdfReader = useAppStore((state) => state.pdfReader)
  const [readerMetaVisible, setReaderMetaVisible] = useState(true)
  const [scope, setScope] = useState<LibraryScope>('all')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('publication_date')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [advanced, setAdvanced] = useState({
    author: '',
    journalTitle: '',
    yearFrom: '',
    yearTo: '',
    source: 'any' as ArticleSource | 'any',
    hasPdf: false
  })
  const [filterDraft, setFilterDraft] = useState(advanced)
  const [items, setItems] = useState<Array<{ article: Article; snippet?: string; score?: number }>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Category[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [addReferenceOpen, setAddReferenceOpen] = useState(false)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [organizeJobId, setOrganizeJobId] = useState<string | null>(null)
  const [keywordCount, setKeywordCount] = useState('8')
  const [maxNewCategories, setMaxNewCategories] = useState('3')
  const [discoverySampleSize, setDiscoverySampleSize] = useState('20')
  const [includeFullText, setIncludeFullText] = useState(false)
  const [thinkingDepth, setThinkingDepth] = useState<'low' | 'medium-low' | 'high'>('medium-low')
  const [organizing, setOrganizing] = useState(false)
  const [dedupeOpen, setDedupeOpen] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; article: Article } | null>(null)
  const [matchArticleId, setMatchArticleId] = useState<string | null>(null)
  const [categoryTarget, setCategoryTarget] = useState<Article | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [importing, setImporting] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 320)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !selectedId) return
      if (document.querySelector('[data-pdf-reader]')) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return
      setSelectedId(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId])

  const loadMeta = useCallback(async () => {
    try {
      const [categoryList, dashboard] = await Promise.all([window.api.categories.flat(), window.api.dashboard.get()])
      setCategories(categoryList)
      setStats(dashboard)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta, dataVersion])

  const buildQuery = (offset: number): Parameters<typeof window.api.articles.list>[0] => {
    const base: Parameters<typeof window.api.articles.list>[0] = {
      scope: scope === 'trash' ? 'trash' : 'library',
      search: debouncedSearch || undefined,
      starredOnly: scope === 'favorites',
      unclassifiedOnly: scope === 'unclassified',
      needsReviewOnly: scope === 'review',
      hasPdf: advanced.hasPdf || undefined,
      author: advanced.author.trim() || undefined,
      journalTitle: advanced.journalTitle.trim() || undefined,
      yearFrom: advanced.yearFrom.trim() ? Number(advanced.yearFrom) : undefined,
      yearTo: advanced.yearTo.trim() ? Number(advanced.yearTo) : undefined,
      source: advanced.source === 'any' ? undefined : advanced.source,
      categoryId: scope === 'category' && categoryId ? categoryId : undefined,
      sort,
      order,
      limit: 100000,
      offset
    }
    return base
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = buildQuery(0)
      if (debouncedSearch && scope !== 'trash') {
        const result = await window.api.articles.search(query)
        setItems(result.items)
        setTotal(result.total)
      } else {
        const result = await window.api.articles.list(query)
        setItems(result.items.map((article) => ({ article })))
        setTotal(result.total)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, categoryId, debouncedSearch, sort, order, advanced])

  useEffect(() => {
    void load()
  }, [load, dataVersion])

  useEffect(() => {
    if (!focusArticleId) return
    setScope('all')
    setCategoryId(null)
    setSelectedId(focusArticleId)
    consumeFocusArticle()
  }, [focusArticleId, consumeFocusArticle])

  useEffect(() => {
    if (!pendingLibraryView) return
    setScope(pendingLibraryView)
    setCategoryId(null)
    setSelectedId(null)
    setChecked(new Set())
    consumePendingLibraryView()
  }, [pendingLibraryView, consumePendingLibraryView])

  useEffect(() => {
    if (!organizeOpen || !organizeJobId) return
    const status = jobProgress[organizeJobId]?.status
    if (status !== 'done' && status !== 'error') return
    const timer = setTimeout(
      () => {
        setOrganizeOpen(false)
        setOrganizeJobId(null)
      },
      status === 'done' ? 1600 : 2600
    )
    return () => clearTimeout(timer)
  }, [organizeOpen, organizeJobId, jobProgress])

  const toggleChecked = (id: string, value: boolean): void => {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const clearSelection = (): void => setChecked(new Set())

  const selectScope = (next: LibraryScope, catId?: string): void => {
    setScope(next)
    setCategoryId(catId ?? null)
    if (next === 'recent') {
      setSort('created_at')
      setOrder('desc')
    }
    setSelectedId(null)
    clearSelection()
  }

  const importPdfs = async (mode: 'files' | 'folder'): Promise<void> => {
    setImporting(true)
    try {
      const result = mode === 'files' ? await window.api.pdf.importDialog() : await window.api.pdf.importFolderDialog()
      if (result.items.length) {
        if (result.errors) toast.error(t('library.importFailed', { error: `${result.errors} file(s)` }))
        else toast.success(t('library.importDone', { imported: result.imported, duplicates: result.duplicates, errors: result.errors }))
        bumpData()
        if (result.items[0]?.articleId) setSelectedId(result.items[0].articleId)
      }
    } catch (error) {
      toast.error(t('library.importFailed', { error: errorMessage(error) }))
    } finally {
      setImporting(false)
    }
  }

  const importDropped = async (files: FileList): Promise<void> => {
    const paths = Array.from(files)
      .map((file) => window.api.app.getPathForFile(file))
      .filter((value): value is string => Boolean(value))
    if (!paths.length) {
      toast.error(t('library.importFailed', { error: 'No file paths' }))
      return
    }
    setImporting(true)
    try {
      const result = await window.api.pdf.importPaths(paths)
      toast.success(t('library.importDone', { imported: result.imported, duplicates: result.duplicates, errors: result.errors }))
      bumpData()
      if (result.items[0]?.articleId) setSelectedId(result.items[0].articleId)
    } catch (error) {
      toast.error(t('library.importFailed', { error: errorMessage(error) }))
    } finally {
      setImporting(false)
    }
  }

  const selectedArticles = useMemo(
    () => items.filter((item) => checked.has(item.article.id)).map((item) => item.article),
    [items, checked]
  )

  const bulkMarkRead = async (status: 'read' | 'unread'): Promise<void> => {
    await Promise.all(selectedArticles.map((article) => window.api.articles.setRead(article.id, status)))
    clearSelection()
    bumpData()
  }

  const bulkTrash = async (): Promise<void> => {
    await Promise.all(selectedArticles.map((article) => window.api.articles.trash(article.id)))
    clearSelection()
    bumpData()
  }

  const bulkDelete = async (): Promise<void> => {
    await Promise.all(selectedArticles.map((article) => window.api.articles.delete(article.id)))
    clearSelection()
    bumpData()
  }

  const bulkRestore = async (): Promise<void> => {
    await Promise.all(selectedArticles.map((article) => window.api.articles.restore(article.id)))
    clearSelection()
    bumpData()
  }

  const bulkClassify = async (): Promise<void> => {
    if (!categories.length) {
      toast.warning(t('library.bulkClassifyNoCategories'))
      return
    }
    const ids = selectedArticles.map((article) => article.id)
    if (!ids.length) return
    const jobId = await window.api.articles.classifyBatch(ids, true)
    if (jobId) toast.success(t('library.bulkClassifyStarted', { n: ids.length }))
    clearSelection()
  }

  const organizeUnclassified = async (): Promise<void> => {
    const maxNew = Math.max(0, Math.min(20, Math.round(Number(maxNewCategories) || 0)))
    const sampleSize = maxNew > 0 ? Math.max(1, Math.min(1000, Math.round(Number(discoverySampleSize) || 20))) : 0
    if (!categories.some((category) => category.isActive) && maxNew === 0) {
      toast.warning(t('library.bulkClassifyNoCategories'))
      return
    }
    const count = Math.max(3, Math.min(20, Math.round(Number(keywordCount) || 8)))
    setOrganizing(true)
    try {
      const result = await window.api.articles.autoOrganize({
        keywordCount: count,
        maxNewCategories: maxNew,
        discoverySampleSize: sampleSize,
        includeFullText,
        thinkingDepth
      })
      if (result.jobId) {
        toast.success(t('library.aiOrganizeStarted', { n: result.count, k: count }))
        setOrganizeJobId(result.jobId)
        bumpData()
      } else {
        toast.warning(t('library.aiOrganizeEmpty'))
        setOrganizeOpen(false)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setOrganizing(false)
    }
  }

  const bulkAssign = async (targetCategoryId: string): Promise<void> => {
    await Promise.all(selectedArticles.map((article) => window.api.categories.assign(article.id, targetCategoryId)))
    toast.success(t('article.manualCategoryAdded'))
    clearSelection()
    bumpData()
  }

  const dedupeArticles = async (): Promise<void> => {
    setDeduping(true)
    try {
      const result = await window.api.articles.dedupe()
      if (result.removed) {
        toast.success(t('library.dedupeDone', { groups: result.groups, removed: result.removed }))
      } else {
        toast.success(t('library.dedupeNone'))
      }
      setDedupeOpen(false)
      bumpData()
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeduping(false)
    }
  }

  const toggleReadFor = async (article: Article): Promise<void> => {
    const next = article.readStatus === 'unread' ? 'read' : 'unread'
    await window.api.articles.setRead(article.id, next)
    bumpData()
    await load()
  }

  const toggleStarFor = async (article: Article): Promise<void> => {
    await window.api.articles.setStarred(article.id, !article.starred)
    bumpData()
    await load()
  }

  const classifyOne = async (article: Article): Promise<void> => {
    try {
      await window.api.articles.classify(article.id, true)
      toast.success(t('library.classificationDone'))
      bumpData()
      await load()
    } catch (error) {
      toast.error(t('library.classificationFailed', { error: errorMessage(error) }))
    }
  }

  const downloadOaFor = async (article: Article): Promise<void> => {
    try {
      const result = await window.api.pdf.downloadOA(article.id)
      if (result.error) toast.warning(result.error)
      else toast.success(t('article.oaDownloaded'))
      bumpData()
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openOriginalFor = async (article: Article): Promise<void> => {
    const target = article.url || (article.doi ? `https://doi.org/${article.doi}` : null)
    if (!target) return
    try {
      await window.api.app.openExternal(target)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const revealPdfFor = async (article: Article): Promise<void> => {
    const pdf = article.pdfFiles[0]
    if (!pdf) return
    try {
      await window.api.pdf.reveal(pdf.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const exportOne = async (article: Article, format: 'bibtex' | 'ris'): Promise<void> => {
    try {
      const result = await window.api.io.export(format, [article.id])
      if (result) toast.success(t('library.exportDone', { path: result.path }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const moveToTrashFor = async (article: Article): Promise<void> => {
    await window.api.articles.trash(article.id)
    if (selectedId === article.id) setSelectedId(null)
    bumpData()
    await load()
  }

  const restoreFor = async (article: Article): Promise<void> => {
    await window.api.articles.restore(article.id)
    bumpData()
    await load()
  }

  const deleteForever = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await window.api.articles.delete(deleteTarget.id)
      if (selectedId === deleteTarget.id) setSelectedId(null)
      setDeleteTarget(null)
      bumpData()
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const assignTargetCategory = async (categoryId: string): Promise<void> => {
    if (!categoryTarget) return
    try {
      await window.api.categories.assign(categoryTarget.id, categoryId)
      toast.success(t('article.manualCategoryAdded'))
      setCategoryTarget(null)
      bumpData()
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const contextItems = (article: Article): ContextMenuItem[] => {
    const inTrash = scope === 'trash'
    const hasPdf = article.pdfFiles.length > 0
    const canDownload = !hasPdf && (Boolean(article.doi) || /\.pdf($|\?)/i.test(article.url ?? ''))
    const items: ContextMenuItem[] = [
      { key: 'open', label: t('common.details'), icon: <Info size={12} />, onSelect: () => setSelectedId(article.id) },
      {
        key: 'reader',
        label: t('reader.openFull'),
        icon: <BookOpen size={12} />,
        disabled: !hasPdf,
        onSelect: () => openReaderFor(article)
      }
    ]
    if (inTrash) {
      items.push(
        { separator: true },
        { key: 'restore', label: t('common.restore'), icon: <RotateCcw size={12} />, onSelect: () => void restoreFor(article) },
        {
          key: 'delete',
          label: t('common.deletePermanently'),
          icon: <Trash2 size={12} />,
          danger: true,
          onSelect: () => setDeleteTarget(article)
        }
      )
      return items
    }
    items.push(
      {
        key: 'read',
        label: article.readStatus === 'unread' ? t('discover.markRead') : t('discover.markUnread'),
        icon: article.readStatus === 'unread' ? <CheckCircle2 size={12} /> : <Circle size={12} />,
        onSelect: () => void toggleReadFor(article)
      },
      {
        key: 'star',
        label: article.starred ? t('article.unstar') : t('article.star'),
        icon: <Star size={12} />,
        onSelect: () => void toggleStarFor(article)
      },
      { separator: true },
      {
        key: 'category',
        label: t('library.addToCategory'),
        icon: <FolderTree size={12} />,
        disabled: !categories.length,
        onSelect: () => setCategoryTarget(article)
      },
      { key: 'classify', label: t('library.classifyNow'), icon: <Sparkles size={12} />, onSelect: () => void classifyOne(article) },
      {
        key: 'match',
        label: t('interest.evaluateAction'),
        icon: <Gauge size={12} />,
        onSelect: () => setMatchArticleId(article.id)
      },
      { separator: true },
      {
        key: 'download',
        label: t('library.downloadPdf'),
        icon: <Download size={12} />,
        disabled: !canDownload,
        onSelect: () => void downloadOaFor(article)
      },
      {
        key: 'pdf',
        label: t('reader.openSystem'),
        icon: <FileText size={12} />,
        disabled: !hasPdf,
        onSelect: () => void openInSystem(article)
      },
      {
        key: 'reveal',
        label: t('library.revealFile'),
        icon: <FolderOpen size={12} />,
        disabled: !hasPdf,
        onSelect: () => void revealPdfFor(article)
      },
      {
        key: 'original',
        label: t('discover.openOriginal'),
        icon: <ExternalLink size={12} />,
        disabled: !article.url && !article.doi,
        onSelect: () => void openOriginalFor(article)
      },
      { separator: true },
      {
        key: 'bibtex',
        label: t('context.exportBibtex'),
        icon: <FileDown size={12} />,
        onSelect: () => void exportOne(article, 'bibtex')
      },
      {
        key: 'ris',
        label: t('context.exportRis'),
        icon: <FileDown size={12} />,
        onSelect: () => void exportOne(article, 'ris')
      },
      { separator: true },
      {
        key: 'trash',
        label: t('library.moveToTrash'),
        icon: <Trash2 size={12} />,
        danger: true,
        onSelect: () => void moveToTrashFor(article)
      }
    )
    return items
  }

  const changeSort = (key: SortKey): void => {
    if (sort === key) {
      setOrder((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(key)
    setOrder(key === 'publication_date' || key === 'created_at' ? 'desc' : 'asc')
  }

  const openInSystem = async (article: Article): Promise<void> => {
    try {
      await window.api.articles.openInSystem(article.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openReaderFor = (article: Article): boolean => {
    const pdf = article.pdfFiles[0]
    if (!pdf) return false
    setSelectedId(article.id)
    openPdfReader({ articleId: article.id, pdfId: pdf.id, title: article.title })
    return true
  }

  const allSelected = items.length > 0 && items.every((item) => checked.has(item.article.id))
  const someSelected = items.some((item) => checked.has(item.article.id))

  const toggleAll = (value: boolean): void => {
    if (!value) {
      clearSelection()
      return
    }
    setChecked(new Set(items.map((item) => item.article.id)))
  }

  const exportLibrary = async (format: 'bibtex' | 'ris' | 'csv' | 'json', ids?: string[]): Promise<void> => {
    try {
      const result = await window.api.io.export(format, ids)
      if (result) toast.success(t('library.exportDone', { path: result.path }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const emptyTrash = async (): Promise<void> => {
    try {
      await window.api.articles.emptyTrash()
      setEmptyTrashOpen(false)
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const categoriesByPath = useMemo(
    () => [...categories].sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name)),
    [categories]
  )

  const title =
    scope === 'trash'
      ? t('common.trash')
      : scope === 'category'
        ? categories.find((category) => category.id === categoryId)?.path ?? t('common.category')
        : scope === 'favorites'
          ? t('library.favorites')
          : scope === 'unclassified'
            ? t('library.unclassified')
            : scope === 'review'
              ? t('library.needsReview')
              : scope === 'recent'
                  ? t('library.recentlyAdded')
                  : t('library.allLiterature')

  const activeFilterCount = [
    advanced.author.trim(),
    advanced.journalTitle.trim(),
    advanced.yearFrom.trim(),
    advanced.yearTo.trim(),
    advanced.source !== 'any' ? advanced.source : '',
    advanced.hasPdf ? 'pdf' : ''
  ].filter(Boolean).length

  const importOperation = Object.values(operations).find(
    (operation) => operation.kind === 'pdf-import' && operation.status === 'running'
  )
  const importPercent = importOperation ? operationPercent(importOperation) : undefined
  const classificationOperation = Object.values(operations).find(
    (operation) => operation.kind === 'classification' && operation.status === 'running'
  )
  const classificationPercent = classificationOperation ? operationPercent(classificationOperation) : undefined
  const organizeProgress = organizeJobId ? jobProgress[organizeJobId] : undefined
  const organizeCountMessage =
    organizeProgress?.message && /^\d+\/\d+$/.test(organizeProgress.message) ? organizeProgress.message : null
  const readerMetaOpen = Boolean(pdfReader && selectedId && readerMetaVisible)

  useEffect(() => {
    if (pdfReader) setReaderMetaVisible(true)
  }, [pdfReader?.pdfId])

  const toggleReaderMeta = (): void => {
    if (!pdfReader) return
    if (readerMetaOpen) {
      setReaderMetaVisible(false)
      return
    }
    setReaderMetaVisible(true)
    setSelectedId(pdfReader.articleId)
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragEnter={(event) => {
        event.preventDefault()
        dragCounter.current += 1
        if (event.dataTransfer.types.includes('Files')) setDragActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dragCounter.current -= 1
        if (dragCounter.current <= 0) {
          dragCounter.current = 0
          setDragActive(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragCounter.current = 0
        setDragActive(false)
        if (event.dataTransfer.files.length) void importDropped(event.dataTransfer.files)
      }}
    >
      <PageHeader
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void importPdfs('files')} disabled={importing}>
              {importing ? <Spinner size={13} /> : <Upload size={13} />}
              {t('library.importPdf')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void importPdfs('folder')} disabled={importing}>
              <FolderOpen size={13} /> {t('library.importFolder')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddReferenceOpen(true)}>
              <Plus size={13} /> {t('library.addReference')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary">
                  <FileDown size={13} /> {t('library.exportLibrary')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('settings.exportData')}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void exportLibrary('bibtex', checked.size ? [...checked] : undefined)}>
                  BibTeX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportLibrary('ris', checked.size ? [...checked] : undefined)}>
                  RIS
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportLibrary('csv', checked.size ? [...checked] : undefined)}>
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportLibrary('json', checked.size ? [...checked] : undefined)}>
                  JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void window.api.io.import('bibtex').then((result) => {
                  if (result) {
                    toast.success(t('settings.importDone', { imported: result.imported ?? 0, skipped: result.skipped ?? 0 }))
                    bumpData()
                  }
                })}>
                  <FileUp size={13} /> BibTeX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void window.api.io.import('ris').then((result) => {
                  if (result) {
                    toast.success(t('settings.importDone', { imported: result.imported ?? 0, skipped: result.skipped ?? 0 }))
                    bumpData()
                  }
                })}>
                  <FileUp size={13} /> RIS
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {importOperation ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/[0.045] px-4 py-1.5">
          <Upload size={12} className="text-primary" />
          <span className="shrink-0 text-[11.5px] font-medium text-foreground">{t('operations.pdfImport')}</span>
          <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
            {importOperation.total
              ? `${importOperation.current ?? 0}/${importOperation.total}`
              : t('operations.processing')}
            {importOperation.detail ? ` · ${importOperation.detail}` : ''}
          </span>
          <Progress
            value={importPercent ?? 0}
            indeterminate={importPercent == null}
            className="ml-auto h-1 w-[180px] shrink-0"
          />
          {importPercent != null ? (
            <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
              {Math.round(importPercent * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}
      {classificationOperation ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/[0.035] px-4 py-1.5">
          <Sparkles size={12} className="text-primary" />
          <span className="shrink-0 text-[11.5px] font-medium text-foreground">{t('operations.classification')}</span>
          <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
            {classificationOperation.detail ?? t('operations.processing')}
          </span>
          <Progress
            value={classificationPercent ?? 0}
            indeterminate={classificationPercent == null}
            className="ml-auto h-1 w-[180px] shrink-0"
          />
          {classificationPercent != null ? (
            <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
              {Math.round(classificationPercent * 100)}%
            </span>
          ) : null}
        </div>
      ) : null}
      {pdfReader ? (
        <div className="flex min-h-0 flex-1">
          <PdfReaderPane metaVisible={readerMetaOpen} onToggleMeta={toggleReaderMeta} />
          {readerMetaOpen ? (
            <ArticleDetailPanel
              articleId={selectedId}
              onChanged={() => void load()}
              onClose={() => setSelectedId(null)}
              className="w-[400px] shrink-0"
            />
          ) : null}
        </div>
      ) : (
      <div className="relative flex min-h-0 flex-1">
        <aside className="flex w-[218px] shrink-0 flex-col border-r border-border/70 bg-card/25">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="space-y-0.5">
              {(
                [
                  ['all', 'library.allLiterature', BookOpen, stats?.totalPapers],
                  ['recent', 'library.recentlyAdded', Sparkles, undefined],
                  ['favorites', 'library.favorites', Star, stats?.starred],
                  ['unclassified', 'library.unclassified', FileDown, stats?.unclassified],
                  ['review', 'library.needsReview', Sparkles, stats?.reviewCount]
                ] as Array<[LibraryScope, Parameters<typeof t>[0], typeof BookOpen, number | undefined]>
              ).map(([value, label, Icon, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectScope(value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-[12px] transition',
                    scope === value
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-foreground/72 hover:bg-muted/60'
                  )}
                >
                  <Icon size={13} className="shrink-0 opacity-70" />
                  <span className="flex-1 truncate text-left">{t(label)}</span>
                  {count !== undefined ? <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span> : null}
                </button>
              ))}
            </div>

            <div className="mt-3 border-t border-border/60 pt-2">
              <div className="mb-1 flex items-center justify-between px-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {t('library.customCollections')}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/50">{categories.length}</span>
              </div>
              <div className="space-y-0.5">
                {categoriesByPath.map((category) => {
                  const depth = (category.path ?? category.name).split(' / ').length - 1
                  const active = scope === 'category' && categoryId === category.id
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => selectScope('category', category.id)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md py-[5px] pr-2 text-[11.5px] transition',
                        active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/70 hover:bg-muted/60'
                      )}
                      style={{ paddingLeft: `${8 + depth * 12}px` }}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: category.color ?? 'var(--muted-foreground)' }} />
                      <span className="flex-1 truncate text-left">{category.name}</span>
                      {category.articleCount ? (
                        <span className="text-[10px] tabular-nums text-muted-foreground/70">{category.articleCount}</span>
                      ) : null}
                    </button>
                  )
                })}
                {!categories.length ? (
                  <div className="px-2 py-2 text-[10px] text-muted-foreground/70">{t('collections.noCategories')}</div>
                ) : null}
              </div>
            </div>

            <div className="mt-3 border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => selectScope('trash')}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-[12px] transition',
                  scope === 'trash' ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/70 hover:bg-muted/60'
                )}
              >
                <Trash2 size={13} className="opacity-70" />
                <span className="flex-1 text-left">{t('library.trash')}</span>
              </button>
              {scope === 'trash' ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-1 w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setEmptyTrashOpen(true)}
                >
                  {t('common.emptyTrash')}
                </Button>
              ) : null}
            </div>

            <div className="mt-3 border-t border-border/60 px-2 pt-2 text-[10.5px] leading-relaxed text-muted-foreground/60">
              {t('library.dragHint')}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <span className="max-w-[320px] truncate">{title}</span>
                <span className="rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums text-muted-foreground">{total}</span>
              </span>
            }
            actions={
              <>
                <Popover
                  open={filtersOpen}
                  onOpenChange={(open) => {
                    if (open) setFilterDraft(advanced)
                    setFiltersOpen(open)
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button variant={activeFilterCount ? 'secondary' : 'outline'} size="xs">
                      <Filter size={11} />
                      {activeFilterCount
                        ? t('library.filterCount', { n: activeFilterCount })
                        : t('library.advancedFilters')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[330px] space-y-2.5">
                    <Field label={t('library.filterAuthor')}>
                      <Input
                        value={filterDraft.author}
                        onChange={(event) => setFilterDraft((current) => ({ ...current, author: event.target.value }))}
                        className="h-8 text-xs"
                      />
                    </Field>
                    <Field label={t('library.filterJournal')}>
                      <Input
                        value={filterDraft.journalTitle}
                        onChange={(event) => setFilterDraft((current) => ({ ...current, journalTitle: event.target.value }))}
                        className="h-8 text-xs"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t('library.filterYearFrom')}>
                        <Input
                          value={filterDraft.yearFrom}
                          inputMode="numeric"
                          onChange={(event) => setFilterDraft((current) => ({ ...current, yearFrom: event.target.value }))}
                          className="h-8 text-xs"
                        />
                      </Field>
                      <Field label={t('library.filterYearTo')}>
                        <Input
                          value={filterDraft.yearTo}
                          inputMode="numeric"
                          onChange={(event) => setFilterDraft((current) => ({ ...current, yearTo: event.target.value }))}
                          className="h-8 text-xs"
                        />
                      </Field>
                    </div>
                    <Field label={t('library.filterSource')}>
                      <Select
                        value={filterDraft.source}
                        onValueChange={(value) =>
                          setFilterDraft((current) => ({ ...current, source: value as ArticleSource | 'any' }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">{t('common.all')}</SelectItem>
                          <SelectItem value="rss">RSS</SelectItem>
                          <SelectItem value="pdf">PDF</SelectItem>
                          <SelectItem value="manual">{t('library.addReference')}</SelectItem>
                          <SelectItem value="doi">DOI</SelectItem>
                          <SelectItem value="import">{t('common.import')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <label className="flex items-center gap-2 pt-0.5 text-[11.5px] text-muted-foreground">
                      <Checkbox
                        checked={filterDraft.hasPdf}
                        onCheckedChange={(value) => setFilterDraft((current) => ({ ...current, hasPdf: value === true }))}
                      />
                      {t('library.hasPdf')}
                    </label>
                    <div className="flex items-center justify-between pt-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          const empty = {
                            author: '',
                            journalTitle: '',
                            yearFrom: '',
                            yearTo: '',
                            source: 'any' as ArticleSource | 'any',
                            hasPdf: false
                          }
                          setAdvanced(empty)
                          setFilterDraft(empty)
                          setFiltersOpen(false)
                        }}
                      >
                        {t('library.clearFilters')}
                      </Button>
                      <Button
                        size="xs"
                        onClick={() => {
                          setAdvanced(filterDraft)
                          setFiltersOpen(false)
                        }}
                      >
                        {t('library.applyFilters')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <IconButton label={t('library.dedupe')} onClick={() => setDedupeOpen(true)}>
                  <Copy size={13} />
                </IconButton>
                {scope === 'trash' ? (
                  <Button variant="ghost" size="xs" className="text-destructive" onClick={() => setEmptyTrashOpen(true)}>
                    <Trash2 size={11} /> {t('common.emptyTrash')}
                  </Button>
                ) : null}
              </>
            }
          />

          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <div className="relative flex-1">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.stopPropagation()
                  if (search) setSearch('')
                  else event.currentTarget.blur()
                }}
                placeholder={t('library.searchLibrary')}
                data-page-search
                className="h-7 pl-7 text-[11.5px]"
              />
            </div>
          </div>

          {scope === 'unclassified' ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/[0.035] px-3 py-1.5">
              <Sparkles size={12} className="text-primary" />
              <span className="text-[10.5px] text-muted-foreground">{t('library.aiOrganizeBanner', { n: total })}</span>
              <Button
                variant="outline"
                size="xs"
                className="ml-auto"
                onClick={() => {
                  setOrganizeJobId(null)
                  setOrganizeOpen(true)
                }}
                disabled={!total}
              >
                <Sparkles size={10} /> {t('library.aiOrganizeUnclassified')}
              </Button>
            </div>
          ) : null}

          {checked.size > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-primary/20 bg-primary/[0.04] px-3 py-1.5">
              <span className="mr-1 text-[10.5px] font-medium text-primary">{t('library.selectedCount', { n: checked.size })}</span>
              {scope === 'trash' ? (
                <>
                  <Button variant="outline" size="xs" onClick={() => void bulkRestore()}>
                    <RotateCcw size={10} /> {t('common.restore')}
                  </Button>
                  <Button variant="outline" size="xs" className="text-destructive" onClick={() => void bulkDelete()}>
                    <Trash2 size={10} /> {t('common.deletePermanently')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="xs" onClick={() => void bulkMarkRead('read')}>
                    {t('library.markAsRead')}
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => void bulkMarkRead('unread')}>
                    {t('library.markAsUnread')}
                  </Button>
                  <CategoryPicker
                    categories={categories}
                    onSelect={(id) => void bulkAssign(id)}
                    trigger={
                      <Button variant="outline" size="xs">
                        <FolderTree size={10} /> {t('library.addToCategory')}
                      </Button>
                    }
                  />
                  <Button variant="outline" size="xs" onClick={() => void bulkClassify()}>
                    <Sparkles size={10} /> {t('library.classifySelected')}
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => void exportLibrary('bibtex', [...checked])}>
                    <FileDown size={10} /> {t('library.exportSelected')}
                  </Button>
                  <Button variant="ghost" size="xs" className="text-destructive" onClick={() => void bulkTrash()}>
                    <Trash2 size={10} /> {t('library.moveToTrash')}
                  </Button>
                </>
              )}
              <button type="button" className="ml-auto text-[10.5px] text-muted-foreground hover:text-foreground" onClick={clearSelection}>
                {t('common.clear')}
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 backdrop-blur">
              <div className={cn(ARTICLE_TABLE_GRID, 'px-3 py-2 text-[10.5px] font-semibold text-muted-foreground')}>
                <div className="flex items-center justify-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(value) => toggleAll(value === true)}
                  />
                </div>
                <div />
                <SortableHeader label={t('common.title')} sortKey="title" currentSort={sort} order={order} onSort={changeSort} />
                <SortableHeader label={t('common.authors')} sortKey="author" currentSort={sort} order={order} onSort={changeSort} />
                <SortableHeader label={t('common.journal')} sortKey="journal" currentSort={sort} order={order} onSort={changeSort} />
                <SortableHeader
                  label={t('common.year')}
                  sortKey="publication_date"
                  currentSort={sort}
                  order={order}
                  onSort={changeSort}
                  align="right"
                />
                <SortableHeader
                  label={t('library.addedDate')}
                  sortKey="created_at"
                  currentSort={sort}
                  order={order}
                  onSort={changeSort}
                  align="right"
                />
                <div className="text-center text-[9.5px] uppercase">PDF</div>
                <div className="text-center">
                  <Star size={10} className="mx-auto opacity-60" />
                </div>
              </div>
            </div>
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : items.length ? (
              <>
                {items.map((item) => (
                  <ArticleTableRow
                    key={item.article.id}
                    item={item}
                    active={item.article.id === selectedId}
                    checked={checked.has(item.article.id)}
                    onSelect={() => setSelectedId(item.article.id)}
                    onCheck={(value) => toggleChecked(item.article.id, value)}
                    onToggleStar={() => {
                      void window.api.articles.setStarred(item.article.id, !item.article.starred).then(() => bumpData())
                    }}
                    onOpen={() => {
                      if (!openReaderFor(item.article)) void openInSystem(item.article)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setContextMenu({ x: event.clientX, y: event.clientY, article: item.article })
                    }}
                  />
                ))}
              </>
            ) : debouncedSearch ? (
              <EmptyState icon={<Search size={20} />} title={t('library.noSearchResults')} description={t('library.noSearchResultsDesc')} />
            ) : scope === 'trash' ? (
              <EmptyState icon={<Trash2 size={20} />} title={t('library.trashEmpty')} />
            ) : scope !== 'all' && scope !== 'recent' ? (
              <EmptyState
                icon={<BookOpen size={20} />}
                title={t('library.emptyScope')}
                description={t('library.emptyScopeDesc')}
              />
            ) : (
              <EmptyState
                icon={<BookOpen size={20} />}
                title={t('library.noArticles')}
                description={t('library.noArticlesDesc')}
                action={
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void importPdfs('files')}>
                      <Upload size={13} /> {t('library.importPdf')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setAddReferenceOpen(true)}>
                      <Plus size={13} /> {t('library.addReference')}
                    </Button>
                  </div>
                }
              />
            )}
          </div>
        </section>

        <ArticleDetailPanel
          articleId={selectedId}
          onChanged={() => void load()}
          onClose={() => setSelectedId(null)}
          className={cn('shrink-0', selectedId ? 'w-[400px]' : 'hidden')}
        />

        {dragActive ? (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-primary/50 bg-card px-10 py-8 text-center shadow-xl">
              <Upload size={28} className="mx-auto mb-2 text-primary" />
              <div className="text-sm font-semibold">{t('library.dragHint')}</div>
            </div>
          </div>
        ) : null}
      </div>
      )}

      <AddReferenceDialog
        open={addReferenceOpen}
        onOpenChange={setAddReferenceOpen}
        onCreated={(article) => {
          setSelectedId(article.id)
          setScope('all')
          bumpData()
        }}
      />

      <Dialog
        open={organizeOpen}
        onOpenChange={(open) => {
          setOrganizeOpen(open)
          if (!open) setOrganizeJobId(null)
        }}
      >
        <DialogContent className="w-[min(94vw,480px)]">
          <DialogHeader>
            <DialogTitle>{t('library.aiOrganizeTitle')}</DialogTitle>
            <DialogDescription>{t('library.aiOrganizeDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {organizeJobId ? (
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="font-medium">
                    {organizeProgress?.status === 'done'
                      ? t('operations.done')
                      : organizeProgress?.status === 'error'
                        ? t('operations.failed')
                        : t('operations.processing')}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {Math.round((organizeProgress?.progress ?? 0) * 100)}%
                  </span>
                </div>
                <Progress value={organizeProgress?.progress ?? 0} />
                <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {organizeProgress?.status === 'done'
                      ? t('library.aiOrganizeDone')
                      : organizeProgress?.status === 'error'
                        ? (organizeProgress.message ?? t('operations.failed'))
                        : (organizeCountMessage ?? t('operations.processing'))}
                  </span>
                  {organizeProgress?.status === 'running' ? <span>{t('common.running')}</span> : null}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('library.aiOrganizeKeywordCount')} hint={t('library.aiOrganizeKeywordCountHint')}>
                    <Input
                      value={keywordCount}
                      inputMode="numeric"
                      onChange={(event) => setKeywordCount(event.target.value)}
                    />
                  </Field>
                  <Field label={t('library.aiOrganizeMaxNew')} hint={t('library.aiOrganizeMaxNewHint')}>
                    <Input
                      value={maxNewCategories}
                      inputMode="numeric"
                      onChange={(event) => setMaxNewCategories(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('library.aiOrganizeSample')} hint={t('library.aiOrganizeSampleHint')}>
                    <Input
                      value={discoverySampleSize}
                      inputMode="numeric"
                      disabled={Math.max(0, Math.round(Number(maxNewCategories) || 0)) === 0}
                      onChange={(event) => setDiscoverySampleSize(event.target.value)}
                    />
                  </Field>
                  <Field label={t('library.aiOrganizeDepth')} hint={t('library.aiOrganizeDepthHint')}>
                    <Select value={thinkingDepth} onValueChange={(value) => setThinkingDepth(value as typeof thinkingDepth)}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('library.aiOrganizeDepthLow')}</SelectItem>
                        <SelectItem value="medium-low">{t('library.aiOrganizeDepthMediumLow')}</SelectItem>
                        <SelectItem value="high">{t('library.aiOrganizeDepthHigh')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
                  <Checkbox
                    checked={includeFullText}
                    onCheckedChange={(value) => setIncludeFullText(value === true)}
                  />
                  <span>
                    <span className="block text-foreground">{t('library.aiOrganizeFullText')}</span>
                    <span className="block text-[10.5px] text-muted-foreground">{t('library.aiOrganizeFullTextHint')}</span>
                  </span>
                </label>
                <p className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
                  {t('library.aiOrganizeNote', { n: total })}
                </p>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {organizeJobId ? (
              <Button variant="outline" size="sm" onClick={() => setOrganizeOpen(false)}>
                {t('common.close')}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setOrganizeOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onClick={() => void organizeUnclassified()} disabled={organizing}>
                  {organizing ? <Spinner size={12} /> : <Sparkles size={13} />}
                  {t('library.aiOrganizeStart')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CategoryPickDialog
        target={categoryTarget}
        categories={categories}
        onClose={() => setCategoryTarget(null)}
        onSelect={(categoryId) => void assignTargetCategory(categoryId)}
      />

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu ? contextItems(contextMenu.article) : []}
        onClose={() => setContextMenu(null)}
      />

      <MatchEvaluationDialog
        open={Boolean(matchArticleId)}
        onOpenChange={(open) => {
          if (!open) setMatchArticleId(null)
        }}
        articleId={matchArticleId}
      />

      <AlertDialog open={dedupeOpen} onOpenChange={setDedupeOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('library.dedupe')}</AlertDialogTitle>
          <AlertDialogDescription>{t('library.dedupeConfirm')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void dedupeArticles()} disabled={deduping}>
              {deduping ? <Spinner size={12} /> : null}
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('common.deletePermanently')}</AlertDialogTitle>
          <AlertDialogDescription>{t('library.deleteForeverConfirm')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteForever()}>{t('common.deletePermanently')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('common.emptyTrash')}</AlertDialogTitle>
          <AlertDialogDescription>{t('library.emptyTrashConfirm')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void emptyTrash()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  order,
  onSort,
  align = 'left'
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  order: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = currentSort === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        'flex min-w-0 items-center gap-0.5 rounded-sm text-[10.5px] font-semibold transition hover:text-foreground',
        align === 'right' && 'justify-end',
        active && 'text-primary'
      )}
      title={label}
    >
      <span className="truncate">{label}</span>
      {active ? (
        order === 'asc' ? (
          <ArrowUp size={9} className="shrink-0" />
        ) : (
          <ArrowDown size={9} className="shrink-0" />
        )
      ) : (
        <ArrowUpDown size={9} className="shrink-0 opacity-35" />
      )}
    </button>
  )
}

function CategoryPickDialog({
  target,
  categories,
  onClose,
  onSelect
}: {
  target: Article | null
  categories: Category[]
  onClose: () => void
  onSelect: (categoryId: string) => void
}) {
  const { t } = useT()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (target) setQuery('')
  }, [target])

  const filtered = categories
    .filter((category) => !query.trim() || (category.path ?? category.name).toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 200)

  return (
    <Dialog open={!!target} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="w-[min(92vw,460px)]">
        <DialogHeader>
          <DialogTitle>{t('library.addToCategory')}</DialogTitle>
          <DialogDescription>{target?.title ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('common.searchPlaceholder')}
            className="h-8 text-xs"
          />
          <div className="max-h-[55vh] space-y-0.5 overflow-y-auto">
            {filtered.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => onSelect(category.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-muted"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color ?? 'var(--muted-foreground)' }}
                />
                <span className="min-w-0 flex-1 truncate">{category.path ?? category.name}</span>
              </button>
            ))}
            {!filtered.length ? (
              <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">{t('common.noData')}</div>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddReferenceDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (article: Article) => void
}) {
  const { t } = useT()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    authors: '',
    journal: '',
    year: '',
    doi: '',
    url: '',
    abstract: '',
    keywords: ''
  })

  useEffect(() => {
    if (!open) return
    setForm({ title: '', authors: '', journal: '', year: '', doi: '', url: '', abstract: '', keywords: '' })
  }, [open])

  const update = (key: keyof typeof form, value: string): void => setForm((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    if (!form.title.trim()) {
      toast.error(t('common.requiredField'))
      return
    }
    setSaving(true)
    try {
      const article = await window.api.articles.create({
        title: form.title.trim(),
        authors: splitAuthors(form.authors),
        journalTitle: form.journal.trim() || null,
        year: form.year.trim() && Number.isFinite(Number(form.year)) ? Number(form.year) : null,
        doi: form.doi.trim() || null,
        url: form.url.trim() || null,
        abstract: form.abstract.trim() || null,
        keywords: splitKeywords(form.keywords),
        source: 'manual',
        inLibrary: true
      })
      toast.success(t('library.referenceAdded'))
      onOpenChange(false)
      onCreated(article)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,620px)]">
        <DialogHeader>
          <DialogTitle>{t('library.addReferenceTitle')}</DialogTitle>
          <DialogDescription>{t('library.addReferenceDesc')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label={t('common.title')}>
            <Input value={form.title} onChange={(event) => update('title', event.target.value)} />
          </Field>
          <Field label={t('common.authors')} hint={t('library.authorsHint')}>
            <Input value={form.authors} onChange={(event) => update('authors', event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.journal')}>
              <Input value={form.journal} onChange={(event) => update('journal', event.target.value)} />
            </Field>
            <Field label={t('common.year')}>
              <Input value={form.year} inputMode="numeric" onChange={(event) => update('year', event.target.value)} />
            </Field>
            <Field label={t('common.doi')}>
              <Input value={form.doi} onChange={(event) => update('doi', event.target.value)} placeholder="10.xxxx/xxxxx" />
            </Field>
            <Field label={t('library.url')}>
              <Input value={form.url} onChange={(event) => update('url', event.target.value)} />
            </Field>
          </div>
          <Field label={t('common.keywords')} hint={t('library.keywordsHint')}>
            <Input value={form.keywords} onChange={(event) => update('keywords', event.target.value)} />
          </Field>
          <Field label={t('common.abstract')}>
            <Textarea rows={5} value={form.abstract} onChange={(event) => update('abstract', event.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={12} /> : <Plus size={13} />}
            {t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
