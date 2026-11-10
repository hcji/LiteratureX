import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'

describe('performance at 10,000 references', () => {
  let database: AppDatabase
  let articles: ArticleRepo

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    const insert = database.db.prepare(
      `INSERT INTO articles (id, title, normalized_title, journal_title, year, source, in_library, read_status, starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', 1, 'unread', 0, ?, ?)`
    )
    const fts = database.db.prepare(
      `INSERT INTO article_fts (rowid, title, abstract, authors, journal, keywords, notes, ai_summary, categories, fulltext, doi)
       VALUES (?, ?, ?, ?, ?, ?, '', '', '', ?, '')`
    )
    const now = new Date().toISOString()
    database.transaction(() => {
      for (let index = 0; index < 10000; index += 1) {
        const title =
          index % 2 === 0
            ? `Metabolomics Study ${index}: Plant Natural Product Profiling`
            : `Deep Learning Study ${index} for Mass Spectrometry`
        const result = insert.run(
          `perf-${index}`,
          title,
          title.toLowerCase(),
          index % 2 === 0 ? 'Phytochemistry' : 'Journal of Natural Products',
          2024,
          now,
          now
        )
        const rowid = Number(result.lastInsertRowid)
        fts.run(
          rowid,
          title,
          index % 2 === 0 ? 'metabolomics natural products plant profiling' : 'deep learning mass spectrometry neural network',
          'Perf Author',
          index % 2 === 0 ? 'Phytochemistry' : 'Journal of Natural Products',
          index % 2 === 0 ? 'metabolomics, natural products' : 'deep learning, mass spectrometry',
          index % 2 === 0
            ? 'full text about metabolomics and plant natural products'
            : 'full text about deep learning and mass spectrometry'
        )
      }
    })
  })

  afterEach(() => database.close())

  it('searches and pages quickly', () => {
    const searchStart = performance.now()
    const search = articles.search({ scope: 'library', search: 'metabolomics', limit: 20 })
    const searchMs = performance.now() - searchStart
    expect(search.total).toBe(5000)
    expect(search.items).toHaveLength(20)

    const listStart = performance.now()
    const list = articles.list({ scope: 'library', limit: 50, sort: 'publication_date' })
    const listMs = performance.now() - listStart
    expect(list.total).toBe(10000)
    expect(list.items).toHaveLength(50)

    expect(searchMs).toBeLessThan(2000)
    expect(listMs).toBeLessThan(2000)
    // Keep the measured values visible in CI logs.
    console.log(`[perf] FTS search: ${searchMs.toFixed(1)}ms, list: ${listMs.toFixed(1)}ms`)
  })
})
