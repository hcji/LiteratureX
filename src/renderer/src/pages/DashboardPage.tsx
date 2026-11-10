import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRight,
  BookOpen,
  Clock,
  FileText,
  FolderTree,
  Inbox,
  Plus,
  RefreshCw,
  Rss,
  Sparkles,
  Star,
  TrendingUp,
  Upload
} from 'lucide-react'
import type { Article, DashboardStats, InterestProfile } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { useArticleDisplay } from '../lib/articleText'
import { cn, errorMessage, formatDate, relativeTime } from '../lib/utils'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/button'
import { Badge, Dot } from '../components/ui/badge'
import { Spinner } from '../components/ui/feedback'
import { EmptyState, SectionTitle } from '../components/ui/layout-bits'
import { CategoryChips, PdfBadge, TranslationBadge } from '../components/ArticleBits'
import { InterestProfileCard } from '../components/InterestProfileCard'

function StatCard({
  label,
  value,
  icon,
  hint,
  onClick,
  tone
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  hint?: string
  onClick?: () => void
  tone?: 'primary' | 'amber' | 'red' | 'blue'
}) {
  const toneClass =
    tone === 'amber'
      ? 'text-amber-600 bg-amber-500/10'
      : tone === 'red'
        ? 'text-red-600 bg-red-500/10'
        : tone === 'blue'
          ? 'text-blue-600 bg-blue-500/10'
          : 'text-primary bg-primary/10'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-xl border border-border/80 bg-card p-3.5 text-left transition',
        onClick && 'hover:border-primary/30 hover:shadow-md'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', toneClass)}>{icon}</span>
      </div>
      <div className="mt-2 text-[24px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="mt-1.5 truncate text-[10px] text-muted-foreground/80">{hint}</div> : null}
    </button>
  )
}

function QuickAction({
  label,
  hint,
  icon,
  onClick,
  disabled
}: {
  label: string
  hint?: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5 text-left transition hover:border-primary/35 hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-foreground">{label}</span>
        {hint ? <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  )
}

function ArticleRow({ article, onClick, showDate }: { article: Article; onClick: () => void; showDate: 'added' | 'published' }) {
  const { language } = useT()
  const display = useArticleDisplay(article)
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 border-b border-border/50 px-1 py-2.5 text-left last:border-0 hover:bg-muted/30"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
        <FileText size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <div className="line-clamp-1 min-w-0 text-[12px] font-medium text-foreground group-hover:text-primary">
            {display.title}
          </div>
          <TranslationBadge translated={display.translatedTitle} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="max-w-[180px] truncate">{article.journalTitle ?? '—'}</span>
          <span className="opacity-40">·</span>
          <span>{showDate === 'published' ? formatDate(article.publicationDate, language) : formatDate(article.createdAt, language)}</span>
          {article.pdfFiles.length ? (
            <>
              <span className="opacity-40">·</span>
              <PdfBadge available />
            </>
          ) : null}
        </div>
        <CategoryChips categories={article.categories} max={2} className="mt-1" />
      </div>
    </button>
  )
}

export function DashboardPage() {
  const { t, language } = useT()
  const dataVersion = useAppStore((state) => state.dataVersion)
  const bumpData = useAppStore((state) => state.bumpData)
  const openArticle = useAppStore((state) => state.openArticle)
  const openLibraryView = useAppStore((state) => state.openLibraryView)
  const openDiscoverView = useAppStore((state) => state.openDiscoverView)
  const setRoute = useAppStore((state) => state.setRoute)
  const settings = useAppStore((state) => state.settings)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [profile, setProfile] = useState<InterestProfile | null>(null)
  const [reviewItems, setReviewItems] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = async (): Promise<void> => {
    try {
      const [dashboard, review, interest] = await Promise.all([
        window.api.dashboard.get(),
        window.api.articles.list({ scope: 'library', needsReviewOnly: true, limit: 5, sort: 'publication_date' }),
        window.api.interest.get()
      ])
      setStats(dashboard)
      setReviewItems(review.items)
      setProfile(interest)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const refreshInterest = async (useAi: boolean): Promise<void> => {
    setProfileLoading(true)
    try {
      const next = await window.api.interest.rebuild({ useAi })
      setProfile(next)
      if (next.warning) toast.warning(next.warning)
      else toast.success(useAi ? t('interest.aiRebuilt') : t('interest.rebuilt'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [dataVersion])

  const syncAll = async (): Promise<void> => {
    setSyncing(true)
    toast.info(t('dashboard.syncStarted'))
    try {
      const outcomes = await window.api.subscriptions.syncAll(false)
      const added = outcomes.reduce((sum, item) => sum + item.added, 0)
      const updated = outcomes.reduce((sum, item) => sum + item.updated, 0)
      toast.success(t('dashboard.syncFinished', { added, updated }))
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  const maxCategory = Math.max(1, ...(stats?.classificationByCategory.map((item) => item.count) ?? [1]))

  const importPdfs = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.api.pdf.importDialog()
      if (result.items.length) {
        if (result.errors) toast.error(t('library.importFailed', { error: `${result.errors} file(s)` }))
        else toast.success(t('library.importDone', { imported: result.imported, duplicates: result.duplicates, errors: result.errors }))
        bumpData()
        const firstId = result.items[0]?.articleId
        if (firstId) openArticle(firstId)
      }
    } catch (error) {
      toast.error(t('library.importFailed', { error: errorMessage(error) }))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void syncAll()} disabled={syncing}>
            {syncing ? <Spinner size={13} /> : <RefreshCw size={13} />}
            {t('dashboard.syncAll')}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading && !stats ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label={t('dashboard.totalPapers')}
                value={stats.totalPapers}
                icon={<BookOpen size={14} />}
                hint={`${stats.pdfCount} PDF`}
                onClick={() => setRoute('library')}
              />
              <StatCard
                label={t('dashboard.newThisWeek')}
                value={stats.newThisWeek}
                icon={<TrendingUp size={14} />}
                tone="blue"
                hint={t('dashboard.hintThisWeek', { n: stats.totalPapers })}
                onClick={() => setRoute('library')}
              />
              <StatCard
                label={t('dashboard.unreadPapers')}
                value={stats.unread}
                icon={<Inbox size={14} />}
                hint={t('dashboard.hintUnread')}
                onClick={() => openDiscoverView('unread')}
              />
              <StatCard
                label={t('dashboard.reviewQueue')}
                value={stats.reviewCount}
                icon={<Sparkles size={14} />}
                tone="amber"
                hint={t('dashboard.hintReview')}
                onClick={() => openLibraryView('review')}
              />
              <StatCard
                label={t('dashboard.subscribedJournals')}
                value={stats.journals}
                icon={<FileText size={14} />}
                hint={t('dashboard.hintJournals')}
                onClick={() => openDiscoverView('all')}
              />
              <StatCard
                label={t('dashboard.activeCategories')}
                value={stats.categories}
                icon={<FolderTree size={14} />}
                hint={t('dashboard.hintCategories')}
                onClick={() => setRoute('collections')}
              />
            </div>

            <InterestProfileCard
              profile={profile}
              loading={profileLoading}
              aiConfigured={Boolean(settings?.ai.apiKeySet && settings.ai.model)}
              onRefresh={(useAi) => void refreshInterest(useAi)}
              onOpenLibrary={() => setRoute('library')}
            />

            {stats.totalPapers === 0 ? (
              <section className="rounded-xl border border-border/80 bg-card p-4">
                <SectionTitle action={<span className="text-[11px] text-muted-foreground">{t('dashboard.quickStartHint')}</span>}>
                  {t('dashboard.quickActions')}
                </SectionTitle>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <QuickAction
                    label={t('dashboard.importPdf')}
                    hint="PDF"
                    icon={importing ? <Spinner size={14} /> : <Upload size={15} />}
                    onClick={() => void importPdfs()}
                    disabled={importing}
                  />
                  <QuickAction
                    label={t('dashboard.addReference')}
                    hint={t('library.addReferenceDesc')}
                    icon={<Plus size={15} />}
                    onClick={() => setRoute('library')}
                  />
                  <QuickAction
                    label={t('dashboard.addJournal')}
                    hint="RSS"
                    icon={<Rss size={15} />}
                    onClick={() => setRoute('discover')}
                  />
                  <QuickAction
                    label={t('settings.aiTitle')}
                    hint={t('dashboard.aiNotConfigured')}
                    icon={<Sparkles size={15} />}
                    onClick={() => setRoute('settings')}
                  />
                </div>
              </section>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="space-y-4 xl:col-span-2">
                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle
                    action={
                      <Button variant="ghost" size="xs" onClick={() => setRoute('library')}>
                        {t('dashboard.viewLibrary')} <ArrowRight size={11} />
                      </Button>
                    }
                  >
                    {t('dashboard.recentAdded')}
                  </SectionTitle>
                  {stats.recentArticles.length ? (
                    <div>
                      {stats.recentArticles.map((article) => (
                        <ArticleRow key={article.id} article={article} onClick={() => openArticle(article.id)} showDate="added" />
                      ))}
                    </div>
                  ) : (
                    <EmptyState className="py-8" icon={<BookOpen size={18} />} title={t('library.noArticles')} />
                  )}
                </section>

                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle
                    action={
                      <Button variant="ghost" size="xs" onClick={() => setRoute('discover')}>
                        {t('nav.discover')} <ArrowRight size={11} />
                      </Button>
                    }
                  >
                    {t('dashboard.recentPublished')}
                  </SectionTitle>
                  {stats.recentPublications.length ? (
                    <div>
                      {stats.recentPublications.map((article) => (
                        <ArticleRow key={article.id} article={article} onClick={() => openArticle(article.id)} showDate="published" />
                      ))}
                    </div>
                  ) : (
                    <EmptyState className="py-8" icon={<FileText size={18} />} title={t('discover.noArticles')} />
                  )}
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle action={stats.pendingJobs ? <Badge variant="outline">{stats.pendingJobs}</Badge> : undefined}>
                    {t('dashboard.classificationDistribution')}
                  </SectionTitle>
                  {stats.classificationByCategory.length ? (
                    <div className="space-y-2.5">
                      {stats.classificationByCategory.map((item) => (
                        <div key={item.categoryId}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Dot color={item.color} />
                              <span className="truncate text-foreground/80">{item.name}</span>
                            </span>
                            <span className="tabular-nums text-muted-foreground">{item.count}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(item.count / maxCategory) * 100}%`,
                                backgroundColor: item.color ?? 'var(--primary)'
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState className="py-6" icon={<Sparkles size={18} />} title={t('dashboard.noClassification')} />
                  )}
                </section>

                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle>{t('dashboard.aiStatus')}</SectionTitle>
                  <div className="space-y-2 text-[11.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('settings.providerMode')}</span>
                      <span className="font-medium">
                        {settings?.ai.apiKeySet && settings.ai.model ? t('settings.aiConfigured') : t('settings.aiNotConfigured')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('settings.model')}</span>
                      <span className="max-w-[180px] truncate font-mono text-[10.5px]">{settings?.ai.model || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('settings.thresholdHigh')}</span>
                      <span className="tabular-nums">{Math.round((settings?.ai.thresholds.high ?? 0) * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('settings.thresholdMedium')}</span>
                      <span className="tabular-nums">{Math.round((settings?.ai.thresholds.medium ?? 0) * 100)}%</span>
                    </div>
                    <Button variant="outline" size="xs" className="mt-1 w-full" onClick={() => setRoute('settings')}>
                      {t('common.settings')}
                    </Button>
                  </div>
                </section>

                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle>{t('dashboard.syncStatus')}</SectionTitle>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Clock size={12} />
                    {stats.lastSyncAt ? t('dashboard.lastSync', { time: relativeTime(stats.lastSyncAt, language, t) }) : t('dashboard.noSync')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(stats.sourceCounts).map(([source, count]) => (
                      <Badge key={source} variant="secondary">
                        {source}: {count}
                      </Badge>
                    ))}
                  </div>
                  {stats.pendingJobs > 0 ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                      <RefreshCw size={11} className="animate-spin text-primary" />
                      {t('dashboard.pendingJobs')}: {stats.pendingJobs}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <SectionTitle
                    action={
                      <Button variant="ghost" size="xs" onClick={() => openLibraryView('review')}>
                        {t('dashboard.reviewNow')} <ArrowRight size={11} />
                      </Button>
                    }
                  >
                    {t('dashboard.reviewQueue')}
                  </SectionTitle>
                  {reviewItems.length ? (
                    <div className="space-y-1">
                      {reviewItems.map((article) => (
                        <button
                          key={article.id}
                          type="button"
                          onClick={() => openArticle(article.id)}
                          className="block w-full rounded-md px-1 py-1.5 text-left transition hover:bg-muted/40"
                        >
                          <div className="line-clamp-1 text-[11.5px] font-medium">{article.title}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>{article.journalTitle}</span>
                            {article.categories.length ? (
                              <Badge variant="warning">{article.categories.length} AI</Badge>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-3 text-[11.5px] text-muted-foreground">
                      <Star size={13} /> {t('common.noData')}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
