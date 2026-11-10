import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Bot,
  Check,
  FileText,
  Library,
  Loader2,
  MessageSquare,
  Plus,
  Quote,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
  X
} from 'lucide-react'
import type { Article, AssistantMessage, AssistantMode, AssistantThread, Category, Citation } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { cn, errorMessage, formatAuthors, relativeTime } from '../lib/utils'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Input, Textarea, Field } from '../components/ui/input'
import { Badge, Dot } from '../components/ui/badge'
import { IconButton } from '../components/ui/tooltip'
import { Spinner, Progress } from '../components/ui/feedback'
import { EmptyState } from '../components/ui/layout-bits'
import { Switch, Checkbox } from '../components/ui/primitives'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
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

const modes: Array<{ value: AssistantMode; labelKey: Parameters<ReturnType<typeof useT>['t']>[0]; icon: typeof Sparkles }> = [
  { value: 'chat', labelKey: 'assistant.modeChat', icon: MessageSquare },
  { value: 'summarize', labelKey: 'assistant.modeSummarize', icon: FileText },
  { value: 'compare', labelKey: 'assistant.modeCompare', icon: Library },
  { value: 'trends', labelKey: 'assistant.modeTrends', icon: Sparkles },
  { value: 'related', labelKey: 'assistant.modeRelated', icon: Quote }
]

export function AssistantPage() {
  const { t, language } = useT()
  const dataVersion = useAppStore((state) => state.dataVersion)
  const assistantVersion = useAppStore((state) => state.assistantVersion)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const openArticle = useAppStore((state) => state.openArticle)
  const [threads, setThreads] = useState<AssistantThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [mode, setMode] = useState<AssistantMode>('chat')
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [offline, setOffline] = useState(false)
  const [contextArticles, setContextArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [contextCategoryId, setContextCategoryId] = useState('none')
  const [contextOpen, setContextOpen] = useState(false)
  const [contextQuery, setContextQuery] = useState('')
  const [contextResults, setContextResults] = useState<Article[]>([])
  const [contextSelected, setContextSelected] = useState<Set<string>>(new Set())
  const [contextSearching, setContextSearching] = useState(false)
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<AssistantThread | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const loadThreads = useCallback(async () => {
    try {
      const list = await window.api.assistant.threads()
      setThreads(list)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads, assistantVersion])

  useEffect(() => {
    void window.api.categories
      .flat()
      .then(setCategories)
      .catch(() => undefined)
  }, [dataVersion])

  useEffect(() => {
    if (!activeThreadId) return
    void window.api.assistant
      .threadMessages(activeThreadId)
      .then((list) => {
        setMessages(list)
        const lastAssistant = [...list].reverse().find((message) => message.role === 'assistant')
        setOffline(Boolean(lastAssistant?.content.startsWith('> 当前未配置') || lastAssistant?.content.startsWith('> No AI')))
      })
      .catch((error) => toast.error(errorMessage(error)))
  }, [activeThreadId, assistantVersion])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, sending])

  const openThread = async (thread: AssistantThread): Promise<void> => {
    setActiveThreadId(thread.id)
    setMode('chat')
    try {
      const list = await window.api.assistant.threadMessages(thread.id)
      setMessages(list)
      const lastAssistant = [...list].reverse().find((message) => message.role === 'assistant')
      setOffline(Boolean(lastAssistant?.content.startsWith('> 当前未配置') || lastAssistant?.content.startsWith('> No AI')))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const send = async (overrideMode?: AssistantMode): Promise<void> => {
    const requestMode = overrideMode ?? mode
    const text = question.trim()
    if (requestMode === 'chat' && !text) {
      toast.warning(t('assistant.questionRequired'))
      return
    }
    if ((requestMode === 'summarize' || requestMode === 'compare') && !contextArticles.length && contextCategoryId === 'none') {
      toast.warning(t('assistant.selectPapersFirst'))
      return
    }
    setSending(true)
    setMode(requestMode)
    try {
      const response = await window.api.assistant.ask({
        threadId: activeThreadId,
        mode: requestMode,
        question: text || undefined,
        articleIds: contextArticles.map((article) => article.id),
        categoryId: contextCategoryId === 'none' ? null : contextCategoryId,
        language
      })
      setActiveThreadId(response.thread.id)
      setMessages(response.messages)
      setOffline(response.offline)
      setQuestion('')
      await loadThreads()
    } catch (error) {
      toast.error(t('assistant.failed', { error: errorMessage(error) }))
    } finally {
      setSending(false)
    }
  }

  const newChat = (): void => {
    setActiveThreadId(null)
    setMessages([])
    setQuestion('')
    setOffline(false)
    setMode('chat')
  }

  const deleteThread = async (): Promise<void> => {
    if (!deleteThreadTarget) return
    try {
      await window.api.assistant.deleteThread(deleteThreadTarget.id)
      if (activeThreadId === deleteThreadTarget.id) newChat()
      setDeleteThreadTarget(null)
      await loadThreads()
      toast.success(t('assistant.threadDeleted'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openContext = async (): Promise<void> => {
    setContextOpen(true)
    setContextSelected(new Set())
    setContextQuery('')
    await searchContext('')
  }

  const searchContext = async (query: string): Promise<void> => {
    setContextSearching(true)
    try {
      const result = await window.api.articles.list({
        scope: 'library',
        search: query.trim() || undefined,
        limit: 30,
        sort: 'created_at'
      })
      setContextResults(result.items)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setContextSearching(false)
    }
  }

  const addContext = (): void => {
    const additions = contextResults.filter((article) => contextSelected.has(article.id))
    setContextArticles((current) => {
      const map = new Map(current.map((article) => [article.id, article]))
      for (const article of additions) map.set(article.id, article)
      return [...map.values()]
    })
    setContextOpen(false)
  }

  const removeContext = (id: string): void => {
    setContextArticles((current) => current.filter((article) => article.id !== id))
  }

  const citationsFor = (message: AssistantMessage): Citation[] => message.citations ?? []

  const canSend = !sending
  const contextCount = contextArticles.length

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('assistant.title')}
        subtitle={t('assistant.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={openContext}>
              <Plus size={13} /> {t('assistant.addPapers')}
            </Button>
            <Button size="sm" onClick={newChat}>
              <Plus size={14} /> {t('assistant.newChat')}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[214px] shrink-0 flex-col border-r border-border/70 bg-card/25">
          <div className="flex h-11 items-center justify-between border-b border-border/60 px-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('assistant.threads')}
            </span>
            <IconButton label={t('assistant.newChat')} onClick={newChat}>
              <Plus size={13} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {threads.length ? (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1.5 text-[11.5px] transition',
                    activeThreadId === thread.id ? 'bg-accent text-accent-foreground' : 'text-foreground/72 hover:bg-muted/60'
                  )}
                >
                  <button type="button" onClick={() => void openThread(thread)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <MessageSquare size={12} className="shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  </button>
                  <button
                    type="button"
                    className="hidden text-muted-foreground/50 hover:text-destructive group-hover:block"
                    onClick={() => setDeleteThreadTarget(thread)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            ) : (
              <div className="px-2 py-6 text-center text-[10.5px] text-muted-foreground">{t('assistant.noThreads')}</div>
            )}
          </div>
          <div className="border-t border-border/60 px-3 py-2 text-[10.5px] text-muted-foreground/60">
            {settings?.ai.apiKeySet && settings.ai.model ? t('settings.aiConfigured') : t('settings.aiNotConfigured')}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-4">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold">
                {threads.find((thread) => thread.id === activeThreadId)?.title ?? t('assistant.emptyTitle')}
              </span>
              {offline ? <Badge variant="warning">{t('assistant.offlineBadge')}</Badge> : null}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Dot color={settings?.ai.apiKeySet && settings.ai.model ? '#10b981' : '#f59e0b'} />
              {contextCount ? t('assistant.selectedCount', { n: contextCount }) : t('assistant.noPaperSelected')}
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {messages.length ? (
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={cn('flex gap-2.5', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {message.role === 'assistant' ? (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Bot size={14} />
                      </div>
                    ) : null}
                    <div className={cn('min-w-0', message.role === 'user' ? 'max-w-[80%]' : 'max-w-[calc(100%-40px)] flex-1')}>
                      {message.role === 'user' ? (
                        <div className="rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-[12.5px] leading-relaxed text-primary-foreground">
                          {message.content}
                        </div>
                      ) : (
                        <div className="rounded-2xl rounded-tl-md border border-border/80 bg-card px-4 py-3">
                          <div className="md-prose">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                          </div>
                          {citationsFor(message).length ? (
                            <div className="mt-3 border-t border-border/60 pt-2">
                              <div className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <Quote size={10} /> {t('assistant.citations')}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {citationsFor(message).map((citation) => (
                                  <button
                                    key={`${citation.index}-${citation.articleId}`}
                                    type="button"
                                    onClick={() => openArticle(citation.articleId)}
                                    className="inline-flex max-w-[320px] items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-foreground/80 transition hover:border-primary/40 hover:text-primary"
                                    title={citation.title}
                                  >
                                    <span className="font-mono text-primary">[{citation.index}]</span>
                                    <span className="truncate">{citation.title}</span>
                                    {citation.page ? <span className="shrink-0 text-muted-foreground">p.{citation.page}</span> : null}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                      <div className="mt-1 px-1 text-[10px] text-muted-foreground/60">
                        {relativeTime(message.createdAt, language, t)}
                      </div>
                    </div>
                    {message.role === 'user' ? (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <User size={13} />
                      </div>
                    ) : null}
                  </div>
                ))}
                {sending ? (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Bot size={14} />
                    </div>
                    <div className="flex flex-col gap-2 rounded-2xl rounded-tl-md border border-border/80 bg-card px-3.5 py-2 text-[11.5px] text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Loader2 size={13} className="animate-spin" /> {t('assistant.generating')}
                      </span>
                      <Progress indeterminate className="h-1 w-40" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400/20 to-emerald-500/10 text-primary ring-1 ring-primary/15">
                  <Sparkles size={24} />
                </div>
                <h2 className="text-[16px] font-semibold">{t('assistant.emptyTitle')}</h2>
                <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">{t('assistant.emptyDesc')}</p>
                {!settings?.ai.apiKeySet ? (
                  <div className="mt-3 max-w-md rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                    {t('assistant.offlineHint')}
                  </div>
                ) : null}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {modes
                    .filter((item) => item.value !== 'chat')
                    .map((item) => {
                      const Icon = item.icon
                      return (
                        <Button
                          key={item.value}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMode(item.value)
                            void send(item.value)
                          }}
                        >
                          <Icon size={13} /> {t(item.labelKey)}
                        </Button>
                      )
                    })}
                </div>
                <Button variant="ghost" size="sm" className="mt-2" onClick={openContext}>
                  <Plus size={13} /> {t('assistant.addPapers')}
                </Button>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border/70 bg-card/25 px-4 py-3">
            <div className="mx-auto max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {modes.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setMode(item.value)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition',
                        mode === item.value
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      <Icon size={10} /> {t(item.labelKey)}
                    </button>
                  )
                })}
                <span className="ml-auto text-[10.5px] text-muted-foreground">
                  {t(
                    mode === 'summarize'
                      ? 'assistant.modeHintSummarize'
                      : mode === 'compare'
                        ? 'assistant.modeHintCompare'
                        : mode === 'trends'
                          ? 'assistant.modeHintTrends'
                          : mode === 'related'
                            ? 'assistant.modeHintRelated'
                            : 'assistant.modeHintChat'
                  )}
                </span>
              </div>
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      if (canSend) void send()
                    }
                  }}
                  placeholder={t('assistant.askPlaceholder')}
                  className="min-h-[44px] resize-none text-[12px]"
                />
                <Button
                  size="icon"
                  aria-label={t('assistant.send')}
                  onClick={() => void send()}
                  disabled={!canSend || sending}
                  className="h-9 w-9 shrink-0"
                >
                  {sending ? <Spinner size={14} /> : <Send size={15} />}
                </Button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span>{contextCount ? t('assistant.selectedCount', { n: contextCount }) : t('assistant.contextHelp')}</span>
                {settings?.assistant.sendFullText ? (
                  <Badge variant="outline" className="text-[9px]">
                    full text
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex w-[276px] shrink-0 flex-col border-l border-border/70 bg-card/25">
          <div className="flex h-11 items-center justify-between border-b border-border/60 px-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('assistant.context')}
            </span>
            <Button variant="ghost" size="xs" onClick={openContext}>
              <Plus size={11} /> {t('assistant.addPapers')}
            </Button>
          </div>
          <div className="border-b border-border/60 p-2.5">
            <Field label={t('assistant.contextCategory')} hint={t('assistant.categoryContextHint')}>
              <Select value={contextCategoryId} onValueChange={setContextCategoryId}>
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('assistant.noCategoryContext')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.path ?? category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {contextArticles.length ? (
              <div className="space-y-1">
                {contextArticles.map((article) => (
                  <div key={article.id} className="group rounded-md border border-border/70 bg-card p-2">
                    <div className="flex items-start gap-1.5">
                      <FileText size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => openArticle(article.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="line-clamp-2 text-[11px] font-medium leading-snug text-foreground hover:text-primary">
                          {article.title}
                        </div>
                        <div className="mt-0.5 truncate text-[9.5px] text-muted-foreground">
                          {[article.journalTitle, article.year].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground/40 hover:text-destructive"
                        onClick={() => removeContext(article.id)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {article.categories.slice(0, 2).map((category) => (
                        <span key={category.categoryId} className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                          <Dot color={category.color} className="h-1 w-1" />
                          {category.categoryName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-2 py-8 text-center">
                <div className="text-[10.5px] text-muted-foreground">{t('assistant.noContext')}</div>
                <p className="mt-1 text-[9.5px] leading-relaxed text-muted-foreground/70">{t('assistant.noContextHint')}</p>
              </div>
            )}
          </div>
          <div className="space-y-2 border-t border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{t('assistant.fullTextToggle')}</span>
              <Switch
                checked={settings?.assistant.sendFullText ?? false}
                onCheckedChange={(value) => void updateSettings({ assistant: { sendFullText: value } })}
              />
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground/60">{t('assistant.fullTextHint')}</p>
          </div>
        </aside>
      </div>

      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="w-[min(92vw,620px)]">
          <DialogHeader>
            <DialogTitle>{t('assistant.addPapers')}</DialogTitle>
            <DialogDescription>{t('assistant.searchPapers')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex gap-2">
              <Input
                autoFocus
                value={contextQuery}
                onChange={(event) => setContextQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void searchContext(contextQuery)
                }}
                placeholder={t('assistant.searchPapers')}
              />
              <Button variant="outline" onClick={() => void searchContext(contextQuery)} disabled={contextSearching}>
                {contextSearching ? <Spinner size={13} /> : <Search size={13} />}
              </Button>
            </div>
            <div className="max-h-[340px] space-y-1 overflow-y-auto">
              {contextResults.map((article) => {
                const already = contextArticles.some((item) => item.id === article.id)
                const selected = contextSelected.has(article.id)
                return (
                  <button
                    key={article.id}
                    type="button"
                    disabled={already}
                    onClick={() =>
                      setContextSelected((current) => {
                        const next = new Set(current)
                        if (next.has(article.id)) next.delete(article.id)
                        else next.add(article.id)
                        return next
                      })
                    }
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition',
                      already
                        ? 'cursor-not-allowed border-border/50 bg-muted/20 opacity-60'
                        : selected
                          ? 'border-primary/50 bg-primary/[0.04]'
                          : 'border-border/60 bg-card hover:border-primary/30'
                    )}
                  >
                    <span className="mt-0.5">
                      {already ? <Check size={12} className="text-primary" /> : <Checkbox checked={selected} className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-[11.5px] font-medium">{article.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
                        <span className="max-w-[220px] truncate">{article.journalTitle ?? '—'}</span>
                        <span>·</span>
                        <span>{article.year ?? ''}</span>
                        <span>·</span>
                        <span className="truncate">{formatAuthors(article.authors, 2)}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
              {!contextResults.length && !contextSearching ? (
                <div className="py-8 text-center text-[11px] text-muted-foreground">{t('common.noData')}</div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setContextOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={addContext} disabled={!contextSelected.size}>
              {t('assistant.addPapers')} ({contextSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteThreadTarget)} onOpenChange={(open) => !open && setDeleteThreadTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('assistant.deleteThread')}</AlertDialogTitle>
          <AlertDialogDescription>{t('assistant.deleteThreadConfirm')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteThread()}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
