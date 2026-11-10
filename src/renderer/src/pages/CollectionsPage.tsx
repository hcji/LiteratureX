import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Folder,
  FolderTree,
  GitMerge,
  Lightbulb,
  ListTree,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  X
} from 'lucide-react'
import type { Article, Category, CategoryInput, TaxonomySuggestion } from '@shared/types'
import { CATEGORY_COLORS } from '@shared/constants'
import { isCjk } from '@shared/normalize'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { cn, errorMessage, formatDate, splitKeywords } from '../lib/utils'
import { PageHeader, PanelHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Input, Textarea, Field } from '../components/ui/input'
import { Badge, Dot } from '../components/ui/badge'
import { Spinner, Progress } from '../components/ui/feedback'
import { EmptyState } from '../components/ui/layout-bits'
import { IconButton } from '../components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch, Checkbox } from '../components/ui/primitives'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '../components/ui/alert-dialog'
import { ContextMenu, type ContextMenuItem } from '../components/ui/context-menu'
import { LocalizedArticleTitle } from '../components/ArticleBits'

export function CollectionsPage() {
  const { t, language } = useT()
  const dataVersion = useAppStore((state) => state.dataVersion)
  const bumpData = useAppStore((state) => state.bumpData)
  const jobProgress = useAppStore((state) => state.jobProgress)
  const operations = useAppStore((state) => state.operations)
  const openArticle = useAppStore((state) => state.openArticle)
  const [tree, setTree] = useState<Category[]>([])
  const [flat, setFlat] = useState<Category[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [articles, setArticles] = useState<Article[]>([])
  const [totalArticles, setTotalArticles] = useState(0)
  const [suggestions, setSuggestions] = useState<TaxonomySuggestion[]>([])
  const [tab, setTab] = useState('papers')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [parentPreset, setParentPreset] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [reclassifyOpen, setReclassifyOpen] = useState(false)
  const [reclassifying, setReclassifying] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set())
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [mergeDescription, setMergeDescription] = useState('')
  const [mergeKeywords, setMergeKeywords] = useState<string[]>([])
  const [mergeProvider, setMergeProvider] = useState<'ai' | 'local' | null>(null)
  const [suggestingMerge, setSuggestingMerge] = useState(false)
  const [merging, setMerging] = useState(false)
  const [categoryMenu, setCategoryMenu] = useState<{ x: number; y: number; category: Category } | null>(null)

  const loadCategories = useCallback(async () => {
    try {
      const [categoryTree, categoryFlat, suggestionList] = await Promise.all([
        window.api.categories.tree(),
        window.api.categories.flat(),
        window.api.suggestions.list()
      ])
      setTree(categoryTree)
      setFlat(categoryFlat)
      setSuggestions(suggestionList)
      setExpanded((current) => {
        if (!current.size) return new Set(categoryFlat.filter((category) => !category.parentId).map((category) => category.id))
        return current
      })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories, dataVersion])

  const selected = useMemo(() => flat.find((category) => category.id === selectedId) ?? null, [flat, selectedId])
  const selectedChildren = useMemo(
    () => flat.filter((category) => category.parentId === selectedId),
    [flat, selectedId]
  )

  useEffect(() => {
    if (!selectedId && flat.length) setSelectedId(flat[0].id)
  }, [flat, selectedId])

  const loadArticles = useCallback(async () => {
    if (!selectedId) {
      setArticles([])
      setTotalArticles(0)
      return
    }
    setLoading(true)
    try {
      const result = await window.api.articles.list({
        scope: 'library',
        categoryId: selectedId,
        limit: 100000,
        sort: 'publication_date'
      })
      setArticles(result.items)
      setTotalArticles(result.total)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadArticles()
  }, [loadArticles, dataVersion])

  const activeClassification = Object.entries(jobProgress)
    .filter(([, value]) => value.type === 'classification' && value.status === 'running')
    .at(-1)?.[1]

  const activeAssistant = Object.values(operations).find(
    (operation) => operation.kind === 'assistant' && operation.status === 'running'
  )

  const generateSuggestions = async (): Promise<void> => {
    setGenerating(true)
    try {
      const created = await window.api.suggestions.generate()
      toast.success(t('collections.suggestionsGenerated', { n: created.length }))
      await loadCategories()
      setTab('suggestions')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setGenerating(false)
    }
  }

  const acceptSuggestion = async (id: string): Promise<void> => {
    try {
      await window.api.suggestions.accept(id)
      toast.success(t('collections.suggestionAccepted'))
      await loadCategories()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const dismissSuggestion = async (id: string): Promise<void> => {
    await window.api.suggestions.dismiss(id)
    await loadCategories()
  }

  const deleteCategory = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      await window.api.categories.delete(deleteTarget.id)
      toast.success(t('collections.categoryDeleted'))
      if (selectedId === deleteTarget.id) setSelectedId(null)
      setDeleteTarget(null)
      bumpData()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const reclassifyAll = async (): Promise<void> => {
    setReclassifyOpen(false)
    setReclassifying(true)
    try {
      const jobId = await window.api.articles.reclassifyAll()
      if (jobId) toast.success(t('collections.reclassifyStarted'))
      else toast.warning(t('library.bulkClassifyNoCategories'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setReclassifying(false)
    }
  }

  const reclassifyCategory = async (): Promise<void> => {
    const ids = articles.map((article) => article.id)
    if (!ids.length) {
      toast.warning(t('collections.noAssignedPapers'))
      return
    }
    try {
      await window.api.articles.classifyBatch(ids, true)
      toast.success(t('library.bulkClassifyStarted', { n: ids.length }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const reclassifyCategoryById = async (categoryId: string): Promise<void> => {
    try {
      const result = await window.api.articles.list({ scope: 'library', categoryId, limit: 500, sort: 'publication_date' })
      const ids = result.items.map((article) => article.id)
      if (!ids.length) {
        toast.warning(t('collections.noAssignedPapers'))
        return
      }
      await window.api.articles.classifyBatch(ids, true)
      toast.success(t('library.bulkClassifyStarted', { n: ids.length }))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const toggleCategoryActive = async (category: Category): Promise<void> => {
    try {
      await window.api.categories.update(category.id, { isActive: !category.isActive })
      toast.success(category.isActive ? t('collections.deactivated') : t('collections.activated'))
      bumpData()
      await loadCategories()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const categoryContextItems = (category: Category): ContextMenuItem[] => [
    { key: 'edit', label: t('common.edit'), icon: <Pencil size={12} />, onSelect: () => openEdit(category) },
    {
      key: 'child',
      label: t('collections.newSubcategory'),
      icon: <Plus size={12} />,
      onSelect: () => openCreate(category.id)
    },
    {
      key: 'toggle',
      label: category.isActive ? t('collections.deactivate') : t('collections.activate'),
      icon: <Power size={12} />,
      onSelect: () => void toggleCategoryActive(category)
    },
    {
      key: 'reclassify',
      label: t('collections.reclassifyCategory'),
      icon: <RefreshCw size={12} />,
      onSelect: () => void reclassifyCategoryById(category.id)
    },
    { separator: true },
    {
      key: 'delete',
      label: t('common.delete'),
      icon: <Trash2 size={12} />,
      danger: true,
      onSelect: () => setDeleteTarget(category)
    }
  ]

  const openCreate = (parentId: string | null): void => {
    setEditingCategory(null)
    setParentPreset(parentId)
    setDialogOpen(true)
  }

  const openEdit = (category: Category): void => {
    setEditingCategory(category)
    setParentPreset(null)
    setDialogOpen(true)
  }

  const expandAll = (): void => setExpanded(new Set(flat.map((category) => category.id)))
  const collapseAll = (): void => setExpanded(new Set())

  const toggleMergeMode = (): void => {
    setMergeMode((current) => {
      if (current) setMergeIds(new Set())
      return !current
    })
  }

  const toggleMergeCategory = (id: string): void => {
    setMergeIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const suggestMerge = async (ids: string[]): Promise<void> => {
    setSuggestingMerge(true)
    try {
      const suggestion = await window.api.categories.suggestMerge(ids)
      setMergeName(suggestion.name)
      setMergeDescription(suggestion.description)
      setMergeKeywords(suggestion.keywords)
      setMergeProvider(suggestion.provider)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSuggestingMerge(false)
    }
  }

  const openMerge = (): void => {
    if (mergeIds.size < 2) {
      toast.warning(t('collections.mergeMin'))
      return
    }
    const ids = [...mergeIds]
    setMergeOpen(true)
    setMergeName('')
    setMergeDescription('')
    setMergeKeywords([])
    setMergeProvider(null)
    void suggestMerge(ids)
  }

  const confirmMerge = async (): Promise<void> => {
    if (!mergeName.trim()) {
      toast.error(t('common.requiredField'))
      return
    }
    setMerging(true)
    try {
      const category = await window.api.categories.merge([...mergeIds], {
        name: mergeName.trim(),
        description: mergeDescription.trim() || null,
        keywords: mergeKeywords
      })
      toast.success(t('collections.mergeDone', { name: category.name }))
      setMergeOpen(false)
      setMergeMode(false)
      setMergeIds(new Set())
      setSelectedId(category.id)
      await loadCategories()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setMerging(false)
    }
  }

  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === 'pending')

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('collections.title')}
        subtitle={t('collections.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void generateSuggestions()} disabled={generating}>
              {generating ? <Spinner size={13} /> : <Lightbulb size={13} />}
              {t('collections.generateSuggestions')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setReclassifyOpen(true)} disabled={reclassifying}>
              <RefreshCw size={13} /> {t('collections.reclassifyAll')}
            </Button>
            <Button size="sm" onClick={() => openCreate(null)}>
              <Plus size={14} /> {t('collections.newCategory')}
            </Button>
          </>
        }
      />

      {activeClassification ? (
        <div className="flex items-center gap-2 border-b border-border/60 bg-primary/[0.04] px-4 py-1.5">
          <Sparkles size={11} className="text-primary" />
          <span className="shrink-0 text-[11px] font-medium text-foreground">{t('operations.classification')}</span>
          <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">{activeClassification.message}</span>
          <Progress value={activeClassification.progress} className="ml-auto h-1 w-[200px] shrink-0" />
          <span className="w-9 text-right text-[10.5px] tabular-nums text-muted-foreground">
            {Math.round(activeClassification.progress * 100)}%
          </span>
        </div>
      ) : null}

      {activeAssistant ? (
        <div className="flex items-center gap-2 border-b border-border/60 bg-primary/[0.035] px-4 py-1.5">
          <Sparkles size={11} className="text-primary" />
          <span className="shrink-0 text-[11px] font-medium text-foreground">{t('operations.assistant')}</span>
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
            {activeAssistant.detail ?? t('operations.processing')}
          </span>
          <Progress indeterminate className="h-1 w-[200px] shrink-0" />
          <span className="w-9 text-right text-[10.5px] text-muted-foreground">{t('common.running')}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[264px] shrink-0 flex-col border-r border-border/70 bg-card/25">
          <PanelHeader
            title={t('collections.taxonomy')}
            actions={
              mergeMode ? (
                <>
                  <span className="text-[10.5px] tabular-nums text-muted-foreground">
                    {t('collections.mergeSelected', { n: mergeIds.size })}
                  </span>
                  <Button size="xs" onClick={() => openMerge()} disabled={mergeIds.size < 2}>
                    <GitMerge size={11} /> {t('collections.mergeConfirm')}
                  </Button>
                  <IconButton label={t('common.cancel')} onClick={toggleMergeMode}>
                    <X size={13} />
                  </IconButton>
                </>
              ) : (
                <>
                  <IconButton label={t('collections.expandAll')} onClick={expandAll}>
                    <ChevronDown size={12} />
                  </IconButton>
                  <IconButton label={t('collections.collapseAll')} onClick={collapseAll}>
                    <ChevronRight size={12} />
                  </IconButton>
                  <IconButton
                    label={t('collections.mergeCategories')}
                    onClick={() => {
                      setMergeMode(true)
                      setMergeIds(new Set())
                    }}
                  >
                    <GitMerge size={12} />
                  </IconButton>
                  <IconButton label={t('collections.addRoot')} onClick={() => openCreate(null)}>
                    <Plus size={13} />
                  </IconButton>
                </>
              )
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {tree.length ? (
              <div className="space-y-0.5">
                {tree.map((category) => (
                  <CategoryTreeItem
                    key={category.id}
                    category={category}
                    depth={0}
                    selectedId={selectedId}
                    expanded={expanded}
                    mergeMode={mergeMode}
                    mergeSelected={mergeIds}
                    onToggleMerge={toggleMergeCategory}
                    onToggle={(id) =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }
                    onSelect={setSelectedId}
                    onAddChild={(id) => openCreate(id)}
                    onContextMenu={(category, event) =>
                      setCategoryMenu({ x: event.clientX, y: event.clientY, category })
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                className="px-3 py-10"
                icon={<FolderTree size={18} />}
                title={t('collections.noCategories')}
                description={t('collections.emptyDesc')}
                action={
                  <Button size="xs" onClick={() => openCreate(null)}>
                    <Plus size={12} /> {t('collections.addRoot')}
                  </Button>
                }
              />
            )}
          </div>
          <div className="border-t border-border/60 p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={!flat.length}
              onClick={() => {
                if (!selectedId && flat.length) setSelectedId(flat[0].id)
                setTab('suggestions')
              }}
            >
              <Lightbulb size={13} />
              {t('collections.aiSuggestions')}
              {pendingSuggestions.length ? (
                <Badge variant="warning" className="ml-auto">
                  {pendingSuggestions.length}
                </Badge>
              ) : null}
            </Button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="shrink-0 border-b border-border/70 px-5 pb-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${selected.color ?? '#0f766e'}1a`, color: selected.color ?? '#0f766e' }}
                      >
                        <Folder size={15} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold">{selected.path ?? selected.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                          <Badge variant={selected.isActive ? 'success' : 'secondary'}>
                            {selected.isActive ? t('common.active') : t('common.inactive')}
                          </Badge>
                          <span>{t('collections.articleCount', { n: selected.articleCount ?? totalArticles })}</span>
                          {selected.priority ? <span>· P{selected.priority}</span> : null}
                        </div>
                      </div>
                    </div>
                    {selected.description ? (
                      <p className="mt-2 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">{selected.description}</p>
                    ) : null}
                    {selected.instructions ? (
                      <div className="mt-2 max-w-3xl rounded-md border border-border/70 bg-muted/25 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground/70">{t('collections.instructions')}: </span>
                        {selected.instructions}
                      </div>
                    ) : null}
                    {selected.keywords.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selected.keywords.map((keyword) => (
                          <Badge key={keyword.id} variant={keyword.kind === 'synonym' ? 'outline' : 'secondary'}>
                            {keyword.kind === 'synonym' ? '≈ ' : ''}
                            {language === 'zh'
                              ? keyword.keywordZh ?? keyword.keyword
                              : keyword.keywordEn ?? keyword.keyword}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="xs" onClick={() => openCreate(selected.id)}>
                      <Plus size={11} /> {t('collections.newSubcategory')}
                    </Button>
                    <IconButton label={t('common.edit')} onClick={() => openEdit(selected)}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={() => setDeleteTarget(selected)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
              </div>

              <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-1.5">
                  <TabsList>
                    <TabsTrigger value="papers">
                      <ListTree size={12} className="mr-1" /> {t('collections.assignedPapers')}
                      <span className="ml-1 text-[9.5px] text-muted-foreground">{totalArticles}</span>
                    </TabsTrigger>
                    <TabsTrigger value="suggestions">
                      <Lightbulb size={12} className="mr-1" /> {t('collections.aiSuggestions')}
                      {pendingSuggestions.length ? (
                        <span className="ml-1 rounded-full bg-amber-500/15 px-1 text-[9px] text-amber-600">
                          {pendingSuggestions.length}
                        </span>
                      ) : null}
                    </TabsTrigger>
                  </TabsList>
                  <Button variant="ghost" size="xs" onClick={() => void reclassifyCategory()}>
                    <RefreshCw size={11} /> {t('collections.reclassifyCategory')}
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <TabsContent value="papers">
                    {loading ? (
                      <div className="flex h-40 items-center justify-center">
                        <Spinner />
                      </div>
                    ) : articles.length ? (
                      <div>
                        {articles.map((article) => (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() => openArticle(article.id)}
                            className="block w-full border-b border-border/50 px-4 py-2.5 text-left transition hover:bg-muted/40"
                          >
                            <LocalizedArticleTitle
                              article={article}
                              showBadge
                              className="line-clamp-1 text-[12.5px] font-medium text-foreground"
                            />
                            <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                              <span className="max-w-[220px] truncate">{article.journalTitle ?? '—'}</span>
                              <span>·</span>
                              <span>{article.year ?? formatDate(article.publicationDate, language)}</span>
                              <span>·</span>
                              <span className="max-w-[260px] truncate">
                                {article.authors.map((author) => author.name).slice(0, 3).join(', ')}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {article.categories
                                .filter((category) => category.categoryId !== selected.id)
                                .slice(0, 4)
                                .map((category) => (
                                  <Badge key={category.categoryId} variant="outline">
                                    <Dot color={category.color} className="h-1.5 w-1.5" />
                                    {category.categoryName}
                                  </Badge>
                                ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={<FolderTree size={20} />}
                        title={t('collections.noAssignedPapers')}
                        description={t('collections.noAssignedPapersDesc')}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="suggestions" className="p-4">
                    {pendingSuggestions.length ? (
                      <div className="space-y-2.5">
                        {pendingSuggestions.map((suggestion) => (
                          <div key={suggestion.id} className="rounded-xl border border-border/80 bg-card p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="warning">{suggestion.type}</Badge>
                                  <span className="text-[12px] font-semibold">{suggestion.title}</span>
                                </div>
                                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{suggestion.rationale}</p>
                                {suggestion.evidence ? (
                                  <p className="mt-1 text-[10.5px] text-muted-foreground/70">{suggestion.evidence}</p>
                                ) : null}
                                {suggestion.payload.keywords?.length ? (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {suggestion.payload.keywords.map((keyword) => (
                                      <Badge key={keyword} variant="outline">
                                        {keyword}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button variant="outline" size="xs" onClick={() => void acceptSuggestion(suggestion.id)}>
                                  <CircleCheck size={11} /> {t('collections.acceptSuggestion')}
                                </Button>
                                <Button variant="ghost" size="xs" onClick={() => void dismissSuggestion(suggestion.id)}>
                                  <X size={11} /> {t('collections.dismissSuggestion')}
                                </Button>
                              </div>
                            </div>
                            {suggestion.type === 'merge' ? (
                              <p className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                                {t('collections.mergeSuggestionNote')}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={<Lightbulb size={20} />}
                        title={t('collections.aiSuggestions')}
                        description={t('collections.noSuggestions')}
                        action={
                          <Button size="sm" onClick={() => void generateSuggestions()} disabled={generating}>
                            {generating ? <Spinner size={13} /> : <Sparkles size={13} />}
                            {t('collections.generateSuggestions')}
                          </Button>
                        }
                      />
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </>
          ) : (
            <EmptyState
              className="m-auto"
              icon={<FolderTree size={24} />}
              title={t('collections.selectCategory')}
              description={t('collections.selectCategoryDesc')}
              action={
                <Button size="sm" onClick={() => openCreate(null)}>
                  <Plus size={13} /> {t('collections.newCategory')}
                </Button>
              }
            />
          )}
        </section>
      </div>

      <ContextMenu
        open={!!categoryMenu}
        x={categoryMenu?.x ?? 0}
        y={categoryMenu?.y ?? 0}
        items={categoryMenu ? categoryContextItems(categoryMenu.category) : []}
        onClose={() => setCategoryMenu(null)}
      />

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editingCategory}
        categories={flat}
        parentPreset={parentPreset}
        onSaved={async (category) => {
          setDialogOpen(false)
          setSelectedId(category.id)
          await loadCategories()
          bumpData()
        }}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('collections.deleteCategory')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('collections.confirmDeleteCategory', { name: deleteTarget?.path ?? deleteTarget?.name ?? '' })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteCategory()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('collections.reclassifyAll')}</AlertDialogTitle>
          <AlertDialogDescription>{t('collections.reclassifyAllConfirm')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void reclassifyAll()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="w-[min(94vw,560px)]">
          <DialogHeader>
            <DialogTitle>{t('collections.mergeTitle')}</DialogTitle>
            <DialogDescription>{t('collections.mergeDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {flat
                .filter((category) => mergeIds.has(category.id))
                .map((category) => (
                  <Badge key={category.id} variant="secondary">
                    <Dot color={category.color} className="h-1.5 w-1.5" />
                    {category.path ?? category.name}
                    <span className="text-muted-foreground/70">{category.articleCount ?? 0}</span>
                  </Badge>
                ))}
            </div>
            <Field
              label={t('collections.mergeName')}
              hint={
                suggestingMerge
                  ? t('collections.mergeSuggesting')
                  : mergeProvider === 'ai'
                    ? t('collections.mergeAiHint')
                    : mergeProvider === 'local'
                      ? t('collections.mergeLocalHint')
                      : undefined
              }
            >
              <div className="flex gap-2">
                <Input value={mergeName} onChange={(event) => setMergeName(event.target.value)} autoFocus />
                <Button
                  variant="outline"
                  onClick={() => void suggestMerge([...mergeIds])}
                  disabled={suggestingMerge}
                >
                  {suggestingMerge ? <Spinner size={12} /> : <Sparkles size={13} />}
                  {t('collections.mergeSuggest')}
                </Button>
              </div>
            </Field>
            <Field label={t('collections.mergeDescription')}>
              <Textarea
                rows={3}
                value={mergeDescription}
                onChange={(event) => setMergeDescription(event.target.value)}
              />
            </Field>
            {mergeKeywords.length ? (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t('collections.mergeKeywords')}</div>
                <div className="flex flex-wrap gap-1">
                  {mergeKeywords.map((keyword) => (
                    <Badge key={keyword} variant="outline">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              {t('collections.mergeNote')}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void confirmMerge()} disabled={merging || !mergeName.trim()}>
              {merging ? <Spinner size={12} /> : <GitMerge size={13} />}
              {t('collections.mergeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CategoryTreeItem({
  category,
  depth,
  selectedId,
  expanded,
  mergeMode,
  mergeSelected,
  onToggleMerge,
  onToggle,
  onSelect,
  onAddChild,
  onContextMenu
}: {
  category: Category
  depth: number
  selectedId: string | null
  expanded: Set<string>
  mergeMode: boolean
  mergeSelected: Set<string>
  onToggleMerge: (id: string) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onAddChild: (id: string) => void
  onContextMenu: (category: Category, event: React.MouseEvent) => void
}) {
  const { t } = useT()
  const hasChildren = Boolean(category.children?.length)
  const isOpen = expanded.has(category.id)
  const active = selectedId === category.id
  const mergeChecked = mergeSelected.has(category.id)
  return (
    <div>
      <div
        onContextMenu={(event) => {
          event.preventDefault()
          onContextMenu(category, event)
        }}
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1.5 text-[12px] transition',
          (mergeMode ? mergeChecked : active)
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-foreground/72 hover:bg-muted/60'
        )}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        <button
          type="button"
          className={cn('flex h-5 w-4 items-center justify-center text-muted-foreground/60', !hasChildren && 'invisible')}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(category.id)
          }}
        >
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {mergeMode ? (
          <Checkbox checked={mergeChecked} onCheckedChange={() => onToggleMerge(category.id)} />
        ) : null}
        <button
          type="button"
          onClick={() => (mergeMode ? onToggleMerge(category.id) : onSelect(category.id))}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-[5px] text-left"
        >
          {mergeMode ? null : (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: category.color ?? 'var(--muted-foreground)' }}
            />
          )}
          <span className="min-w-0 flex-1 truncate">{category.name}</span>
          {category.articleCount ? (
            <span className="text-[10px] tabular-nums text-muted-foreground/70">{category.articleCount}</span>
          ) : null}
        </button>
        {mergeMode ? null : (
          <button
            type="button"
            title={t('collections.newSubcategory')}
            className="hidden text-muted-foreground/50 hover:text-primary group-hover:block"
            onClick={() => onAddChild(category.id)}
          >
            <Plus size={11} />
          </button>
        )}
      </div>
      {hasChildren && isOpen
        ? category.children?.map((child) => (
            <CategoryTreeItem
              key={child.id}
              category={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              mergeMode={mergeMode}
              mergeSelected={mergeSelected}
              onToggleMerge={onToggleMerge}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onContextMenu={onContextMenu}
            />
          ))
        : null}
    </div>
  )
}

function CategoryDialog({
  open,
  onOpenChange,
  category,
  categories,
  parentPreset,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: Category | null
  categories: Category[]
  parentPreset: string | null
  onSaved: (category: Category) => void
}) {
  const { t } = useT()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    parentId: 'none',
    description: '',
    instructions: '',
    color: CATEGORY_COLORS[0],
    priority: '0',
    isActive: true,
    keywordsZh: '',
    keywordsEn: '',
    synonymsZh: '',
    synonymsEn: ''
  })

  useEffect(() => {
    if (!open) return
    if (category) {
      setForm({
        name: category.name,
        parentId: category.parentId ?? 'none',
        description: category.description ?? '',
        instructions: category.instructions ?? '',
        color: category.color ?? CATEGORY_COLORS[0],
        priority: String(category.priority),
        isActive: category.isActive,
        keywordsZh: category.keywords
          .filter((keyword) => keyword.kind === 'keyword')
          .map((keyword) => keyword.keywordZh ?? (isCjk(keyword.keyword) ? keyword.keyword : ''))
          .filter(Boolean)
          .join(', '),
        keywordsEn: category.keywords
          .filter((keyword) => keyword.kind === 'keyword')
          .map((keyword) => keyword.keywordEn ?? (!isCjk(keyword.keyword) ? keyword.keyword : ''))
          .filter(Boolean)
          .join(', '),
        synonymsZh: category.keywords
          .filter((keyword) => keyword.kind === 'synonym')
          .map((keyword) => keyword.keywordZh ?? (isCjk(keyword.keyword) ? keyword.keyword : ''))
          .filter(Boolean)
          .join(', '),
        synonymsEn: category.keywords
          .filter((keyword) => keyword.kind === 'synonym')
          .map((keyword) => keyword.keywordEn ?? (!isCjk(keyword.keyword) ? keyword.keyword : ''))
          .filter(Boolean)
          .join(', ')
      })
    } else {
      setForm({
        name: '',
        parentId: parentPreset ?? 'none',
        description: '',
        instructions: '',
        color: CATEGORY_COLORS[0],
        priority: '0',
        isActive: true,
        keywordsZh: '',
        keywordsEn: '',
        synonymsZh: '',
        synonymsEn: ''
      })
    }
  }, [open, category, parentPreset])

  const update = (key: keyof typeof form, value: string | boolean): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error(t('common.requiredField'))
      return
    }
    setSaving(true)
    try {
      const payload: CategoryInput = {
        name: form.name.trim(),
        parentId: form.parentId === 'none' ? null : form.parentId,
        description: form.description.trim() || null,
        instructions: form.instructions.trim() || null,
        color: form.color,
        priority: Number(form.priority) || 0,
        isActive: form.isActive,
        keywords: [
          ...splitKeywords(form.keywordsZh).map((keyword) => ({
            keyword,
            keywordZh: keyword,
            kind: 'keyword' as const,
            weight: 1
          })),
          ...splitKeywords(form.keywordsEn).map((keyword) => ({
            keyword,
            keywordEn: keyword,
            kind: 'keyword' as const,
            weight: 1
          })),
          ...splitKeywords(form.synonymsZh).map((keyword) => ({
            keyword,
            keywordZh: keyword,
            kind: 'synonym' as const,
            weight: 0.6
          })),
          ...splitKeywords(form.synonymsEn).map((keyword) => ({
            keyword,
            keywordEn: keyword,
            kind: 'synonym' as const,
            weight: 0.6
          }))
        ]
      }
      const saved = category
        ? await window.api.categories.update(category.id, payload)
        : await window.api.categories.create(payload)
      toast.success(t('collections.categorySaved'))
      onSaved(saved)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const excluded = category
    ? new Set([
        category.id,
        ...categories
          .filter((item) => (item.path ?? item.name).startsWith(`${category.path ?? category.name} / `))
          .map((item) => item.id)
      ])
    : new Set<string>()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,680px)]">
        <DialogHeader>
          <DialogTitle>{category ? t('collections.editCategory') : t('collections.newCategory')}</DialogTitle>
          <DialogDescription>{t('collections.emptyDesc')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('collections.categoryName')}>
              <Input value={form.name} onChange={(event) => update('name', event.target.value)} autoFocus />
            </Field>
            <Field label={t('collections.parentCategory')} hint={t('collections.selectParentHint')}>
              <Select value={form.parentId} onValueChange={(value) => update('parentId', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('collections.noParent')}</SelectItem>
                  {categories
                    .filter((item) => !excluded.has(item.id))
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.path ?? item.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t('collections.description')}>
            <Textarea rows={2} value={form.description} onChange={(event) => update('description', event.target.value)} />
          </Field>
          <Field label={t('collections.instructions')} hint={t('collections.instructionsHint')}>
            <Textarea
              rows={3}
              value={form.instructions}
              onChange={(event) => update('instructions', event.target.value)}
              placeholder={t('collections.instructionsPlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('collections.keywordsZh')} hint={t('collections.keywordsHint')}>
              <Textarea
                rows={3}
                value={form.keywordsZh}
                onChange={(event) => update('keywordsZh', event.target.value)}
                placeholder={t('collections.keywordsZhPlaceholder')}
              />
            </Field>
            <Field label={t('collections.keywordsEn')} hint={t('collections.keywordsHint')}>
              <Textarea
                rows={3}
                value={form.keywordsEn}
                onChange={(event) => update('keywordsEn', event.target.value)}
                placeholder={t('collections.keywordsPlaceholder')}
              />
            </Field>
            <Field label={t('collections.synonymsZh')} hint={t('collections.synonymsHint')}>
              <Textarea
                rows={3}
                value={form.synonymsZh}
                onChange={(event) => update('synonymsZh', event.target.value)}
                placeholder={t('collections.synonymsZhPlaceholder')}
              />
            </Field>
            <Field label={t('collections.synonymsEn')} hint={t('collections.synonymsHint')}>
              <Textarea
                rows={3}
                value={form.synonymsEn}
                onChange={(event) => update('synonymsEn', event.target.value)}
                placeholder={t('collections.synonymsPlaceholder')}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 items-end gap-3">
            <Field label={t('collections.color')}>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => update('color', color)}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition',
                      form.color === color ? 'border-foreground/60 scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </Field>
            <Field label={t('collections.priority')}>
              <Input value={form.priority} inputMode="numeric" onChange={(event) => update('priority', event.target.value)} />
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <span className="text-[11.5px]">{t('collections.active')}</span>
              <Switch checked={form.isActive} onCheckedChange={(value) => update('isActive', value)} />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={12} /> : <CheckIcon />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CheckIcon() {
  return <CircleCheck size={13} />
}
