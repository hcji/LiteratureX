import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, BookOpen, Gauge, WandSparkles } from 'lucide-react'
import type { InterestMatchReport } from '@shared/types'
import { useT } from '../i18n'
import { useAppStore } from '../store/appStore'
import { cn, errorMessage, percent } from '../lib/utils'
import { Badge, Dot } from './ui/badge'
import { Button } from './ui/button'
import { Spinner } from './ui/feedback'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

function ScoreRing({ value, band, label }: { value: number; band: InterestMatchReport['band']; label: string }) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const color = band === 'high' ? '#059669' : band === 'medium' ? '#d97706' : '#64748b'
  return (
    <div className="relative h-[104px] w-[104px] shrink-0">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="currentColor" strokeWidth="7" className="text-muted/70" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${circumference * value} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-semibold leading-none tabular-nums">{Math.round(value * 100)}%</span>
        <span className="mt-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

function MetricBar({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'emerald' }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{percent(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', tone === 'emerald' ? 'bg-emerald-500' : 'bg-primary/75')}
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      </div>
    </div>
  )
}

export function MatchEvaluationDialog({
  open,
  onOpenChange,
  articleId
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  articleId: string | null
}) {
  const { t } = useT()
  const openArticle = useAppStore((state) => state.openArticle)
  const aiConfigured = useAppStore((state) => Boolean(state.settings?.ai.apiKeySet && state.settings.ai.model))
  const [report, setReport] = useState<InterestMatchReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [deepLoading, setDeepLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (deep: boolean) => {
      if (!articleId) return
      if (deep) setDeepLoading(true)
      else {
        setLoading(true)
        setReport(null)
        setError(null)
      }
      try {
        const next = await window.api.interest.evaluate(articleId, deep)
        setReport(next)
        setError(null)
        if (next.warning) toast.warning(next.warning)
      } catch (caught) {
        const message = errorMessage(caught)
        setError(message)
        toast.error(message)
      } finally {
        setLoading(false)
        setDeepLoading(false)
      }
    },
    [articleId]
  )

  useEffect(() => {
    if (!open || !articleId) return
    void load(false)
  }, [open, articleId, load])

  const bandLabel =
    report?.band === 'high'
      ? t('interest.bandHigh')
      : report?.band === 'medium'
        ? t('interest.bandMedium')
        : t('interest.bandLow')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge size={15} className="text-primary" />
            {t('interest.reportTitle')}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{report?.title ?? t('interest.reportLoading')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[68vh] space-y-4 overflow-y-auto">
          {loading && !report ? (
            <div className="flex h-48 items-center justify-center">
              <Spinner />
            </div>
          ) : error && !report ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-[11.5px] text-destructive">
              {error}
              <div className="mt-2">
                <Button variant="outline" size="xs" onClick={() => void load(false)}>
                  {t('common.retry')}
                </Button>
              </div>
            </div>
          ) : report ? (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-muted/15 p-3">
                <ScoreRing value={report.overall} band={report.band} label={t('interest.matchLabel')} />
                <div className="min-w-[180px] flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={report.band === 'high' ? 'success' : report.band === 'medium' ? 'warning' : 'secondary'}>
                      {bandLabel}
                    </Badge>
                    <Badge variant={report.provider === 'ai' ? 'accent' : 'secondary'}>
                      {report.provider === 'ai' ? t('interest.reportProviderAi') : t('interest.reportProviderLocal')}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {t('interest.comparedWith', { n: report.comparedWith })}
                    </span>
                  </div>
                  <MetricBar label={t('interest.profileMatch')} value={report.profileScore} tone="primary" />
                  <MetricBar label={t('interest.librarySimilarity')} value={report.libraryScore} tone="emerald" />
                </div>
              </div>

              {report.warning ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                  {report.warning}
                </div>
              ) : null}

              <p className="text-[12px] leading-relaxed text-foreground/85">{report.summary}</p>

              {report.highlights.length ? (
                <ul className="space-y-1">
                  {report.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {(report.matchedCategories.length > 0 || report.sharedKeywords.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('interest.matchedCategories')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {report.matchedCategories.length ? (
                        report.matchedCategories.map((category) => (
                          <span
                            key={category.categoryId}
                            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 text-[10.5px]"
                            title={`${t('common.confidence')} ${percent(category.confidence)}`}
                          >
                            <Dot color={category.color} className="h-1.5 w-1.5" />
                            {category.name}
                            <span className="tabular-nums text-muted-foreground">{percent(category.confidence)}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[10.5px] text-muted-foreground">{t('interest.noCategories')}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('interest.sharedKeywords')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {report.sharedKeywords.length ? (
                        report.sharedKeywords.map((keyword) => (
                          <Badge key={keyword} variant="outline" className="text-[9.5px]">
                            {keyword}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[10.5px] text-muted-foreground">{t('common.noData')}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('interest.similarLibrary')}
                  </span>
                  <span className="text-[9.5px] text-muted-foreground/70">{t('interest.similarHint')}</span>
                </div>
                {report.similarArticles.length ? (
                  <div className="space-y-1.5">
                    {report.similarArticles.map((item) => (
                      <button
                        key={item.articleId}
                        type="button"
                        onClick={() => {
                          onOpenChange(false)
                          openArticle(item.articleId)
                        }}
                        className="group flex w-full items-start gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2 text-left transition hover:border-primary/30 hover:bg-accent/30"
                      >
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                          <BookOpen size={13} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-[11.5px] font-medium text-foreground group-hover:text-primary">
                            {item.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
                            {item.journalTitle ? <span className="max-w-[160px] truncate">{item.journalTitle}</span> : null}
                            {item.year ? <span>· {item.year}</span> : null}
                            {item.sharedCategories.slice(0, 2).map((category) => (
                              <Badge key={category} variant="secondary" className="text-[9px]">
                                {category}
                              </Badge>
                            ))}
                            {item.sharedKeywords.slice(0, 2).map((keyword) => (
                              <span key={keyword} className="rounded bg-muted px-1 text-[9px]">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[12px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                            {percent(item.score)}
                          </div>
                          <ArrowRight size={11} className="ml-auto mt-1 text-muted-foreground/50" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
                    {t('interest.noSimilar')}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-between">
          <span className="text-[10px] text-muted-foreground">
            {report?.provider === 'ai' ? t('interest.aiNote') : t('interest.localNote')}
          </span>
          <div className="flex items-center gap-2">
            {aiConfigured ? (
              <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={deepLoading || loading || !report}>
                {deepLoading ? <Spinner size={12} /> : <WandSparkles size={12} />}
                {t('interest.aiDeep')}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
