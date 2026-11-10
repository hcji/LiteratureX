import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { SubscriptionRepo } from '../../src/main/db/repositories/subscriptions'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { HttpService } from '../../src/main/services/http'
import { DiscoveryService } from '../../src/main/services/discovery'
import { RssSyncService } from '../../src/main/services/rss'
import { CacheRepo } from '../../src/main/db/repositories/cache'
import { MetadataService } from '../../src/main/services/metadata'
const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

const feedXml = readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'feed.xml'), 'utf8')

describe('RSS parsing and synchronization', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let subscriptions: SubscriptionRepo
  let settings: SettingsService
  let discovery: DiscoveryService
  let sync: RssSyncService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-rss-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    subscriptions = new SubscriptionRepo(database)
    settings = new SettingsService(new SettingsRepo(database), secretBox, { managedDir: path.join(dataDir, 'pdfs') })
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = new Headers((init?.headers ?? {}) as HeadersInit)
      if (headers.get('If-None-Match') === '"feed-v1"') {
        return new Response(null, { status: 304, headers: { etag: '"feed-v1"' } })
      }
      return new Response(feedXml, {
        status: 200,
        headers: {
          'content-type': 'application/xml',
          etag: '"feed-v1"',
          'last-modified': 'Wed, 13 Mar 2024 00:00:00 GMT'
        }
      })
    }) as typeof fetch
    const http = new HttpService(fetchImpl, 'LiteratureX-test')
    const cache = new CacheRepo(database)
    const metadata = new MetadataService(http, cache, settings)
    discovery = new DiscoveryService(http, settings)
    void metadata
    sync = new RssSyncService(http, discovery, articles, subscriptions, settings, {
      emit: () => undefined,
      onNewArticles: () => undefined
    })
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('maps feed items to bibliographic metadata', async () => {
    const feed = await discovery.parseFeed(feedXml)
    expect(feed.title).toBe('Journal of Natural Products')
    expect(feed.items).toHaveLength(2)
    const mapped = discovery.mapItemMetadata(feed.items[0], feed)
    expect(mapped.title).toContain('Deep Learning')
    expect(mapped.doi).toBe('10.1021/acs.jnatprod.4c00123')
    expect(mapped.authors).toContain('Hongchao Ji')
    expect(mapped.abstract).toContain('deep learning')
    expect(mapped.year).toBe(2024)
  })

  it('syncs a subscription, deduplicates, and honors conditional requests', async () => {
    const subscription = subscriptions.create({
      feedUrl: 'https://example.org/journal/feed.xml',
      feedTitle: 'Journal of Natural Products',
      journalTitle: 'Journal of Natural Products',
      issn: '0163-3864'
    })
    const first = await sync.syncSubscription(subscription)
    expect(first.status).toBe('success')
    expect(first.found).toBe(2)
    expect(first.added).toBe(2)
    expect(articles.list({ scope: 'discover' }).total).toBe(2)
    expect(articles.list({ scope: 'library' }).total).toBe(0)
    const discovered = articles.list({ scope: 'discover' }).items
    expect(discovered.map((article) => article.doi)).toContain('10.1021/acs.jnatprod.4c00123')
    articles.setInLibrary(discovered[0].id, true)
    expect(articles.list({ scope: 'library' }).total).toBe(1)

    const second = await sync.syncSubscriptionById(subscription.id)
    expect(second.status).toBe('not_modified')

    const forced = await sync.syncSubscriptionById(subscription.id, { force: true })
    expect(forced.status).toBe('success')
    expect(forced.added).toBe(0)

    const history = subscriptions.syncHistory()
    expect(history.length).toBeGreaterThanOrEqual(3)
  })
})
