import { ArrowRight, BookOpen, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import type { InterestProfile } from '@shared/types'
import { useT } from '../i18n'
import { cn, relativeTime } from '../lib/utils'
import { Badge, Dot } from './ui/badge'
import { Button } from './ui/button'
import { Spinner } from './ui/feedback'
import { EmptyState, SectionTitle } from './ui/layout-bits'
import { InterestRadar } from './InterestRadar'

export function InterestProfileCard({
  profile,
  loading,
  aiConfigured,
  onRefresh,
  onOpenLibrary
}: {
  profile: InterestProfile | null
  loading: boolean
  aiConfigured: boolean
  onRefresh: (useAi: boolean) => void
  onOpenLibrary: () => void
}) {
  const { t, language } = useT()
  const busy = loading
  const themes = profile?.themes ?? []

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4">
      <SectionTitle
        action={
          <div className="flex items-center gap-1.5">
            {profile?.status === 'ready' ? (
              <Badge variant={profile.provider === 'ai' ? 'accent' : 'secondary'}>
                {profile.provider === 'ai' ? t('interest.providerAi') : t('interest.providerLocal')}
              </Badge>
            ) : null}
            <Button variant="ghost" size="xs" onClick={() => onRefresh(false)} disabled={busy} title={t('interest.rebuildHint')}>
              {busy ? <Spinner size={11} /> : <RefreshCw size={11} />}
              {t('interest.rebuild')}
            </Button>
            {aiConfigured ? (
              <Button variant="outline" size="xs" onClick={() => onRefresh(true)} disabled={busy} title={t('interest.aiRebuildHint')}>
                <WandSparkles size={11} />
                {t('interest.aiRebuild')}
              </Button>
            ) : null}
          </div>
        }
      >
        <span className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-primary" />
          {t('interest.title')}
        </span>
      </SectionTitle>

      {!profile || profile.status === 'empty' ? (
        <EmptyState
          className="py-8"
          icon={<BookOpen size={20} />}
          title={t('interest.emptyTitle')}
          description={t('interest.emptyDesc')}
          action={
            <Button variant="outline" size="sm" onClick={onOpenLibrary}>
              {t('interest.openLibrary')} <ArrowRight size={12} />
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
            <span>
              {t('interest.basedOn', {
                n: profile.analyzedArticles,
                total: profile.articleCount
              })}
            </span>
            {profile.updatedAt ? (
              <>
                <span className="opacity-40">·</span>
                <span>{t('interest.updated', { time: relativeTime(profile.updatedAt, language, t) })}</span>
              </>
            ) : null}
          </div>

          {profile.warning ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
              {profile.warning}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_296px]">
            <div className="min-w-0 space-y-3">
              <p className="text-[12.5px] leading-relaxed text-foreground/85">{profile.summary}</p>
              {profile.highlights.length ? (
                <ul className="space-y-1">
                  {profile.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                      <span className="min-w-0">{highlight}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {profile.keywords.length ? (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('interest.keyConcepts')}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {profile.keywords.slice(0, 14).map((keyword) => (
                      <span
                        key={keyword.term}
                        className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10.5px] text-foreground/80"
                      >
                        {keyword.term}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {profile.categories.length ? (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('interest.categoryAffinity')}
                  </div>
                  <div className="space-y-1.5">
                    {profile.categories.slice(0, 5).map((category) => (
                      <div key={category.categoryId} className="flex items-center gap-2 text-[10.5px]">
                        <Dot color={category.color} className="h-1.5 w-1.5" />
                        <span className="w-[130px] truncate text-foreground/80" title={category.name}>
                          {category.name}
                        </span>
                        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, category.weight * 100)}%`,
                              backgroundColor: category.color ?? 'var(--primary)'
                            }}
                          />
                        </div>
                        <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{category.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('interest.radarTitle')}
                </span>
                <span className="text-[9.5px] text-muted-foreground/70">{t('interest.radarHint')}</span>
              </div>
              <InterestRadar themes={themes} size={252} className="mx-auto" />
              <div className="mt-1 space-y-1">
                {themes.slice(0, 4).map((theme) => (
                  <div key={theme.id} className="flex items-center gap-1.5 text-[10.5px]">
                    <span
                      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !theme.color && 'bg-primary/70')}
                      style={theme.color ? { backgroundColor: theme.color } : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground/80">{theme.label}</span>
                    {theme.articleCount ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">{theme.articleCount}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
