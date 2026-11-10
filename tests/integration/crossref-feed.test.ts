import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { SubscriptionRepo } from '../../src/main/db/repositories/subscriptions'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { HttpService } from '../../src/main/services/http'
import { DiscoveryService, crossrefFeedUrl } from '../../src/main/services/discovery'
import { RssSyncService } from '../../src/main/services/rss'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

const worksPayload = {
  message: {
    items: [
      {
        DOI: '10.1093/plphys/test-1',
        title: ['Crossref article one'],
        author: [{ given: 'Ada', family: 'Lovelace' }],
        published: { 'date-parts': [[2026, 11, 1]] },
        'container-title': ['Plant Physiology'],
        abstract: '<jats:p>First abstract.</jats:p>',
        subject: ['Plant Science'],
        URL: 'https://doi.org/10.1093/plphys/test-1'
      },
      {
        DOI: '10.1093/plphys/test-2',
        title: ['Crossref article two'],
        author: [{ given: 'Alan', family: 'Turing' }],
        'published-online': { 'date-parts': [[2026, 11, 2]] },
        'container-title': ['Plant Physiology'],
        URL: 'https://doi.org/10.1093/plphys/test-2'
      }
    ]
  }
}

describe('Crossref fallback synchronization', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let subscriptions: SubscriptionRepo
  let sync: RssSyncService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-crossref-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    subscriptions = new SubscriptionRepo(database)
    const settings = new SettingsService(new SettingsRepo(database), secretBox, {
      managedDir: path.join(dataDir, 'pdfs')
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.crossref.org/journals/0032-0889/works')) {
        return new Response(JSON.stringify(worksPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const http = new HttpService(fetchImpl, 'LiteratureX-test')
    const discovery = new DiscoveryService(http, settings)
    sync = new RssSyncService(http, discovery, articles, subscriptions, settings, {
      emit: () => undefined,
      onNewArticles: () => undefined
    })
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('syncs a Crossref-backed subscription and deduplicates on the next run', async () => {
    const subscription = subscriptions.create({
      feedUrl: crossrefFeedUrl('0032-0889'),
      feedTitle: 'Plant Physiology',
      journalTitle: 'Plant Physiology',
      issn: '0032-0889'
    })

    const first = await sync.syncSubscription(subscription)
    expect(first.status).toBe('success')
    expect(first.found).toBe(2)
    expect(first.added).toBe(2)

    const discovered = articles.list({ scope: 'discover' }).items
    expect(discovered.map((article) => article.doi)).toEqual(
      expect.arrayContaining(['10.1093/plphys/test-1', '10.1093/plphys/test-2'])
    )
    expect(articles.list({ scope: 'library' }).total).toBe(0)

    const second = await sync.syncSubscriptionById(subscription.id)
    expect(second.status).toBe('success')
    expect(second.found).toBe(2)
    expect(second.added).toBe(0)

    const stored = subscriptions.get(subscription.id)
    expect(stored?.feed?.lastStatus).toBe('ok')
    expect(stored?.feed?.lastItemCount).toBe(2)
    expect(subscriptions.syncHistory().length).toBeGreaterThanOrEqual(2)
  })
})
