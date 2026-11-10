import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { CategoryRepo } from '../../src/main/db/repositories/categories'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { ClassifierService } from '../../src/main/services/ai/classifier'
import { parseClassificationJson } from '../../src/main/services/ai/providers'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

describe('OpenAI-compatible classification with mocked responses', () => {
  let database: AppDatabase
  let articles: ArticleRepo
  let categories: CategoryRepo
  let classifier: ClassifierService
  let categoryId: string

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    categories = new CategoryRepo(database, (ids) => {
      for (const id of ids) articles.refreshSearchIndex(id)
    })
    const settings = new SettingsService(new SettingsRepo(database), secretBox, { managedDir: 'C:/tmp/pdfs' })
    settings.update({
      ai: {
        provider: 'openai',
        baseUrl: 'https://mock.example.test/v1',
        model: 'mock-model',
        apiKey: 'sk-test-key',
        temperature: 0,
        maxTokens: 500
      }
    })
    classifier = new ClassifierService(articles, categories, settings, () => undefined)
    categoryId = categories.create({ name: 'Natural Products', keywords: [{ keyword: 'natural products' }] }).id
  })

  afterEach(() => {
    database.close()
    vi.unstubAllGlobals()
  })

  it('parses fenced JSON and clamps values', () => {
    const parsed = parseClassificationJson(`\`\`\`json
    {"classifications":[{"category_id":"abc","confidence":1.4,"evidence":"x","matched_keywords":["y"],"reasoning":"z"}],"summary":"s","research_topics":[],"unmatched_topics":[],"needs_human_review":false}
    \`\`\``)
    expect(parsed.classifications[0].confidence).toBe(1)
  })

  it('sends a structured request and filters unknown category ids', async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { response_format?: unknown; messages?: unknown[] }
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.messages?.length).toBe(2)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classifications: [
                    {
                      category_id: categoryId,
                      confidence: 0.95,
                      evidence: 'The paper studies natural products.',
                      matched_keywords: ['natural products'],
                      reasoning: 'direct match'
                    },
                    {
                      category_id: '00000000-0000-0000-0000-000000000000',
                      confidence: 0.9,
                      evidence: 'not real',
                      matched_keywords: [],
                      reasoning: 'should be filtered'
                    }
                  ],
                  summary: 'A paper about natural products.',
                  research_topics: ['natural products'],
                  unmatched_topics: ['new topic'],
                  needs_human_review: false
                })
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', mockFetch)

    const article = articles.create({
      title: 'Natural Products from Medicinal Plants',
      abstract: 'We isolate natural products from medicinal plants.',
      source: 'manual'
    })
    const outcome = await classifier.classifyArticle(article.id, { force: true })
    expect(outcome.provider).toBe('openai-compatible')
    expect(outcome.model).toBe('mock-model')
    expect(outcome.classifications).toHaveLength(1)
    expect(outcome.classifications[0].categoryId).toBe(categoryId)
    expect(outcome.classifications[0].confidence).toBe(0.95)
    expect(outcome.classifications[0].status).toBe('auto')
    const stored = articles.get(article.id)
    expect(stored?.aiSummary).toContain('natural products')
  })

  it('stores bilingual category keywords', () => {
    const category = categories.create({
      name: 'Bilingual Keywords',
      keywords: [{ keyword: '质谱', keywordZh: '质谱', keywordEn: 'mass spectrometry' }]
    })
    const stored = categories.listFlat().find((item) => item.id === category.id)
    expect(stored?.keywords[0]).toMatchObject({ keywordZh: '质谱', keywordEn: 'mass spectrometry' })
  })

  it('honors the requested keyword count and includes it in the prompt', async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> }
      expect(String(body.messages?.[0]?.content)).toContain('exactly 5')
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classifications: [],
                  summary: 'A keyword test.',
                  research_topics: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'],
                  unmatched_topics: [],
                  needs_human_review: false
                })
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', mockFetch)

    const article = articles.create({ title: 'Keyword Count Test', source: 'manual' })
    const outcome = await classifier.classifyArticle(article.id, { force: true, keywordCount: 5 })

    expect(outcome.researchTopics).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon'])
    expect(articles.get(article.id)?.keywords).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon'])
  })

  it('lists only uncategorized in-library articles for auto-organizing', () => {
    const article = articles.create({ title: 'Needs organizing', source: 'manual', inLibrary: true })
    expect(articles.listIdsUnclassified()).toContain(article.id)
    articles.addManualCategory(article.id, categoryId)
    expect(articles.listIdsUnclassified()).not.toContain(article.id)
  })

  it('creates new categories proposed by the LLM when enabled', async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> }
      expect(String(body.messages?.[0]?.content)).toContain('NEW CATEGORIES')
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classifications: [
                    {
                      category_id: 'new:1',
                      confidence: 0.91,
                      evidence: 'The paper studies an emerging topic.',
                      matched_keywords: ['emerging topic'],
                      reasoning: 'No existing category fits.'
                    }
                  ],
                  summary: 'A new-topic paper.',
                  research_topics: ['emerging topic'],
                  unmatched_topics: ['emerging topic'],
                  needs_human_review: false,
                  new_categories: [
                    {
                      temp_id: 'new:1',
                      name: 'Emerging Topics',
                      description: 'Automatically proposed category.',
                      keywords: ['emerging topic']
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', mockFetch)

    const article = articles.create({ title: 'A brand new field', source: 'manual' })
    const outcome = await classifier.classifyArticle(article.id, { force: true, allowNewCategories: true })

    expect(outcome.classifications).toHaveLength(1)
    const created = categories.listFlat().find((category) => category.name === 'Emerging Topics')
    expect(created).toBeTruthy()
    expect(outcome.classifications[0].categoryId).toBe(created?.id)
    expect(articles.get(article.id)?.categories.some((category) => category.categoryId === created?.id)).toBe(true)
  })

  it('can create the first category when the taxonomy is empty', async () => {
    categories.delete(categoryId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    classifications: [
                      {
                        category_id: 'new:1',
                        confidence: 0.9,
                        evidence: 'A first topic.',
                        matched_keywords: ['first topic'],
                        reasoning: 'The taxonomy is empty.'
                      }
                    ],
                    summary: 'First topic paper.',
                    research_topics: ['first topic'],
                    unmatched_topics: [],
                    needs_human_review: false,
                    new_categories: [
                      { temp_id: 'new:1', name: 'First Topic', description: 'Created from scratch.', keywords: ['first topic'] }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    const article = articles.create({ title: 'First topic paper', source: 'manual' })
    const outcome = await classifier.classifyArticle(article.id, { force: true, allowNewCategories: true })

    expect(outcome.classifications).toHaveLength(1)
    expect(categories.listFlat().map((category) => category.name)).toContain('First Topic')
  })

  it('analyzes a citation example into a saved format template', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: 'Example Style',
                    description: 'Learned from an example.',
                    inText: '({author}, {year})',
                    bibliography: '[{index}] {authors}. {title}. {journal}, {year}, {volume}({issue}), {pages}.',
                    numbered: true
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    const template = await classifier.analyzeCitationFormat('Ji, H. Deep learning. J. Nat. Prod., 2024, 87(4), 1001-1012.', 'en')
    expect(template.name).toBe('Example Style')
    expect(template.inText).toBe('({author}, {year})')
    expect(template.bibliography).toContain('{authors}')
    expect(template.numbered).toBe(true)
  })

  it('extracts PDF metadata with the LLM fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Deep Learning for Mass Spectra',
                    authors: ['Hongchao Ji', 'Mei Wang'],
                    abstract: 'A deep learning method for tandem mass spectra.',
                    journalTitle: 'Journal of Natural Products',
                    year: 2024,
                    volume: '87',
                    issue: '4',
                    pages: '1001-1012',
                    doi: 'https://doi.org/10.1021/acs.jnatprod.4c00123',
                    keywords: ['deep learning', 'mass spectrometry'],
                    articleType: 'Article'
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    const draft = await classifier.extractPdfMetadata('PDF text '.repeat(40), 'paper.pdf')
    expect(draft).toMatchObject({
      title: 'Deep Learning for Mass Spectra',
      authors: ['Hongchao Ji', 'Mei Wang'],
      year: 2024,
      doi: '10.1021/acs.jnatprod.4c00123',
      keywords: ['deep learning', 'mass spectrometry']
    })
  })

  it('records a friendly error when the AI returns invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }))
    )
    const article = articles.create({ title: 'Broken AI Test', source: 'manual' })
    await expect(classifier.classifyArticle(article.id, { force: true })).rejects.toThrow(/valid JSON/)
    const row = database.db
      .prepare("SELECT status, error FROM ai_classifications WHERE article_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(article.id) as { status: string; error: string } | undefined
    expect(row?.status).toBe('error')
    expect(row?.error).toContain('valid JSON')
  })
})
