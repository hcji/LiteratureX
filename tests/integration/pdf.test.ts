import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { PdfRepo } from '../../src/main/db/repositories/pdfs'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { PdfService } from '../../src/main/services/pdf'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'sample.pdf')

describe('PDF extraction and import', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let pdfs: PdfRepo
  let settings: SettingsService
  let service: PdfService

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-pdf-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    pdfs = new PdfRepo(database)
    settings = new SettingsService(new SettingsRepo(database), secretBox, { managedDir: path.join(dataDir, 'pdfs') })
    service = new PdfService({
      articles,
      pdfs,
      metadata: { enrich: async () => null } as never,
      settings,
      http: {} as never,
      dataDir
    })
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('extracts text, metadata, DOI and title from a PDF', async () => {
    const extracted = await service.extract(readFileSync(fixture))
    expect(extracted.pageCount).toBe(1)
    expect(extracted.text).toContain('Deep Learning for Predicting Tandem Mass Spectra')
    expect(extracted.text).toContain('molecular networking')
    expect(extracted.doi).toBe('10.1021/acs.jnatprod.4c00123')
    expect(extracted.title).toContain('Deep Learning for Predicting Tandem Mass Spectra')
    expect(extracted.authors).toContain('Hongchao Ji')
    expect(extracted.abstract).toContain('deep learning model')
    expect(extracted.journalTitle).toBe('Journal of Natural Products')
    expect(extracted.year).toBe(2024)
    expect(extracted.volume).toBe('87')
    expect(extracted.issue).toBe('4')
    expect(extracted.pagesRange).toBe('1001-1012')
  })

  it('imports a PDF into the unified library and indexes its full text', async () => {
    const result = await service.importPaths([fixture])
    expect(result.imported).toBe(1)
    expect(result.items[0].status).toBe('imported')
    const articleId = result.items[0].articleId as string
    const article = articles.get(articleId)
    expect(article?.title).toContain('Deep Learning')
    expect(article?.doi).toBe('10.1021/acs.jnatprod.4c00123')
    expect(article?.authors.length).toBeGreaterThan(0)
    expect(article?.pdfFiles.length).toBe(1)
    expect(existsSync(article?.pdfFiles[0].filePath ?? '')).toBe(true)
    const storedPath = article?.pdfFiles[0].filePath ?? ''
    expect(storedPath).toContain(path.join('2024-Journal of Natural Products'))
    expect(path.basename(storedPath)).toMatch(/^2024-Ji-Deep Learning/)
    expect(article?.inLibrary).toBe(true)

    const search = articles.search({ scope: 'library', search: 'molecular networking', limit: 10 })
    expect(search.total).toBe(1)
    expect(search.items[0].article.id).toBe(articleId)

    const duplicate = await service.importPaths([fixture])
    expect(duplicate.duplicates).toBe(1)
    expect(duplicate.imported).toBe(0)
  })

  it('keeps linked storage files in place', async () => {
    const result = await service.importPaths([fixture], { mode: 'linked' })
    const articleId = result.items[0].articleId as string
    const article = articles.get(articleId)
    expect(article?.pdfFiles[0].storageMode).toBe('linked')
    expect(article?.pdfFiles[0].filePath).toBe(path.resolve(fixture))
  })

  it('walks nested subfolders when scanning a folder import', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'literaturex-nested-'))
    try {
      mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
      const nested = path.join(root, 'a', 'b', 'nested.pdf')
      const upper = path.join(root, 'a', 'upper.PDF')
      writeFileSync(nested, '')
      writeFileSync(upper, '')
      writeFileSync(path.join(root, 'ignore.txt'), '')
      const files = await service.scanDirectory(root)
      expect(files).toEqual([nested, upper].sort((a, b) => a.localeCompare(b)))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
