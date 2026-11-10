import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { AssistantRepo } from '../../src/main/db/repositories/assistant'
import { CategoryRepo } from '../../src/main/db/repositories/categories'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { AssistantService } from '../../src/main/services/ai/assistant'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

describe('local assistant fallback', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let service: AssistantService
  let settings: SettingsService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-assistant-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    const categories = new CategoryRepo(database, (ids) => {
      for (const id of ids) articles.refreshSearchIndex(id)
    })
    settings = new SettingsService(new SettingsRepo(database), secretBox, { managedDir: path.join(dataDir, 'pdfs') })
    service = new AssistantService(articles, categories, settings, new AssistantRepo(database), () => undefined)
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  function seed(): { a: string; b: string } {
    const a = articles.create({
      title: 'Deep Learning for MS/MS Spectral Prediction',
      abstract:
        'We develop a neural network that predicts tandem mass spectra. The model achieves high accuracy on plant natural products. It enables molecular networking at scale.',
      authors: ['Hongchao Ji'],
      journalTitle: 'Journal of Natural Products',
      year: 2024,
      source: 'manual',
      keywords: ['deep learning', 'MS/MS']
    })
    const b = articles.create({
      title: 'Spatial Metabolomics of Medicinal Plants',
      abstract:
        'Mass spectrometry imaging reveals the spatial distribution of metabolites. We identify tissue-specific natural products and discuss biological implications.',
      authors: ['Anna Lee'],
      journalTitle: 'Phytochemistry',
      year: 2023,
      source: 'manual',
      keywords: ['metabolomics', 'mass spectrometry']
    })
    return { a: a.id, b: b.id }
  }

  it('summarizes selected papers with citations in offline mode', async () => {
    const { a, b } = seed()
    const response = await service.handle({ mode: 'summarize', articleIds: [a, b], language: 'zh' })
    expect(response.offline).toBe(true)
    expect(response.messages).toHaveLength(2)
    const assistant = response.messages[1]
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toContain('Deep Learning')
    expect(assistant.content).toContain('Spatial Metabolomics')
    expect(assistant.citations).toHaveLength(2)
    expect(assistant.citations[0].articleId).toBe(a)
  })

  it('compares papers and cites both sources', async () => {
    const { a, b } = seed()
    const response = await service.handle({ mode: 'compare', articleIds: [a, b], language: 'en' })
    expect(response.offline).toBe(true)
    const content = response.messages[1].content
    expect(content).toContain('Deep Learning')
    expect(content).toContain('Spatial Metabolomics')
    expect(content).toContain('Keywords')
    expect(response.messages[1].citations.length).toBe(2)
  })

  it('answers a chat question using library retrieval when no AI is configured', async () => {
    seed()
    const response = await service.handle({ mode: 'chat', question: 'deep learning mass spectra', language: 'zh' })
    expect(response.offline).toBe(true)
    expect(response.messages[1].content).toContain('本地')
    expect(response.messages[1].citations.length).toBeGreaterThanOrEqual(1)
  })

  it('produces local trend statistics', async () => {
    const { a, b } = seed()
    const response = await service.handle({ mode: 'trends', articleIds: [a, b], language: 'zh' })
    expect(response.messages[1].content).toContain('年份分布')
    expect(response.messages[1].content).toContain('2024')
  })

  it('uses a configured model and validates citations', async () => {
    settings.update({
      ai: {
        provider: 'openai',
        baseUrl: 'https://mock.example.test/v1',
        model: 'mock-model',
        apiKey: 'sk-test'
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    'According to [1], the paper presents a deep learning model for MS/MS prediction. It also cites invalid [99] and a page [1, p.2].'
                }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    const { a } = seed()
    const response = await service.handle({ mode: 'summarize', articleIds: [a], language: 'en' })
    expect(response.offline).toBe(false)
    expect(response.messages[1].content).toContain('According to [1]')
    expect(response.messages[1].citations).toHaveLength(1)
    expect(response.messages[1].citations[0].articleId).toBe(a)
    expect(response.messages[1].citations[0].page).toBe(2)
  })
})
