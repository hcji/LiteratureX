import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookMinus,
  BookPlus,
  CheckCheck,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Info,
  Languages,
  LayoutList,
  List,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  Rows3,
  Search,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  UsersRound
} from 'lucide-react'
import type { Article, SearchResponseItem, Subscription, SubscriptionGroup } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { resolveArticleTextLanguage, translateMoreArticles, useArticleTextStore } from '../lib/articleText'
import { cn, errorMessage, relativeTime } from '../lib/utils'
import { PageHeader, PanelHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge, Dot } from '../components/ui/badge'
import { IconButton } from '../components/ui/tooltip'
import { Spinner, Progress } from '../components/ui/feedback'
import { operationPercent } from '../components/layout/OperationProgress'
import { EmptyState } from '../components/ui/layout-bits'
import { ArticleFeedItem, type FeedView } from '../components/ArticleList'
import { copyText } from '../components/ArticleBits'
import { ContextMenu, type ContextMenuItem } from '../components/ui/context-menu'
import { ArticleDetailPanel } from '../components/ArticleDetailPanel'
import { AddJournalDialog } from '../components/AddJournalDialog'
import { MatchEvaluationDialog } from '../components/MatchEvaluationDialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { Field, Input as TextInput } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch, Checkbox } from '../components/ui/primitives'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '../components/ui/alert-dialog'

type DiscoverFilter = 'all' | 'unread' | 'starred' | 'recent'

type FeedSort = 'publication_date' | 'created_at' | 'smart' | 'interest'

function sortFeedArticles(
  list: Article[],
  sort: FeedSort,
  order: 'asc' | 'desc',
  scores?: Record<string, { score: number }>
): Article[] {
  const factor = order === 'asc' ? 1 : -1
  const smartRank = (article: Article): number => {
    const tagged = article.categories.some((category) => category.status !== 'rejected')
    if (article.readStatus === 'unread') return tagged ? 0 : 1
    return tagged ? 2 : 3
  }
  return [...list].sort((a, b) => {
    if (sort === 'smart') {
      const rank = smartRank(a) - smartRank(b)
      if (rank !== 0) return rank
    }
    if (sort === 'interest') {
      const left = scores?.[a.id]?.score ?? 0
      const right = scores?.[b.id]?.score ?? 0
      if (left !== right) return (right - left) * (order === 'asc' ? -1 : 1)
    }
    if (sort === 'created_at') return a.createdAt.localeCompare(b.createdAt) * factor
    const aTime = a.publicationDate ? Date.parse(a.publicationDate) : Number.NaN
    const bTime = b.publicationDate ? Date.parse(b.publicationDate) : Number.NaN
    const aMissing = Number.isNaN(aTime)
    const bMissing = Number.isNaN(bTime)
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    return (aTime - bTime) * factor
  })
}

export function DiscoverPage() {
  const { t, language } = useT()
  const settings = useAppStore((state) => state.settings)
  const dataVersion = useAppStore((state) => state.dataVersion)
  const bumpData = useAppStore((state) => state.bumpData)
  const pendingDiscoverView = useAppStore((state) => state.pendingDiscoverView)
  const consumePendingDiscoverView = useAppStore((state) => state.consumePendingDiscoverView)
  const operations = useAppStore((state) => state.operations)
  const openPdfReader = useAppStore((state) => state.openPdfReader)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [groups, setGroups] = useState<SubscriptionGroup[]>([])
  const [filter, setFilter] = useState<DiscoverFilter>('all')
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<FeedSort>('smart')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [view, setView] = useState<FeedView>('list')
  const [articles, setArticles] = useState<Article[]>([])
  const [snippets, setSnippets] = useState<Record<string, string>>({})
  const [interestScores, setInterestScores] = useState<Record<string, { score: number }>>({})
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [categoryCounts, setCategoryCounts] = useState<
    Array<{ categoryId: string; name: string; color: string | null; count: number }>
  >([])
  const [matchArticleId, setMatchArticleId] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [groupMode, setGroupMode] = useState<'publisher' | 'custom'>('publisher')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editSubscription, setEditSubscription] = useState<Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set())
  const [syncingAll, setSyncingAll] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; article: Article } | null>(null)
  const [subscriptionMenu, setSubscriptionMenu] = useState<{ x: number; y: number; subscription: Subscription } | null>(null)
  const readKeepRef = useRef<Map<string, Article>>(new Map())
  const translationTarget = resolveArticleTextLanguage(settings?.appearance.articleTextLanguage, language)
  const aiConfigured = Boolean(settings?.ai.apiKeySet && settings.ai.model)
  const translationStarted = useArticleTextStore((state) =>
    translationTarget === 'original' ? 0 : state.started[translationTarget] ?? 0
  )

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 320)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!pendingDiscoverView) return
    readKeepRef.current.clear()
    setActiveSubscriptionId(null)
    setFilter(pendingDiscoverView)
    setSelectedId(null)
    consumePendingDiscoverView()
  }, [pendingDiscoverView, consumePendingDiscoverView])

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

  const loadSubscriptions = useCallback(async () => {
    try {
      const [subs, groupList] = await Promise.all([
        window.api.subscriptions.list(),
        window.api.groups.list()
      ])
      setSubscriptions(subs)
      setGroups(groupList)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadSubscriptions()
  }, [loadSubscriptions, dataVersion])

  useEffect(() => {
    let cancelled = false
    window.api.articles
      .categoryCounts('discover', activeSubscriptionId)
      .then((counts) => {
        if (!cancelled) setCategoryCounts(counts)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [dataVersion, activeSubscriptionId])

  const buildQuery = (offset: number): Parameters<typeof window.api.articles.list>[0] => ({
    scope: 'discover',
    subscriptionId: activeSubscriptionId ?? undefined,
    categoryIds: categoryFilters.length ? categoryFilters : undefined,
    unreadOnly: filter === 'unread',
    starredOnly: filter === 'starred',
    search: debouncedSearch || undefined,
    sort: filter === 'recent' ? 'publication_date' : sort,
    order,
    limit: 100000,
    offset
  })

  const loadArticles = useCallback(async () => {
    setLoading(true)
    try {
      const query = buildQuery(0)
      let next: Article[]
      let nextTotal: number
      let nextScores: Record<string, { score: number }> = {}
      if (debouncedSearch) {
        const result = await window.api.articles.search(query)
        next = result.items.map((item) => item.article)
        setSnippets(Object.fromEntries(result.items.map((item: SearchResponseItem) => [item.article.id, item.snippet])))
        nextScores = result.interestScores ?? {}
        nextTotal = result.total
      } else {
        const result = await window.api.articles.list(query)
        next = result.items
        setSnippets({})
        nextScores = result.interestScores ?? {}
        nextTotal = result.total
      }
      if (filter === 'unread' && readKeepRef.current.size) {
        const term = debouncedSearch.trim().toLowerCase()
        const keep = [...readKeepRef.current.values()].filter((article) => {
          if (activeSubscriptionId && article.subscriptionId !== activeSubscriptionId) return false
          if (!term) return true
          const haystack = [
            article.title,
            article.abstract ?? '',
            article.journalTitle ?? '',
            article.doi ?? '',
            article.authors.join(' ')
          ]
            .join(' ')
            .toLowerCase()
          return haystack.includes(term)
        })
        const keepIds = new Set(keep.map((article) => article.id))
        next = sortFeedArticles([...next.filter((article) => !keepIds.has(article.id)), ...keep], sort, order, nextScores)
        nextTotal += keep.length
      }
      setArticles(next)
      setInterestScores(nextScores)
      setTotal(nextTotal)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubscriptionId, filter, debouncedSearch, sort, order, categoryFilters.join(',')])

  useEffect(() => {
    void loadArticles()
  }, [loadArticles, dataVersion])

  const activeSubscription = subscriptions.find((item) => item.id === activeSubscriptionId) ?? null

  const grouped = useMemo(() => {
    const result: Array<{ key: string; label: string; subscriptions: Subscription[] }> = []
    if (groupMode === 'publisher') {
      const map = new Map<string, Subscription[]>()
      for (const subscription of subscriptions) {
        const publisher = subscription.journal?.publisher || t('discover.publisher')
        const list = map.get(publisher) ?? []
        list.push(subscription)
        map.set(publisher, list)
      }
      for (const [publisher, items] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        result.push({ key: publisher, label: publisher, subscriptions: items })
      }
      return result
    }
    const byGroup = new Map<string, Subscription[]>()
    const ungrouped: Subscription[] = []
    for (const subscription of subscriptions) {
      if (subscription.groupId) {
        const list = byGroup.get(subscription.groupId) ?? []
        list.push(subscription)
        byGroup.set(subscription.groupId, list)
      } else {
        ungrouped.push(subscription)
      }
    }
    for (const group of groups) {
      result.push({ key: group.id, label: group.name, subscriptions: byGroup.get(group.id) ?? [] })
    }
    if (ungrouped.length) result.push({ key: 'ungrouped', label: t('discover.allJournals'), subscriptions: ungrouped })
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions, groups, groupMode, t])

  const unreadTotal = subscriptions.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0)

  const selectFilter = (next: DiscoverFilter): void => {
    readKeepRef.current.clear()
    setActiveSubscriptionId(null)
    setFilter(next)
    setSelectedId(null)
    if (next === 'recent') {
      setSort('publication_date')
      setOrder('desc')
    }
  }

  const selectSubscription = (id: string): void => {
    readKeepRef.current.clear()
    setActiveSubscriptionId(id)
    setFilter('all')
    setSelectedId(null)
  }

  const toggleCategoryFilter = (categoryId: string): void => {
    const next = categoryFilters.includes(categoryId)
      ? categoryFilters.filter((id) => id !== categoryId)
      : [...categoryFilters, categoryId]
    setCategoryFilters(next)
    if (next.length > categoryFilters.length && sort !== 'interest') {
      setSort('interest')
      setOrder('desc')
    }
  }

  const syncOne = async (subscription: Subscription): Promise<void> => {
    readKeepRef.current.clear()
    setFilter('all')
    setActiveSubscriptionId(subscription.id)
    setSelectedId(null)
    setSyncingIds((current) => new Set(current).add(subscription.id))
    try {
      const outcome = await window.api.subscriptions.sync(subscription.id, false)
      if (outcome.status === 'error') toast.error(t('discover.syncError', { error: outcome.error ?? '' }))
      else toast.success(t('discover.syncDone', { found: outcome.found, added: outcome.added }))
      await loadSubscriptions()
      bumpData()
    } catch (error) {
      toast.error(t('discover.syncError', { error: errorMessage(error) }))
    } finally {
      setSyncingIds((current) => {
        const next = new Set(current)
        next.delete(subscription.id)
        return next
      })
    }
  }

  const syncAll = async (): Promise<void> => {
    readKeepRef.current.clear()
    setFilter('all')
    setActiveSubscriptionId(null)
    setSelectedId(null)
    setSyncingAll(true)
    try {
      const outcomes = await window.api.subscriptions.syncAll(false)
      const added = outcomes.reduce((sum, item) => sum + item.added, 0)
      const failed = outcomes.filter((item) => item.status === 'error').length
      toast.success(`${t('discover.syncAllDone')} +${added}${failed ? ` · ${failed} error(s)` : ''}`)
      await loadSubscriptions()
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSyncingAll(false)
    }
  }

  const classifyUntagged = async (): Promise<void> => {
    setTagging(true)
    try {
      const result = await window.api.articles.classifyUnclassifiedDiscover()
      if (result.reason === 'no-categories') toast.warning(t('discover.tagNoCategories'))
      else if (result.count) toast.success(t('discover.tagQueued', { n: result.count }))
      else toast.info(t('discover.tagNone'))
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTagging(false)
    }
  }

  const toggleSubscriptionEnabled = async (subscription: Subscription): Promise<void> => {
    try {
      await window.api.subscriptions.update(subscription.id, { enabled: !subscription.enabled })
      toast.success(subscription.enabled ? t('discover.disableSync') : t('discover.enableSync'))
      await loadSubscriptions()
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const subscriptionContextItems = (subscription: Subscription): ContextMenuItem[] => [
    {
      key: 'view',
      label: t('discover.viewSubscription'),
      icon: <List size={12} />,
      onSelect: () => selectSubscription(subscription.id)
    },
    {
      key: 'sync',
      label: t('discover.syncSubscription'),
      icon: <RefreshCw size={12} />,
      onSelect: () => void syncOne(subscription)
    },
    {
      key: 'edit',
      label: t('discover.editSubscription'),
      icon: <Settings2 size={12} />,
      onSelect: () => setEditSubscription(subscription)
    },
    {
      key: 'toggle',
      label: subscription.enabled ? t('discover.disableSync') : t('discover.enableSync'),
      icon: <Power size={12} />,
      onSelect: () => void toggleSubscriptionEnabled(subscription)
    },
    {
      key: 'copy',
      label: t('discover.copyFeedUrl'),
      icon: <Copy size={12} />,
      disabled: !subscription.feed?.url,
      onSelect: () => void copyText(subscription.feed?.url ?? '')
    },
    { separator: true },
    {
      key: 'delete',
      label: t('discover.unsubscribe'),
      icon: <Trash2 size={12} />,
      danger: true,
      onSelect: () => setDeleteTarget(subscription)
    }
  ]

  const markAllRead = async (): Promise<void> => {
    const unread = articles.filter((article) => article.readStatus === 'unread')
    if (!unread.length) return
    if (filter === 'unread') {
      for (const article of unread) readKeepRef.current.set(article.id, { ...article, readStatus: 'read' })
    }
    await Promise.all(unread.map((article) => window.api.articles.setRead(article.id, 'read')))
    bumpData()
    await loadArticles()
  }

  const toggleStar = async (article: Article): Promise<void> => {
    await window.api.articles.setStarred(article.id, !article.starred)
    setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, starred: !item.starred } : item)))
  }

  const toggleRead = async (article: Article): Promise<void> => {
    const next = article.readStatus === 'unread' ? 'read' : 'unread'
    await window.api.articles.setRead(article.id, next)
    if (next === 'read' && filter === 'unread') {
      readKeepRef.current.set(article.id, { ...article, readStatus: 'read' })
    } else if (next === 'unread') {
      readKeepRef.current.delete(article.id)
    }
    setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, readStatus: next } : item)))
  }

  const keepReadVisible = (article: Article): void => {
    if (filter !== 'unread') return
    readKeepRef.current.set(article.id, { ...article, readStatus: 'read' })
    setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, readStatus: 'read' } : item)))
  }

  const addToLibrary = async (article: Article): Promise<void> => {
    try {
      await window.api.articles.setInLibrary(article.id, true)
      setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, inLibrary: true } : item)))
      toast.success(t('discover.savedToLibrary'))
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const removeFromLibrary = async (article: Article): Promise<void> => {
    try {
      await window.api.articles.setInLibrary(article.id, false)
      setArticles((current) => current.map((item) => (item.id === article.id ? { ...item, inLibrary: false } : item)))
      toast.success(t('context.removeFromLibrary'))
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const downloadOaFor = async (article: Article): Promise<void> => {
    try {
      const result = await window.api.pdf.downloadOA(article.id)
      if (result.error) toast.warning(result.error)
      else toast.success(t('article.oaDownloaded'))
      bumpData()
      await loadArticles()
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

  const contextItems = (article: Article): ContextMenuItem[] => {
    const hasPdf = article.pdfFiles.length > 0
    const canDownload = !hasPdf && (Boolean(article.doi) || /\.pdf($|\?)/i.test(article.url ?? ''))
    return [
      { key: 'open', label: t('common.details'), icon: <Info size={12} />, onSelect: () => setSelectedId(article.id) },
      {
        key: 'reader',
        label: t('reader.openFull'),
        icon: <FileText size={12} />,
        disabled: !hasPdf,
        onSelect: () => {
          const pdf = article.pdfFiles[0]
          if (pdf) openPdfReader({ articleId: article.id, pdfId: pdf.id, title: article.title })
        }
      },
      {
        key: 'system-pdf',
        label: t('reader.openSystem'),
        icon: <ExternalLink size={12} />,
        disabled: !hasPdf,
        onSelect: () => void window.api.articles.openInSystem(article.id)
      },
      article.inLibrary
        ? {
            key: 'library',
            label: t('context.removeFromLibrary'),
            icon: <BookMinus size={12} />,
            onSelect: () => void removeFromLibrary(article)
          }
        : {
            key: 'library',
            label: t('discover.saveToLibrary'),
            icon: <BookPlus size={12} />,
            onSelect: () => void addToLibrary(article)
          },
      {
        key: 'read',
        label: article.readStatus === 'unread' ? t('discover.markRead') : t('discover.markUnread'),
        icon: article.readStatus === 'unread' ? <CheckCircle2 size={12} /> : <Circle size={12} />,
        onSelect: () => void toggleRead(article)
      },
      {
        key: 'star',
        label: article.starred ? t('article.unstar') : t('article.star'),
        icon: <Star size={12} />,
        onSelect: () => void toggleStar(article)
      },
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
        key: 'original',
        label: t('discover.openOriginal'),
        icon: <ExternalLink size={12} />,
        disabled: !article.url && !article.doi,
        onSelect: () => void openOriginalFor(article)
      },
      {
        key: 'reveal',
        label: t('library.revealFile'),
        icon: <FolderOpen size={12} />,
        disabled: !hasPdf,
        onSelect: () => void revealPdfFor(article)
      },
      {
        key: 'copy-doi',
        label: t('context.copyDoi'),
        icon: <Copy size={12} />,
        disabled: !article.doi,
        onSelect: () => void copyText(article.doi ?? '')
      }
    ]
  }

  const deleteSubscription = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await window.api.subscriptions.delete(deleteTarget.id)
      if (activeSubscriptionId === deleteTarget.id) {
        setActiveSubscriptionId(null)
        setSelectedId(null)
      }
      setDeleteTarget(null)
      await loadSubscriptions()
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const createGroup = async (): Promise<void> => {
    if (!newGroupName.trim()) return
    try {
      await window.api.groups.create(newGroupName.trim())
      setNewGroupName('')
      await loadSubscriptions()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const title = activeSubscription
    ? activeSubscription.journal?.title || activeSubscription.name || activeSubscription.feed?.title || ''
    : filter === 'unread'
      ? t('discover.unread')
      : filter === 'starred'
        ? t('discover.starred')
        : filter === 'recent'
          ? t('discover.recentlyPublished')
          : t('discover.allArticles')

  const syncOperation = Object.values(operations).find(
    (operation) => operation.kind === 'sync' && operation.status === 'running'
  )
  const syncPercent = syncOperation ? operationPercent(syncOperation) : undefined
  const classificationOperation = Object.values(operations).find(
    (operation) => operation.kind === 'classification' && operation.status === 'running'
  )
  const classificationPercent = classificationOperation ? operationPercent(classificationOperation) : undefined

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('discover.title')}
        subtitle={t('discover.subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void classifyUntagged()}
              disabled={tagging || subscriptions.length === 0}
              title={t('discover.classifyUntaggedHint')}
            >
              {tagging ? <Spinner size={13} /> : <Sparkles size={13} />}
              {t('discover.classifyUntagged')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void syncAll()} disabled={syncingAll}>
              {syncingAll ? <Spinner size={13} /> : <RefreshCw size={13} />}
              {t('common.refreshAll')}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> {t('discover.addJournal')}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[236px] shrink-0 flex-col border-r border-border/70 bg-card/25">
          <div className="flex gap-1 border-b border-border/60 p-2">
            {(
              [
                ['all', 'discover.filterAll'],
                ['unread', 'discover.filterUnread'],
                ['starred', 'discover.filterStarred'],
                ['recent', 'discover.filterRecent']
              ] as Array<[DiscoverFilter, Parameters<typeof t>[0]]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => selectFilter(value)}
                className={cn(
                  'flex-1 rounded-md px-1 py-1.5 text-[11.5px] font-medium transition',
                  filter === value && !activeSubscriptionId
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {t(label)}
                {value === 'unread' && unreadTotal ? <span className="ml-1 tabular-nums opacity-80">{unreadTotal}</span> : null}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">              {t('discover.feeds')}
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton label={t('discover.manageGroups')} onClick={() => setGroupDialogOpen(true)}>
                <UsersRound size={12} />
              </IconButton>
              <IconButton label={t('discover.addJournal')} onClick={() => setAddOpen(true)}>
                <Plus size={13} />
              </IconButton>
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5 text-[10.5px]">
            <button
              type="button"
              onClick={() => setGroupMode('publisher')}
              className={cn(
                'rounded px-1.5 py-0.5 transition',
                groupMode === 'publisher' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('discover.groupByPublisher')}
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('custom')}
              className={cn(
                'rounded px-1.5 py-0.5 transition',
                groupMode === 'custom' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('discover.groupByCustom')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {subscriptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
                {t('discover.noSubscriptions')}
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.key} className="mb-1.5">
                  <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
                    <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group.label || '—'}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground/50">{group.subscriptions.length}</span>
                  </div>
                  {group.subscriptions.map((subscription) => {
                    const active = subscription.id === activeSubscriptionId
                    const syncing = syncingIds.has(subscription.id)
                    const name = subscription.journal?.title || subscription.name || subscription.feed?.title || subscription.feedId
                    return (
                      <div
                        key={subscription.id}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setSubscriptionMenu({ x: event.clientX, y: event.clientY, subscription })
                        }}
                        className={cn(
                          'group flex items-center gap-1.5 rounded-md px-2 py-[5px] text-[12px] transition',
                          active ? 'bg-accent text-accent-foreground' : 'text-foreground/75 hover:bg-muted/60'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => selectSubscription(subscription.id)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              subscription.feed?.lastStatus === 'error'
                                ? 'bg-destructive'
                                : subscription.enabled
                                  ? 'bg-emerald-500'
                                  : 'bg-muted-foreground/30'
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                          {subscription.unreadCount ? (
                            <span className="rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">
                              {subscription.unreadCount}
                            </span>
                          ) : null}
                        </button>
                        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                          <IconButton label={t('discover.syncNowShort')} onClick={() => void syncOne(subscription)}>
                            {syncing ? <Spinner size={11} /> : <RefreshCw size={11} />}
                          </IconButton>
                          <IconButton label={t('discover.editSubscription')} onClick={() => setEditSubscription(subscription)}>
                            <Settings2 size={11} />
                          </IconButton>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground/70">
            {subscriptions.length ? `${subscriptions.length} ${t('common.journals')}` : t('discover.noSubscriptions')}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <span className="max-w-[260px] truncate">{title}</span>
                <span className="rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums text-muted-foreground">{total}</span>
              </span>
            }
            actions={
              <>
                {activeSubscription ? (
                  <IconButton label={t('discover.syncSubscription')} onClick={() => void syncOne(activeSubscription)}>
                    {syncingIds.has(activeSubscription.id) ? <Spinner size={12} /> : <RefreshCw size={13} />}
                  </IconButton>
                ) : null}
                <IconButton label={t('discover.markAllRead')} onClick={() => void markAllRead()}>
                  <CheckCheck size={13} />
                </IconButton>
                <div className="mx-1 flex items-center rounded-md border border-border/80 p-0.5">
                  {(
                    [
                      ['list', List],
                      ['compact', Rows3],
                      ['detailed', LayoutList]
                    ] as Array<[FeedView, typeof List]>
                  ).map(([value, Icon]) => (
                    <button
                      key={value}
                      type="button"
                      title={t(value === 'list' ? 'discover.viewList' : value === 'compact' ? 'discover.viewCompact' : 'discover.viewDetailed')}
                      onClick={() => setView(value)}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded transition',
                        view === value ? 'bg-muted text-foreground' : 'text-muted-foreground/60 hover:text-foreground'
                      )}
                    >
                      <Icon size={12} />
                    </button>
                  ))}
                </div>
                <Select
                  value={`${sort}:${order}`}
                  onValueChange={(value) => {
                    const [nextSort, nextOrder] = value.split(':') as [
                      FeedSort,
                      'asc' | 'desc'
                    ]
                    setSort(nextSort)
                    setOrder(nextOrder)
                  }}
                >
                  <SelectTrigger className="h-7 w-[148px] text-[11px]" title={t('discover.sortSmartHint')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interest:desc">{t('discover.sortInterest')}</SelectItem>
                    <SelectItem value="smart:desc">{t('discover.sortSmart')}</SelectItem>
                    <SelectItem value="publication_date:desc">{t('discover.sortNewest')}</SelectItem>
                    <SelectItem value="publication_date:asc">{t('discover.sortOldest')}</SelectItem>
                    <SelectItem value="created_at:desc">{t('discover.sortAdded')}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
          />

          {syncOperation ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/[0.04] px-3 py-1.5">
              <RefreshCw size={11} className="shrink-0 animate-spin text-primary" />
              <span className="shrink-0 text-[11px] font-medium text-foreground">{t('operations.sync')}</span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
                {syncOperation.total
                  ? `${syncOperation.current ?? 0}/${syncOperation.total}`
                  : t('operations.processing')}
                {syncOperation.detail ? ` · ${syncOperation.detail}` : ''}
              </span>
              <Progress
                value={syncPercent ?? 0}
                indeterminate={syncPercent == null}
                className="h-1 w-[120px] shrink-0"
              />
              {syncPercent != null ? (
                <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
                  {Math.round(syncPercent * 100)}%
                </span>
              ) : null}
            </div>
          ) : null}

          {classificationOperation ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/[0.035] px-3 py-1.5">
              <Sparkles size={11} className="shrink-0 text-primary" />
              <span className="shrink-0 text-[11px] font-medium text-foreground">{t('operations.classification')}</span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
                {classificationOperation.total
                  ? `${classificationOperation.current ?? 0}/${classificationOperation.total}`
                  : (classificationOperation.detail ?? t('operations.processing'))}
              </span>
              <Progress
                value={classificationPercent ?? 0}
                indeterminate={classificationPercent == null}
                className="h-1 w-[120px] shrink-0"
              />
              {classificationPercent != null ? (
                <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
                  {Math.round(classificationPercent * 100)}%
                </span>
              ) : null}
            </div>
          ) : null}

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
                placeholder={t('common.searchPlaceholder')}
                data-page-search
                className="h-7 pl-7 text-[11.5px]"
              />
            </div>
            {translationTarget !== 'original' && aiConfigured && translationStarted > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => translateMoreArticles(translationTarget)}
                title={t('article.translateMoreHint')}
              >
                <Languages size={11} /> {t('article.translateMore')}
              </Button>
            ) : null}
            {activeSubscription ? (
              <Button variant="ghost" size="xs" onClick={() => setEditSubscription(activeSubscription)}>
                <Settings2 size={11} /> {t('discover.subscriptionSettings')}
              </Button>
            ) : null}
          </div>

          {categoryCounts.length ? (
            <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-muted/10 px-3 py-1.5">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('discover.filterByCategory')}
              </span>
              {categoryCounts.map((category) => {
                const active = categoryFilters.includes(category.categoryId)
                return (
                  <button
                    key={category.categoryId}
                    type="button"
                    onClick={() => toggleCategoryFilter(category.categoryId)}
                    className={cn(
                      'inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition',
                      active
                        ? 'border-primary/45 bg-primary/10 font-medium text-primary'
                        : 'border-border/70 bg-card text-foreground/70 hover:border-primary/30 hover:text-foreground'
                    )}
                  >
                    <Dot color={category.color} className="h-1.5 w-1.5" />
                    <span className="truncate">{category.name}</span>
                    <span className="tabular-nums text-muted-foreground">{category.count}</span>
                  </button>
                )
              })}
              {categoryFilters.length ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCategoryFilters([])}
                    className="rounded-full px-2 py-0.5 text-[10.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {t('common.clear')}
                  </button>
                  {sort !== 'interest' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSort('interest')
                        setOrder('desc')
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10.5px] text-primary transition hover:bg-primary/10"
                    >
                      <Sparkles size={9} /> {t('discover.sortInterestShort')}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div data-testid="discover-list" className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : articles.length ? (
              <>
                {articles.map((article) => (
                  <ArticleFeedItem
                    key={article.id}
                    article={article}
                    active={article.id === selectedId}
                    view={view}
                    interestScore={interestScores[article.id]?.score}
                    onSelect={() => setSelectedId(article.id)}
                    onToggleStar={() => void toggleStar(article)}
                    onToggleRead={() => void toggleRead(article)}
                    onAddToLibrary={() => void addToLibrary(article)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setContextMenu({ x: event.clientX, y: event.clientY, article })
                    }}
                  />
                ))}
              </>
            ) : subscriptions.length === 0 ? (
              <EmptyState
                icon={<Rss size={20} />}
                title={t('discover.noSubscriptions')}
                description={t('discover.noSubscriptionsDesc')}
                action={
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus size={13} /> {t('discover.addFirstJournal')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Rss size={20} />}
                title={filter === 'unread' ? t('discover.noUnread') : filter === 'starred' ? t('discover.noStarred') : t('discover.noArticles')}
                description={t('discover.noArticlesDesc')}
                action={
                  <Button variant="outline" size="sm" onClick={() => void (activeSubscription ? syncOne(activeSubscription) : syncAll())}>
                    <RefreshCw size={13} /> {t('common.refresh')}
                  </Button>
                }
              />
            )}
          </div>
        </section>

        <ArticleDetailPanel
          articleId={selectedId}
          onChanged={() => void loadArticles()}
          onRead={keepReadVisible}
          onClose={() => setSelectedId(null)}
          className={cn('shrink-0', selectedId ? 'w-[400px]' : 'hidden')}
        />
      </div>

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu ? contextItems(contextMenu.article) : []}
        onClose={() => setContextMenu(null)}
      />

      <ContextMenu
        open={!!subscriptionMenu}
        x={subscriptionMenu?.x ?? 0}
        y={subscriptionMenu?.y ?? 0}
        items={subscriptionMenu ? subscriptionContextItems(subscriptionMenu.subscription) : []}
        onClose={() => setSubscriptionMenu(null)}
      />

      <MatchEvaluationDialog
        open={Boolean(matchArticleId)}
        onOpenChange={(open) => {
          if (!open) setMatchArticleId(null)
        }}
        articleId={matchArticleId}
      />

      <AddJournalDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groups={groups}
        onCreated={() => {
          void loadSubscriptions()
          bumpData()
        }}
        onGroupsChanged={() => void loadSubscriptions()}
      />

      <SubscriptionSettingsDialog
        subscription={editSubscription}
        groups={groups}
        onOpenChange={(open) => {
          if (!open) setEditSubscription(null)
        }}
        onSaved={() => {
          void loadSubscriptions()
          bumpData()
          setEditSubscription(null)
        }}
        onDelete={(subscription) => {
          setEditSubscription(null)
          setDeleteTarget(subscription)
        }}
      />

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="w-[min(92vw,460px)]">
          <DialogHeader>
            <DialogTitle>{t('discover.manageGroups')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex gap-2">
              <TextInput value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder={t('discover.groupName')} />
              <Button variant="outline" onClick={() => void createGroup()} disabled={!newGroupName.trim()}>
                <Plus size={13} /> {t('common.add')}
              </Button>
            </div>
            <div className="space-y-1">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-[11.5px]">
                  <Dot color={group.color} />
                  <span className="flex-1 truncate">{group.name}</span>
                  <IconButton
                    label={t('common.delete')}
                    onClick={() => {
                      void window.api.groups.delete(group.id).then(() => {
                        void loadSubscriptions()
                      })
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              ))}
              {!groups.length ? <div className="py-4 text-center text-[11px] text-muted-foreground">{t('common.noData')}</div> : null}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('discover.deleteSubscription')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('discover.confirmDeleteSubscription', {
              name: deleteTarget?.journal?.title || deleteTarget?.name || deleteTarget?.feed?.title || ''
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteSubscription()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SubscriptionSettingsDialog({
  subscription,
  groups,
  onOpenChange,
  onSaved,
  onDelete
}: {
  subscription: Subscription | null
  groups: SubscriptionGroup[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onDelete: (subscription: Subscription) => void
}) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('none')
  const [interval, setIntervalValue] = useState('60')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!subscription) return
    setName(subscription.name ?? subscription.journal?.title ?? subscription.feed?.title ?? '')
    setGroupId(subscription.groupId ?? 'none')
    setIntervalValue(String(subscription.intervalMinutes))
    setEnabled(subscription.enabled)
  }, [subscription])

  const save = async (): Promise<void> => {
    if (!subscription) return
    setSaving(true)
    try {
      await window.api.subscriptions.update(subscription.id, {
        name: name.trim() || null,
        groupId: groupId === 'none' ? null : groupId,
        intervalMinutes: Math.max(5, Number(interval) || 60),
        enabled
      })
      onSaved()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(subscription)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>{t('discover.subscriptionSettings')}</DialogTitle>
          <DialogDescription>
            {subscription?.journal?.title || subscription?.feed?.title || ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label={t('discover.subscriptionName')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('discover.group')}>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('discover.noGroup')}</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('discover.interval')}>
              <Input value={interval} inputMode="numeric" onChange={(event) => setIntervalValue(event.target.value)} />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <div className="text-[11.5px]">{t('discover.enabled')}</div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="break-all rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
            {subscription?.feed?.url}
          </div>
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => subscription && onDelete(subscription)}
          >
            <Trash2 size={13} /> {t('discover.deleteSubscription')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={12} /> : null}
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Rss(props: { size?: number }) {
  return (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  )
}
