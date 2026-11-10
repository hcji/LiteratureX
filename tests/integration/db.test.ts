import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { CategoryRepo } from '../../src/main/db/repositories/categories'
import { SubscriptionRepo } from '../../src/main/db/repositories/subscriptions'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { MetadataService } from '../../src/main/services/metadata'
import { CacheRepo } from '../../src/main/db/repositories/cache'
import { HttpService } from '../../src/main/services/http'
import { ClassifierService } from '../../src/main/services/ai/classifier'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

describe('database and article pipeline', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let categories: CategoryRepo
  let settings: SettingsService
  let classifier: ClassifierService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-test-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    categories = new CategoryRepo(database, (ids) => {
      for (const id of ids) articles.refreshSearchIndex(id)
    })
    const settingsRepo = new SettingsRepo(database)
    settings = new SettingsService(settingsRepo, secretBox, { managedDir: path.join(dataDir, 'pdfs') })
    const metadata = new MetadataService(new HttpService(), new CacheRepo(database), settings)
    classifier = new ClassifierService(articles, categories, settings, () => undefined)
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates, hydrates, updates and indexes an article', () => {
    const created = articles.create({
      title: 'Deep Learning for Predicting Tandem Mass Spectra of Plant Natural Products',
      authors: ['Hongchao Ji', 'Mei Wang'],
      journalTitle: 'Journal of Natural Products',
      year: 2024,
      doi: '10.1021/acs.jnatprod.4c00123',
      abstract: 'We present a deep learning model for MS/MS spectral prediction and molecular networking.',
      keywords: ['deep learning', 'MS/MS'],
      source: 'pdf'
    })
    expect(created.id).toBeTruthy()
    expect(created.authors.map((author) => author.name)).toEqual(['Hongchao Ji', 'Mei Wang'])
    expect(created.inLibrary).toBe(true)
    expect(created.pdfFiles).toEqual([])

    const loaded = articles.get(created.id)
    expect(loaded?.doi).toBe('10.1021/acs.jnatprod.4c00123')

    const result = articles.search({ scope: 'library', search: 'deep learning', limit: 10 })
    expect(result.total).toBe(1)
    expect(result.items[0].article.id).toBe(created.id)
    expect(result.items[0].snippet.length).toBeGreaterThan(0)

    articles.update(created.id, { title: 'Graph Neural Networks for Mass Spectra' })
    const updated = articles.get(created.id)
    expect(updated?.title).toBe('Graph Neural Networks for Mass Spectra')
    expect(updated?.userEditedFields).toContain('title')
    expect(articles.search({ scope: 'library', search: 'graph neural', limit: 10 }).total).toBe(1)
  })

  it('deduplicates by DOI and by normalized title', () => {
    const first = articles.create({
      title: 'A Study of Plant Metabolomics',
      journalTitle: 'Phytochemistry',
      year: 2023,
      doi: 'https://doi.org/10.1000/ABC'
    })
    const duplicate = articles.findDuplicate({
      title: 'A Study of Plant Metabolomics',
      doi: '10.1000/abc',
      journalTitle: 'Phytochemistry',
      year: 2023
    })
    expect(duplicate?.id).toBe(first.id)

    const second = articles.create({ title: 'Secondary Metabolite Profiling in Plants', journalTitle: 'Phytochemistry', year: 2023 })
    const noDoiDuplicate = articles.findDuplicate({
      title: 'secondary metabolite profiling in plants',
      journalTitle: 'Phytochemistry',
      year: 2023
    })
    expect(noDoiDuplicate?.id).toBe(second.id)
  })

  it('preserves manual classifications when AI runs again', () => {
    const category = categories.create({ name: 'Deep Learning', keywords: [{ keyword: 'deep learning' }] })
    const other = categories.create({ name: 'Mass Spectrometry', keywords: [{ keyword: 'MS/MS' }] })
    const article = articles.create({
      title: 'Deep Learning for MS/MS Spectra',
      abstract: 'A deep learning approach for MS/MS spectral annotation.',
      source: 'manual'
    })

    articles.addManualCategory(article.id, category.id, 'user decision')
    const outcome = articles.applyAiClassification(
      article.id,
      {
        classifications: [
          { categoryId: category.id, confidence: 0.95, evidence: 'deep learning', matchedKeywords: ['deep learning'], reasoning: 'clear', status: 'auto' },
          { categoryId: other.id, confidence: 0.7, evidence: 'MS/MS', matchedKeywords: ['MS/MS'], reasoning: 'relevant', status: 'provisional' }
        ],
        summary: 'AI summary',
        researchTopics: ['MS/MS prediction'],
        unmatchedTopics: [],
        needsHumanReview: true
      },
      { provider: 'test', model: 'mock', promptVersion: 'v1' }
    )
    expect(outcome.preservedManual).toBe(1)
    const categoriesAfter = articles.get(article.id)?.categories ?? []
    expect(categoriesAfter.find((item) => item.categoryId === category.id)?.decidedBy).toBe('user')
    expect(categoriesAfter.find((item) => item.categoryId === other.id)?.status).toBe('provisional')

    articles.rejectCategory(article.id, other.id)
    const rejected = articles.get(article.id)?.categories ?? []
    expect(rejected.some((item) => item.categoryId === other.id)).toBe(false)

    // A second AI run must not resurrect a user-rejected category.
    articles.applyAiClassification(
      article.id,
      {
        classifications: [
          { categoryId: other.id, confidence: 0.99, evidence: 'MS/MS', matchedKeywords: ['MS/MS'], reasoning: 'relevant', status: 'auto' }
        ],
        summary: 'second run',
        researchTopics: [],
        unmatchedTopics: [],
        needsHumanReview: false
      },
      { provider: 'test', model: 'mock', promptVersion: 'v1' }
    )
    const afterSecond = articles.get(article.id)?.categories ?? []
    expect(afterSecond.some((item) => item.categoryId === other.id)).toBe(false)
  })

  it('classifies locally without an API key', async () => {
    categories.create({
      name: 'Deep Learning',
      keywords: [{ keyword: 'deep learning' }, { keyword: 'neural network' }]
    })
    categories.create({ name: 'Mass Spectrometry', keywords: [{ keyword: 'MS/MS' }, { keyword: 'mass spectra' }] })
    const article = articles.create({
      title: 'Deep Learning for Predicting Tandem Mass Spectra',
      abstract: 'We develop a neural network that predicts MS/MS spectra of natural products.',
      source: 'manual'
    })
    const outcome = await classifier.classifyArticle(article.id, { force: true })
    expect(outcome.provider).toBe('local-heuristic')
    expect(outcome.classifications.length).toBeGreaterThanOrEqual(1)
    expect(outcome.classifications.some((item) => item.categoryName?.includes('Deep Learning'))).toBe(true)
    const stored = articles.get(article.id)
    expect(stored?.lastClassifiedAt).toBeTruthy()
    expect(stored?.aiSummary).toBeTruthy()
  })

  it('searches Chinese text through the LIKE fallback', () => {
    const chinese = articles.create({
      title: '植物天然产物代谢组学研究',
      abstract: '本文研究植物天然产物的质谱注释与分子网络。',
      source: 'manual'
    })
    articles.create({ title: 'Deep Learning for Mass Spectra', source: 'manual' })
    const result = articles.search({ scope: 'library', search: '天然产物', limit: 10 })
    expect(result.total).toBe(1)
    expect(result.items[0].article.id).toBe(chinese.id)
  })

  it('persists across database reopen and keeps the migration version', () => {
    const filePath = path.join(dataDir, 'persist.db')
    const first = new AppDatabase(filePath)
    try {
      const firstRepo = new ArticleRepo(first)
      firstRepo.create({ title: 'Persistent Paper', source: 'manual' })
    } finally {
      first.close()
    }
    const second = new AppDatabase(filePath)
    try {
      const secondRepo = new ArticleRepo(second)
      expect(secondRepo.list({ scope: 'library' }).total).toBe(1)
      const version = second.db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version.user_version).toBeGreaterThanOrEqual(1)
    } finally {
      second.close()
    }
  })

  it('filters by category, unread, starred and trash', () => {    const category = categories.create({ name: 'Metabolomics' })
    const a = articles.create({ title: 'Paper A', source: 'manual' })
    const b = articles.create({ title: 'Paper B', source: 'manual' })
    articles.addManualCategory(a.id, category.id)
    articles.setStarred(b.id, true)
    articles.setRead(a.id, 'read')

    const categoryResult = articles.list({ scope: 'library', categoryId: category.id }, categories.descendantIds(category.id))
    expect(categoryResult.total).toBe(1)
    expect(categoryResult.items[0].id).toBe(a.id)

    expect(articles.list({ scope: 'library', unreadOnly: true }).items.map((item) => item.id)).toEqual([b.id])
    expect(articles.list({ scope: 'library', starredOnly: true }).items.map((item) => item.id)).toEqual([b.id])

    articles.trash(b.id)
    expect(articles.list({ scope: 'library' }).total).toBe(1)
    expect(articles.list({ scope: 'trash' }).items[0].id).toBe(b.id)
    articles.restore(b.id)
    expect(articles.list({ scope: 'trash' }).total).toBe(0)
  })

  it('merges categories while preserving papers, keywords and children', () => {
    const first = categories.create({ name: 'Merge Alpha', keywords: [{ keyword: 'alpha' }] })
    const second = categories.create({ name: 'Merge Beta', keywords: [{ keyword: 'beta' }] })
    const child = categories.create({ name: 'Merge Child', parentId: second.id })
    const article = articles.create({ title: 'Merged category paper', source: 'manual' })
    articles.addManualCategory(article.id, first.id)
    articles.addManualCategory(article.id, second.id)

    const merged = categories.merge([first.id, second.id], { name: 'Merged Topic', keywords: ['gamma'] })

    expect(merged.name).toBe('Merged Topic')
    expect(merged.keywords.map((keyword) => keyword.keyword).sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(categories.get(first.id)).toBeNull()
    expect(categories.get(second.id)).toBeNull()
    expect(categories.get(child.id)?.parentId).toBe(merged.id)
    expect(articles.get(article.id)?.categories.map((category) => category.categoryId)).toEqual([merged.id])
  })

  it('keeps all unread subscription papers before read ones and puts untagged papers last within each group', () => {
    const category = categories.create({ name: 'Smart Sort Category' })
    const subscriptions = new SubscriptionRepo(database)
    const subscription = subscriptions.create({
      feedUrl: 'https://example.org/smart-feed.xml',
      feedTitle: 'Smart Feed',
      journalTitle: 'Smart Journal'
    })
    const taggedUnread = articles.create({
      title: 'Tagged unread',
      source: 'rss',
      inLibrary: false,
      subscriptionId: subscription.id,
      publicationDate: '2024-03-01'
    })
    const taggedRead = articles.create({
      title: 'Tagged read',
      source: 'rss',
      inLibrary: false,
      subscriptionId: subscription.id,
      publicationDate: '2024-03-02'
    })
    const untaggedUnread = articles.create({
      title: 'Untagged unread',
      source: 'rss',
      inLibrary: false,
      subscriptionId: subscription.id,
      publicationDate: '2024-03-03'
    })
    const untaggedRead = articles.create({
      title: 'Untagged read',
      source: 'rss',
      inLibrary: false,
      subscriptionId: subscription.id,
      publicationDate: '2024-03-04'
    })
    articles.addManualCategory(taggedUnread.id, category.id)
    articles.addManualCategory(taggedRead.id, category.id)
    articles.setRead(taggedRead.id, 'read')
    articles.setRead(untaggedRead.id, 'read')

    const ordered = articles.list({ scope: 'discover', sort: 'smart', limit: 10 }).items.map((item) => item.id)
    expect(ordered).toEqual([taggedUnread.id, untaggedUnread.id, taggedRead.id, untaggedRead.id])

    const backfill = articles.listIdsUnclassifiedDiscover(10)
    expect(new Set(backfill)).toEqual(new Set([untaggedUnread.id, untaggedRead.id]))
  })

  it('merges duplicate entries and preserves category assignments', () => {
    const category = categories.create({ name: 'Duplicate Category' })
    const title = 'A duplicate test paper with a sufficiently long title'
    const primary = articles.create({
      title,
      journalTitle: 'Journal A',
      year: 2024,
      doi: '10.1000/dup',
      source: 'manual',
      inLibrary: true
    })
    const duplicate = articles.create({
      title,
      journalTitle: 'Journal B',
      year: 2024,
      doi: '10.1000/dup-2',
      source: 'manual',
      inLibrary: true
    })
    articles.addManualCategory(duplicate.id, category.id)

    const result = articles.dedupe()

    expect(result.groups).toBe(1)
    expect(result.removed).toBe(1)
    expect(articles.get(duplicate.id)).toBeNull()
    expect(articles.get(primary.id)?.categories.some((item) => item.categoryId === category.id)).toBe(true)
  })

  it('never stores a plaintext API key in application_settings', () => {
    settings.update({ ai: { apiKey: 'sk-super-secret', model: 'test-model', baseUrl: 'https://example.test/v1' } })
    const raw = settings['repo'].all()
    expect(JSON.stringify(raw)).not.toContain('sk-super-secret')
    expect(settings.providerConfig().apiKey).toBe('sk-super-secret')
    expect(settings.get().ai.apiKeySet).toBe(true)
  })
})
