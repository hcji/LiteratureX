import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { CategoryRepo } from '../../src/main/db/repositories/categories'
import { ImportExportService } from '../../src/main/services/importExport'

describe('import and export', () => {
  let database: AppDatabase
  let articles: ArticleRepo
  let categories: CategoryRepo
  let service: ImportExportService

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    categories = new CategoryRepo(database, (ids) => {
      for (const id of ids) articles.refreshSearchIndex(id)
    })
    service = new ImportExportService(articles, categories)
  })

  afterEach(() => database.close())

  it('round-trips BibTeX', () => {
    const category = categories.create({ name: 'Natural Products' })
    const article = articles.create({
      title: 'Deep Learning for Tandem Mass Spectra',
      authors: ['Hongchao Ji', 'Mei Wang'],
      journalTitle: 'Journal of Natural Products',
      year: 2024,
      doi: '10.1021/acs.jnatprod.4c00123',
      abstract: 'A deep learning model for MS/MS.',
      keywords: ['deep learning', 'MS/MS'],
      source: 'manual'
    })
    articles.addManualCategory(article.id, category.id)
    const exported = service.exportBibtex()
    expect(exported.count).toBe(1)
    expect(exported.content).toContain('@')

    const fresh = new AppDatabase(':memory:')
    try {
      const freshArticles = new ArticleRepo(fresh)
      const freshCategories = new CategoryRepo(fresh)
      const freshService = new ImportExportService(freshArticles, freshCategories)
      const result = freshService.importBibtex(exported.content)
      expect(result.imported).toBe(1)
      const imported = freshArticles.list({ scope: 'library' }).items[0]
      expect(imported.title).toContain('Deep Learning')
      expect(imported.authors.map((author) => author.name)).toContain('Hongchao Ji')
      expect(imported.doi).toBe('10.1021/acs.jnatprod.4c00123')
    } finally {
      fresh.close()
    }
  })

  it('round-trips RIS', () => {
    articles.create({
      title: 'Spatial Metabolomics of Medicinal Plants',
      authors: ['Anna Lee'],
      journalTitle: 'Phytochemistry',
      year: 2023,
      doi: '10.1000/test',
      pages: '10-20',
      source: 'manual'
    })
    const exported = service.exportRis()
    expect(exported.content).toContain('TY  - JOUR')
    expect(exported.content).toContain('DO  - 10.1000/test')

    const fresh = new AppDatabase(':memory:')
    try {
      const freshArticles = new ArticleRepo(fresh)
      const freshService = new ImportExportService(freshArticles, new CategoryRepo(fresh))
      const result = freshService.importRis(exported.content)
      expect(result.imported).toBe(1)
      const imported = freshArticles.list({ scope: 'library' }).items[0]
      expect(imported.title).toContain('Spatial Metabolomics')
      expect(imported.pages).toBe('10-20')
    } finally {
      fresh.close()
    }
  })

  it('exports JSON metadata and imports categories', () => {
    const parent = categories.create({ name: 'Natural Products' })
    const child = categories.create({ name: 'Plant Metabolomics', parentId: parent.id })
    const article = articles.create({
      title: 'Plant Metabolite Profiling',
      authors: ['Li Zhang'],
      source: 'manual'
    })
    articles.addManualCategory(article.id, child.id)
    const exported = service.exportJson()
    const payload = JSON.parse(exported.content) as { articles: unknown[]; categories: unknown[] }
    expect(payload.articles).toHaveLength(1)
    expect(payload.categories).toHaveLength(2)

    const fresh = new AppDatabase(':memory:')
    try {
      const freshArticles = new ArticleRepo(fresh)
      const freshCategories = new CategoryRepo(fresh, (ids) => {
        for (const id of ids) freshArticles.refreshSearchIndex(id)
      })
      const freshService = new ImportExportService(freshArticles, freshCategories)
      const result = freshService.importJson(exported.content)
      expect(result.imported).toBe(1)
      const imported = freshArticles.list({ scope: 'library' }).items[0]
      expect(imported.categories.map((category) => category.categoryPath)).toContain('Natural Products / Plant Metabolomics')
    } finally {
      fresh.close()
    }
  })

  it('exports CSV with headers', () => {
    articles.create({ title: 'Paper, with comma', authors: ['A'], source: 'manual' })
    const exported = service.exportCsv()
    expect(exported.content.split('\r\n')[0]).toContain('title,authors,journal')
    expect(exported.content).toContain('"Paper, with comma"')
  })
})
