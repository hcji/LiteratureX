import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { CategoryRepo } from '../../src/main/db/repositories/categories'
import { SubscriptionRepo } from '../../src/main/db/repositories/subscriptions'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { InterestService } from '../../src/main/services/interest'
import { TranslationService, needsTranslation, textLanguage } from '../../src/main/services/translation'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

describe('interest profile and article translation', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let categories: CategoryRepo
  let subscriptions: SubscriptionRepo
  let settings: SettingsService
  let interest: InterestService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-interest-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    categories = new CategoryRepo(database, (ids) => {
      for (const id of ids) articles.refreshSearchIndex(id)
    })
    subscriptions = new SubscriptionRepo(database)
    settings = new SettingsService(new SettingsRepo(database), secretBox, {
      managedDir: path.join(dataDir, 'pdfs')
    })
    interest = new InterestService(database, articles, settings)
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  function seedLibrary(): { metabolomicsId: string; spectraId: string } {
    const metabolomics = categories.create({
      name: 'Plant metabolomics',
      keywords: [{ keyword: 'metabolomics' }, { keyword: 'mass spectrometry' }]
    })
    const spectra = categories.create({
      name: 'Spectral prediction',
      keywords: [{ keyword: 'deep learning' }, { keyword: 'MS/MS' }]
    })
    const first = articles.create({
      title: 'Deep learning for predicting tandem mass spectra of plant natural products',
      abstract:
        'We present a deep learning model for MS/MS spectral prediction and molecular networking of plant natural products.',
      keywords: ['deep learning', 'MS/MS', 'metabolomics', 'mass spectrometry'],
      journalTitle: 'Journal of Natural Products',
      year: 2024,
      source: 'pdf'
    })
    const second = articles.create({
      title: 'Metabolomics profiling of medicinal plants by liquid chromatography mass spectrometry',
      abstract: 'A metabolomics workflow identifies bioactive compounds in medicinal plants using LC-MS.',
      keywords: ['metabolomics', 'mass spectrometry', 'medicinal plants'],
      journalTitle: 'Phytochemistry',
      year: 2023,
      source: 'pdf'
    })
    const third = articles.create({
      title: 'Graph neural networks for molecular property prediction',
      abstract: 'Graph neural networks learn molecular representations for property prediction.',
      keywords: ['graph neural networks', 'molecular property', 'deep learning'],
      journalTitle: 'Journal of Cheminformatics',
      year: 2022,
      source: 'pdf'
    })
    articles.addManualCategory(first.id, spectra.id)
    articles.addManualCategory(first.id, metabolomics.id)
    articles.addManualCategory(second.id, metabolomics.id)
    articles.addManualCategory(third.id, spectra.id)
    return { metabolomicsId: metabolomics.id, spectraId: spectra.id }
  }

  it('builds a natural-language profile with radar themes from library articles', () => {
    seedLibrary()
    const profile = interest.getProfile()
    expect(profile.status).toBe('ready')
    expect(profile.analyzedArticles).toBe(3)
    expect(profile.summary.length).toBeGreaterThan(40)
    expect(profile.themes.length).toBeGreaterThanOrEqual(3)
    expect(profile.categories.map((category) => category.name)).toContain('Plant metabolomics')
    expect(profile.keywords.length).toBeGreaterThan(0)
    expect(Math.max(...profile.themes.map((theme) => theme.weight))).toBe(1)
  })

  it('scores subscription articles by category affinity and topic overlap', () => {
    seedLibrary()
    const relevant = articles.create({
      title: 'Mass spectrometry metabolomics of plant natural products',
      abstract: 'LC-MS metabolomics profiles plant natural products and mass spectrometry signals.',
      keywords: ['metabolomics', 'mass spectrometry'],
      source: 'rss',
      inLibrary: false
    })
    const offTopic = articles.create({
      title: 'Deep-sea sediment microbial community assembly',
      abstract: 'Microbial community assembly in deep-sea sediments.',
      keywords: ['microbial community', 'sediment'],
      source: 'rss',
      inLibrary: false
    })
    const relevantScore = interest.scoreArticle(articles.get(relevant.id)!)
    const offTopicScore = interest.scoreArticle(articles.get(offTopic.id)!)
    expect(relevantScore.score).toBeGreaterThan(offTopicScore.score)
    expect(relevantScore.keywordScore).toBeGreaterThan(0)
  })

  it('ranks tagged subscription items by confidence when the library is still empty', () => {
    const category = categories.create({ name: 'Metabolomics' })
    const strong = articles.create({ title: 'Strong match', source: 'rss', inLibrary: false })
    const weak = articles.create({ title: 'Weak match', source: 'rss', inLibrary: false })
    articles.applyAiClassification(
      strong.id,
      {
        classifications: [
          {
            categoryId: category.id,
            confidence: 0.9,
            evidence: 'strong',
            matchedKeywords: [],
            reasoning: 'strong',
            status: 'auto'
          }
        ],
        summary: '',
        researchTopics: [],
        unmatchedTopics: [],
        needsHumanReview: false
      },
      { provider: 'probe', model: 'probe', promptVersion: 'probe' }
    )
    articles.applyAiClassification(
      weak.id,
      {
        classifications: [
          {
            categoryId: category.id,
            confidence: 0.55,
            evidence: 'weak',
            matchedKeywords: [],
            reasoning: 'weak',
            status: 'provisional'
          }
        ],
        summary: '',
        researchTopics: [],
        unmatchedTopics: [],
        needsHumanReview: true
      },
      { provider: 'probe', model: 'probe', promptVersion: 'probe' }
    )
    const strongScore = interest.scoreArticle(articles.get(strong.id)!)
    const weakScore = interest.scoreArticle(articles.get(weak.id)!)
    expect(strongScore.score).toBeGreaterThan(weakScore.score)
    expect(strongScore.matchedCategories).toContain('Metabolomics')
  })

  it('reports the most similar library papers for a candidate item', async () => {
    seedLibrary()
    const candidate = articles.create({
      title: 'Deep learning prediction of MS/MS spectra for plant metabolomics',
      abstract: 'A deep learning model predicts tandem mass spectra for metabolomics.',
      keywords: ['deep learning', 'MS/MS', 'metabolomics'],
      source: 'rss',
      inLibrary: false
    })
    const report = await interest.evaluate(candidate.id)
    expect(report.overall).toBeGreaterThan(0.2)
    expect(report.similarArticles.length).toBeGreaterThan(0)
    expect(report.comparedWith).toBe(3)
    expect(report.summary.length).toBeGreaterThan(30)
    expect(report.similarArticles[0].title).toContain('Deep learning')
  })

  it('stores category keywords in one language and backfills legacy rows', () => {
    const english = categories.create({
      name: 'English category',
      keywords: [{ keyword: 'mass spectrometry' }]
    })
    expect(english.keywords[0].keywordEn).toBe('mass spectrometry')
    expect(english.keywords[0].keywordZh).toBeNull()

    const chinese = categories.create({
      name: '中文分类',
      keywords: [{ keyword: '质谱' }]
    })
    expect(chinese.keywords[0].keywordZh).toBe('质谱')
    expect(chinese.keywords[0].keywordEn).toBeNull()

    database.db
      .prepare("INSERT INTO category_keywords (id, category_id, keyword, kind, weight) VALUES (?, ?, ?, 'keyword', 1)")
      .run('legacy-keyword', chinese.id, '代谢组学')
    expect(categories.backfillKeywordLanguages()).toBe(1)
    const legacy = categories
      .get(chinese.id)
      ?.keywords.find((keyword) => keyword.keyword === '代谢组学')
    expect(legacy?.keywordZh).toBe('代谢组学')
    expect(legacy?.keywordEn).toBeNull()
  })

  it('counts assigned category tags for subscription articles', () => {
    const category = categories.create({ name: 'Metabolomics' })
    const subscription = subscriptions.create({
      feedUrl: 'https://example.org/feed.xml',
      journalTitle: 'Example Journal'
    })
    const item = articles.create({
      title: 'Subscription item',
      source: 'rss',
      inLibrary: false,
      subscriptionId: subscription.id
    })
    articles.addManualCategory(item.id, category.id)
    const counts = articles.categoryCounts('discover')
    expect(counts).toHaveLength(1)
    expect(counts[0].count).toBe(1)
    expect(counts[0].name).toBe('Metabolomics')
  })

  it('keeps a full translation when a later batch only refreshes the title', () => {
    const item = articles.create({ title: 'Mass spectrometry metabolomics', abstract: 'An abstract.', source: 'rss' })
    articles.saveTranslation({
      articleId: item.id,
      language: 'zh',
      title: '质谱代谢组学',
      abstract: '摘要。',
      fields: 'all',
      provider: 'ai',
      model: 'probe',
      createdAt: new Date().toISOString()
    })
    articles.saveTranslation({
      articleId: item.id,
      language: 'zh',
      title: '质谱代谢组学（修订）',
      abstract: null,
      fields: 'title',
      provider: 'ai',
      model: 'probe',
      createdAt: new Date().toISOString()
    })
    const rows = articles.getTranslations([item.id], 'zh')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('质谱代谢组学（修订）')
    expect(rows[0].fields).toBe('all')
    expect(rows[0].abstract).toBe('摘要。')

    articles.update(item.id, { title: 'Revised source title' })
    expect(articles.getTranslations([item.id], 'zh')).toHaveLength(0)
  })

  it('translates article titles and abstracts through an OpenAI-compatible endpoint', async () => {
    const server = http.createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
        const payload = JSON.parse(body.messages[1].content) as {
          items: Array<{ id: string; title: string; abstract: string }>
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: payload.items.map((item) => ({
                      id: item.id,
                      title: `译文：${item.title}`,
                      abstract: `摘要：${item.abstract}`
                    }))
                  })
                }
              }
            ]
          })
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      settings.update({
        ai: {
          provider: 'openai',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'probe-model',
          apiKey: 'probe-key'
        }
      })
      const item = articles.create({
        title: 'Mass spectrometry metabolomics',
        abstract: 'An abstract about plant metabolites.',
        source: 'rss'
      })
      const translation = new TranslationService(articles, settings)
      const result = await translation.translate([item.id], 'zh', true)
      expect(result.translations).toHaveLength(1)
      expect(result.translations[0].title).toContain('译文：Mass spectrometry metabolomics')
      expect(result.translations[0].fields).toBe('all')
      const cached = articles.getTranslations([item.id], 'zh')
      expect(cached[0].abstract).toContain('摘要：An abstract')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('detects article text languages for translation', () => {
    expect(textLanguage('Mass spectrometry metabolomics')).toBe('en')
    expect(textLanguage('植物代谢组学与质谱分析')).toBe('zh')
    expect(needsTranslation('Mass spectrometry', null, 'zh')).toBe(true)
    expect(needsTranslation('质谱分析', null, 'zh')).toBe(false)
    expect(needsTranslation('Mass spectrometry', null, 'en')).toBe(false)
  })

  it('runs the schema migration for interest profiles and translations', () => {
    const row = database.db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(3)
    const tables = database.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('interest_profiles','article_translations')")
      .all() as Array<{ name: string }>
    expect(tables.map((table) => table.name).sort()).toEqual(['article_translations', 'interest_profiles'])
  })
})
