import type { Article, Subscription, SyncOutcome } from '@shared/types'
import { parseDateLoose, yearFromDate } from '@shared/normalize'
import type { ArticleRepo } from '../db/repositories/articles'
import type { SubscriptionRepo } from '../db/repositories/subscriptions'
import type { DiscoveryService, ParsedFeed } from './discovery'
import { crossrefIssnFromFeedUrl } from './discovery'
import type { HttpService } from './http'
import type { SettingsService } from './settings'

interface SyncEvents {
  emit: (type: 'sync:progress', payload: unknown) => void
  onNewArticles?: (articleIds: string[]) => void
}

export interface SyncOptions {
  force?: boolean
  limit?: number
}

export class RssSyncService {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private activeSyncs = new Set<string>()

  constructor(
    private readonly http: HttpService,
    private readonly discovery: DiscoveryService,
    private readonly articles: ArticleRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly settings: SettingsService,
    private readonly events: SyncEvents
  ) {}

  async syncSubscription(subscription: Subscription, options: SyncOptions = {}): Promise<SyncOutcome> {
    const started = Date.now()
    const feed = subscription.feed
    const label = subscription.journal?.title || subscription.name || feed?.title || subscription.feedId
    if (!feed) {
      return {
        subscriptionId: subscription.id,
        feedTitle: label,
        status: 'error',
        found: 0,
        added: 0,
        updated: 0,
        error: 'Feed record is missing',
        durationMs: Date.now() - started
      }
    }
    if (this.activeSyncs.has(subscription.id)) {
      return {
        subscriptionId: subscription.id,
        feedTitle: label,
        status: 'error',
        found: 0,
        added: 0,
        updated: 0,
        error: 'This subscription is already synchronizing',
        durationMs: Date.now() - started
      }
    }
    this.activeSyncs.add(subscription.id)
    const historyId = this.subscriptions.startSyncHistory(subscription.id, feed.id)
    this.events.emit('sync:progress', { subscriptionId: subscription.id, feedTitle: label, phase: 'start' })
    try {
      const settings = this.settings.get()
      const crossrefIssn = crossrefIssnFromFeedUrl(feed.url)
      let parsed: ParsedFeed
      if (crossrefIssn) {
        this.events.emit('sync:progress', { subscriptionId: subscription.id, feedTitle: label, phase: 'parse' })
        parsed = await this.discovery.fetchCrossrefFeed(crossrefIssn, settings.rss.itemsPerSync)
        if (!parsed.items.length) throw new Error('Crossref returned no articles for this journal')
        this.subscriptions.updateFeedState(feed.id, {
          lastStatus: 'ok',
          lastError: null,
          lastItemCount: parsed.items.length,
          fetchedAt: new Date().toISOString()
        })
      } else {
        const headers: Record<string, string> = {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        }
        if (!options.force) {
          if (feed.etag) headers['If-None-Match'] = feed.etag
          if (feed.lastModified) headers['If-Modified-Since'] = feed.lastModified
        }
        const response = await this.http.request(feed.url, { headers, timeoutMs: 30000, retries: 2 })
        if (response.status === 304) {
          this.subscriptions.updateFeedState(feed.id, {
            lastStatus: 'not_modified',
            lastError: null,
            fetchedAt: new Date().toISOString()
          })
          this.subscriptions.setLastSync(subscription.id)
          this.subscriptions.finishSyncHistory(historyId, {
            status: 'not_modified',
            itemsFound: 0,
            itemsNew: 0,
            itemsUpdated: 0
          })
          this.events.emit('sync:progress', { subscriptionId: subscription.id, feedTitle: label, phase: 'done', added: 0, updated: 0 })
          return {
            subscriptionId: subscription.id,
            feedTitle: label,
            status: 'not_modified',
            found: 0,
            added: 0,
            updated: 0,
            durationMs: Date.now() - started
          }
        }
        if (!response.ok) throw new Error(`Feed request failed with HTTP ${response.status}`)
        const text = await response.text()
        this.events.emit('sync:progress', { subscriptionId: subscription.id, feedTitle: label, phase: 'parse' })
        parsed = (await this.discovery.parseFeed(text)) as ParsedFeed
        this.subscriptions.updateFeedState(feed.id, {
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          lastStatus: 'ok',
          lastError: null,
          lastItemCount: parsed.items.length,
          fetchedAt: new Date().toISOString()
        })
      }
      const feedTitle = parsed.title || feed.title || label

      const limit = Math.min(options.limit ?? settings.rss.itemsPerSync, 300)
      const items = parsed.items.slice(0, limit)
      let added = 0
      let updated = 0
      const newIds: string[] = []

      for (const item of items) {
        const metadata = this.discovery.mapItemMetadata(item, parsed, subscription.journal?.title)
        if (!metadata.title || metadata.title === 'Untitled') continue
        const existing = this.articles.findDuplicate({
          title: metadata.title,
          doi: metadata.doi,
          journalTitle: metadata.journalTitle,
          year: metadata.year
        })
        if (existing) {
          const changed = this.articles.mergeMissing(
            existing.id,
            {
              title: metadata.title,
              doi: metadata.doi,
              journalTitle: metadata.journalTitle,
              journalId: subscription.journalId,
              abstract: metadata.abstract,
              url: metadata.url,
              publicationDate: metadata.publicationDate,
              year: metadata.year,
              articleType: metadata.articleType,
              keywords: metadata.keywords,
              authors: metadata.authors,
              source: 'rss'
            },
            { inLibrary: false, subscriptionId: subscription.id }
          )
          if (changed) updated += 1
          continue
        }
        const article = this.articles.create({
          title: metadata.title,
          doi: metadata.doi,
          journalId: subscription.journalId,
          journalTitle: metadata.journalTitle,
          publicationDate: metadata.publicationDate,
          year: metadata.year,
          abstract: metadata.abstract,
          url: metadata.url,
          articleType: metadata.articleType,
          keywords: metadata.keywords,
          authors: metadata.authors,
          source: 'rss',
          inLibrary: false,
          subscriptionId: subscription.id,
          needsReview: !metadata.doi && !metadata.publicationDate
        })
        newIds.push(article.id)
        added += 1
      }

      this.subscriptions.setLastSync(subscription.id)
      this.subscriptions.finishSyncHistory(historyId, {
        status: 'success',
        itemsFound: items.length,
        itemsNew: added,
        itemsUpdated: updated
      })
      if (newIds.length && this.events.onNewArticles) this.events.onNewArticles(newIds)
      this.events.emit('sync:progress', {
        subscriptionId: subscription.id,
        feedTitle,
        phase: 'done',
        found: items.length,
        added,
        updated
      })
      return {
        subscriptionId: subscription.id,
        feedTitle,
        status: 'success',
        found: items.length,
        added,
        updated,
        durationMs: Date.now() - started
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.subscriptions.updateFeedState(feed.id, { lastStatus: 'error', lastError: message })
      this.subscriptions.setLastSync(subscription.id)
      this.subscriptions.finishSyncHistory(historyId, {
        status: 'error',
        itemsFound: 0,
        itemsNew: 0,
        itemsUpdated: 0,
        error: message
      })
      this.events.emit('sync:progress', {
        subscriptionId: subscription.id,
        feedTitle: label,
        phase: 'error',
        error: message
      })
      return {
        subscriptionId: subscription.id,
        feedTitle: label,
        status: 'error',
        found: 0,
        added: 0,
        updated: 0,
        error: message,
        durationMs: Date.now() - started
      }
    } finally {
      this.activeSyncs.delete(subscription.id)
    }
  }

  async syncSubscriptionById(id: string, options: SyncOptions = {}): Promise<SyncOutcome> {
    const subscription = this.subscriptions.get(id)
    if (!subscription) throw new Error('Subscription not found')
    return this.syncSubscription(subscription, options)
  }

  async syncAll(options: SyncOptions = {}): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = []
    for (const subscription of this.subscriptions.list().filter((item) => item.enabled)) {
      outcomes.push(await this.syncSubscription(subscription, options))
    }
    return outcomes
  }

  async syncDue(): Promise<SyncOutcome[]> {
    const settings = this.settings.get()
    if (!settings.rss.autoSync) return []
    const due = this.subscriptions.due()
    const outcomes: SyncOutcome[] = []
    for (const subscription of due) {
      outcomes.push(await this.syncSubscription(subscription))
    }
    return outcomes
  }

  startScheduler(intervalMs = 60_000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.running) return
      this.running = true
      void this.syncDue()
        .catch(() => undefined)
        .finally(() => {
          this.running = false
        })
    }, intervalMs)
    setTimeout(() => {
      void this.syncDue().catch(() => undefined)
    }, 12_000)
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  lastArticleDate(): string | null {
    const subscriptions = this.subscriptions.list()
    const dates = subscriptions.map((subscription) => subscription.lastSyncAt).filter((value): value is string => Boolean(value))
    return dates.sort().at(-1) ?? null
  }
}

export function articleLooksLikeJournalFeed(article: Article): boolean {
  return article.source === 'rss' && Boolean(article.subscriptionId)
}

export function feedDateFallback(item: Record<string, unknown>): string | null {
  const value = (item.isoDate ?? item.pubDate ?? item.updated) as string | undefined
  return parseDateLoose(value) ?? (yearFromDate(value) ? `${yearFromDate(value)}-01-01` : null)
}
