import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createPdfiumDirectEngine } from '@embedpdf/engines/pdfium'
import type { PdfFile, PdfImportResult, PdfImportResultItem, PdfMetadataDraft } from '@shared/types'
import { extractDois, isCjk, normalizeWhitespace, stripHtml, yearFromDate } from '@shared/normalize'
import type { ArticleRepo } from '../db/repositories/articles'
import type { PdfRepo } from '../db/repositories/pdfs'
import type { HttpService } from './http'
import type { MetadataService } from './metadata'
import type { SettingsService } from './settings'

interface ExtractedPdf {
  text: string
  pages: string[]
  pageCount: number
  info: Record<string, unknown>
  title?: string
  authors?: string[]
  abstract?: string
  keywords?: string[]
  doi?: string
  year?: number
  journalTitle?: string
  volume?: string
  issue?: string
  pagesRange?: string
}

const MAX_PAGES = 300
const MAX_TEXT = 1_500_000
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function sanitizePathPart(value: string | null | undefined, fallback: string, maxLength = 120): string {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!cleaned) return fallback
  const limited = cleaned.slice(0, maxLength).trim()
  return WINDOWS_RESERVED_NAME.test(limited) ? `_${limited}` : limited
}

function authorFamilyName(author?: string | null): string {
  const value = (author ?? '').trim()
  if (!value) return ''
  if (value.includes(',')) return value.split(',')[0]?.trim() || value
  if (isCjk(value)) return value
  const parts = value.split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

function pdfiumWasmPath(): string {
  const req = typeof require === 'function' ? require : createRequire(path.join(process.cwd(), 'index.js'))
  const entry = req.resolve('@embedpdf/pdfium')
  return path.join(path.dirname(entry), 'pdfium.wasm')
}

function splitAuthors(value?: string | null): string[] {
  if (!value) return []
  return value
    .split(/\s*(?:;|\band\b|\n)\s*/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && item.length < 160)
}

function extractAbstract(text: string): string | undefined {
  const strict = text.match(
    /(?:^|[^a-z])abstract[\s:.\-–]*([\s\S]{80,5000}?)(?=\b(?:keywords?|key words|introduction)\b)/i
  )
  if (strict) return normalizeWhitespace(stripHtml(strict[1]))
  const loose = text.match(/(?:^|[^a-z])abstract[\s:.\-–]*([\s\S]{80,2500})/i)
  return loose ? normalizeWhitespace(stripHtml(loose[1])) : undefined
}

interface PdfTextLine {
  y: number
  size: number
  text: string
}

function groupRuns(
  runs: Array<{ text: string; fontSize: number; rect: { origin: { y: number } } }>
): PdfTextLine[] {
  const lines = new Map<number, { text: string; size: number }>()
  for (const run of runs) {
    const text = normalizeWhitespace(run.text)
    if (!text) continue
    const y = Math.round(run.rect.origin.y)
    const size = Math.abs(run.fontSize)
    if (!Number.isFinite(y) || !Number.isFinite(size)) continue
    const existing = lines.get(y)
    if (existing) {
      existing.text += ` ${text}`
      existing.size = Math.max(existing.size, size)
    } else {
      lines.set(y, { text, size })
    }
  }
  return [...lines.entries()]
    .map(([y, value]) => ({ y, size: value.size, text: normalizeWhitespace(value.text) }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.y - b.y)
}

function extractTitleFromLines(lines: PdfTextLine[]): string | undefined {
  const candidates = lines.filter((line) => line.text.length > 8).sort((a, b) => b.size - a.size)
  if (!candidates.length) return undefined
  const best = candidates[0]
  return best.text.length > 15 ? best.text : undefined
}

function extractCitation(lines: PdfTextLine[]): {
  journalTitle?: string
  year?: number
  volume?: string
  issue?: string
  pagesRange?: string
} {
  for (const line of lines.slice(0, 30)) {
    if (/doi|http|abstract|keywords/i.test(line.text)) continue
    const match = line.text.match(
      /([A-Z][A-Za-z&.:'’()\- ]{3,90}?),\s*((?:19|20)\d{2})(?:,\s*(\d+))?(?:\s*\((\d+)\))?(?:\s*,\s*([0-9]+\s*[-–]\s*[0-9]+|[0-9]+))?/
    )
    if (!match) continue
    const journalTitle = normalizeWhitespace(match[1])
    if (journalTitle.length < 4) continue
    return {
      journalTitle,
      year: Number(match[2]),
      volume: match[3],
      issue: match[4],
      pagesRange: match[5]?.replace(/\s+/g, '')
    }
  }
  return {}
}

export interface PdfImportProgress {
  phase: 'scan' | 'file' | 'done'
  current: number
  total: number
  detail?: string
}

type PdfiumEngine = Awaited<ReturnType<typeof createPdfiumDirectEngine>>

export class PdfService {
  private enginePromise: Promise<PdfiumEngine> | null = null

  constructor(
    private readonly deps: {
      articles: ArticleRepo
      pdfs: PdfRepo
      metadata: MetadataService
      settings: SettingsService
      http: HttpService
      dataDir: string
      extractMetadata?: (input: { text: string; fileName: string }) => Promise<PdfMetadataDraft | null>
      onNewArticles?: (articleIds: string[]) => void
      onPdfChanged?: () => void
    }
  ) {}

  managedDir(): string {
    const configured = this.deps.settings.get().storage.managedDir
    return configured || path.join(this.deps.dataDir, 'pdfs')
  }

  async importPaths(
    paths: string[],
    options: { mode?: 'managed' | 'linked'; articleId?: string } = {},
    onProgress?: (progress: PdfImportProgress) => void
  ): Promise<PdfImportResult> {
    const items: PdfImportResultItem[] = []
    const files: string[] = []
    for (const input of paths) {
      const stat = await fs.stat(input).catch(() => null)
      if (!stat) {
        items.push({ fileName: path.basename(input), status: 'error', error: 'File does not exist' })
        continue
      }
      if (stat.isDirectory()) {
        onProgress?.({ phase: 'scan', current: 0, total: 0, detail: path.basename(input) })
        files.push(...(await this.scanDirectory(input)))
      } else {
        files.push(input)
      }
    }
    const total = files.length
    onProgress?.({ phase: 'file', current: 0, total, detail: files[0] ? path.basename(files[0]) : undefined })
    for (const [index, file] of files.entries()) {
      onProgress?.({ phase: 'file', current: index, total, detail: path.basename(file) })
      items.push(await this.importOne(file, options))
      onProgress?.({ phase: 'file', current: index + 1, total, detail: path.basename(file) })
    }
    onProgress?.({ phase: 'done', current: total, total })
    this.deps.onPdfChanged?.()
    return {
      items,
      imported: items.filter((item) => item.status === 'imported').length,
      duplicates: items.filter((item) => item.status === 'duplicate').length,
      errors: items.filter((item) => item.status === 'error').length
    }
  }

  async scanDirectory(dir: string): Promise<string[]> {
    const results: string[] = []
    const seen = new Set<string>()
    const walk = async (current: string, depth: number): Promise<void> => {
      if (results.length >= 2000 || depth > 30) return
      const real = await fs.realpath(current).catch(() => null)
      if (!real || seen.has(real)) return
      seen.add(real)
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(current, entry.name)
        let isDirectory = entry.isDirectory()
        let isFile = entry.isFile()
        if (entry.isSymbolicLink()) {
          const target = await fs.stat(full).catch(() => null)
          if (!target) continue
          isDirectory = target.isDirectory()
          isFile = target.isFile()
        }
        if (isDirectory) await walk(full, depth + 1)
        else if (isFile && /\.pdf$/i.test(entry.name)) results.push(full)
      }
    }
    await walk(dir, 0)
    return results.sort((a, b) => a.localeCompare(b))
  }

  async importOne(
    filePath: string,
    options: { mode?: 'managed' | 'linked'; articleId?: string } = {}
  ): Promise<PdfImportResultItem> {
    const fileName = path.basename(filePath)
    try {
      if (!/\.pdf$/i.test(filePath)) {
        return { fileName, status: 'error', error: 'Not a PDF file' }
      }
      const buffer = await fs.readFile(filePath)
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      const duplicate = this.deps.pdfs.findBySha(sha256)
      if (duplicate) {
        return {
          fileName,
          status: 'duplicate',
          articleId: duplicate.articleId ?? undefined,
          pdfId: duplicate.id,
          title: duplicate.articleId ? this.deps.articles.get(duplicate.articleId)?.title : undefined
        }
      }
      const mode = options.mode ?? this.deps.settings.get().storage.mode
      const extracted = await this.extract(buffer)
      const warnings: string[] = []
      const offline = process.env['LITERATUREX_OFFLINE'] === '1'
      const enrichment = offline
        ? null
        : await this.deps.metadata
            .enrich({
              title: extracted.title,
              doi: extracted.doi,
              abstract: extracted.abstract,
              authors: extracted.authors,
              year: extracted.year
            })
            .catch(() => null)
      const record = enrichment?.record
      let llmMetadata: PdfMetadataDraft | null = null
      const missingCore =
        !record ||
        !(record.title || extracted.title) ||
        !(record.authors?.length || extracted.authors?.length) ||
        !(record.abstract || extracted.abstract) ||
        !(record.doi || extracted.doi) ||
        !(record.journalTitle || extracted.journalTitle)
      if (!offline && this.deps.extractMetadata && extracted.text.trim().length >= 200 && missingCore) {
        try {
          const llmText = (extracted.pages.slice(0, 3).join('\n') || extracted.text).slice(0, 24000)
          llmMetadata = await this.deps.extractMetadata({ text: llmText, fileName })
        } catch {
          warnings.push('LLM metadata fallback failed; using pdf.js extraction.')
        }
      }
      const llmUsed = Boolean(llmMetadata)
      if (llmUsed) warnings.push('LLM extracted missing metadata from the PDF; review fields if needed.')
      const title =
        record?.title || llmMetadata?.title || extracted.title || fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')
      const doi = record?.doi || llmMetadata?.doi || extracted.doi || null
      if (!record) warnings.push('No external metadata record was found; extracted metadata was used.')
      if (!doi) warnings.push('No DOI could be identified. Review metadata manually.')
      if (!extracted.text.trim()) warnings.push('The PDF contains no extractable text (it may be a scanned document).')
      const journalTitle = record?.journalTitle ?? llmMetadata?.journalTitle ?? extracted.journalTitle ?? null
      const year = record?.year ?? llmMetadata?.year ?? extracted.year ?? yearFromDate(record?.publicationDate)
      const authors = record?.authors?.length
        ? record.authors
        : llmMetadata?.authors?.length
          ? llmMetadata.authors
          : extracted.authors ?? []
      const volume = record?.volume ?? llmMetadata?.volume ?? extracted.volume ?? null
      const issue = record?.issue ?? llmMetadata?.issue ?? extracted.issue ?? null
      const pagesRange = record?.pages ?? llmMetadata?.pages ?? extracted.pagesRange ?? null
      const abstract = record?.abstract ?? llmMetadata?.abstract ?? extracted.abstract ?? null
      const articleType = record?.articleType ?? llmMetadata?.articleType ?? null
      const keywords = [
        ...new Set([
          ...(record?.keywords ?? []),
          ...(llmMetadata?.keywords ?? []),
          ...(extracted.keywords ?? [])
        ])
      ]
      const storedPath = await this.storeFile(filePath, buffer, sha256, mode, {
        year,
        journalTitle,
        authors,
        title
      })
      const existing = options.articleId
        ? this.deps.articles.getRow(options.articleId)
        : this.deps.articles.findDuplicate({ title, doi, journalTitle, year })
      if (options.articleId && !existing) throw new Error('Article not found')
      const now = new Date().toISOString()
      let articleId: string
      if (existing) {
        articleId = existing.id
        this.deps.articles.mergeMissing(
          existing.id,
          {
            title: existing.title || title,
            doi,
            journalTitle,
            publisher: record?.publisher ?? null,
            publicationDate: record?.publicationDate ?? null,
            year,
            volume,
            issue,
            pages: pagesRange,
            abstract,
            url: record?.url ?? null,
            articleType,
            keywords,
            authors,
            source: 'pdf'
          },
          { inLibrary: true }
        )
      } else {
        const article = this.deps.articles.create({
          title,
          doi,
          journalTitle,
          publisher: record?.publisher ?? null,
          publicationDate: record?.publicationDate ?? null,
          year,
          volume,
          issue,
          pages: pagesRange,
          abstract,
          url: record?.url ?? null,
          articleType,
          keywords,
          authors,
          source: 'pdf',
          inLibrary: true,
          needsReview: !doi || !journalTitle || !year || llmUsed
        })
        articleId = article.id
      }
      const pdf = this.deps.pdfs.create({
        articleId,
        filePath: storedPath,
        storageMode: mode,
        sha256,
        size: buffer.byteLength
      })
      this.deps.pdfs.updateExtraction(pdf.id, {
        pageCount: extracted.pageCount,
        textExtracted: Boolean(extracted.text),
        extractionStatus: extracted.text ? 'ok' : 'unavailable'
      })
      if (extracted.text) this.deps.articles.saveFulltext(articleId, extracted.text, extracted.pages)
      const confidence: Record<string, number> = {
        title: record?.title ? (enrichment?.confidence.title ?? 0.8) : llmMetadata?.title ? 0.55 : 0.5,
        doi: record?.doi ? 1 : doi ? 0.7 : 0,
        authors: record?.authors?.length
          ? (enrichment?.confidence.authors ?? 0.6)
          : llmMetadata?.authors?.length
            ? 0.55
            : authors.length
              ? 0.5
              : 0,
        journal: record?.journalTitle
          ? (enrichment?.confidence.journalTitle ?? 0.7)
          : llmMetadata?.journalTitle
            ? 0.55
            : journalTitle
              ? 0.5
              : 0,
        year: record?.year ? 0.9 : llmMetadata?.year ? 0.6 : year ? 0.5 : 0
      }
      this.deps.articles.update(articleId, { metadataConfidence: confidence }, false)
      this.deps.onPdfChanged?.()
      if (!existing && this.deps.settings.get().ai.autoClassify) this.deps.onNewArticles?.([articleId])
      return {
        fileName,
        status: 'imported',
        articleId,
        pdfId: pdf.id,
        title,
        warnings
      }
    } catch (error) {
      return {
        fileName,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async storeFile(
    filePath: string,
    buffer: Buffer,
    sha256: string,
    mode: 'managed' | 'linked',
    naming: { year?: number | null; journalTitle?: string | null; authors?: string[]; title?: string | null }
  ): Promise<string> {
    if (mode === 'linked') return path.resolve(filePath)
    const yearLabel = naming.year ? String(naming.year) : 'Unknown'
    const journalLabel = sanitizePathPart(naming.journalTitle, 'Unknown Journal', 100)
    const folder = sanitizePathPart(`${yearLabel}-${journalLabel}`, 'Unknown', 120)
    const authorLabel = sanitizePathPart(authorFamilyName(naming.authors?.[0]), 'Unknown Author', 60)
    const titleLabel = sanitizePathPart(naming.title, 'Untitled', 120)
    const base = `${yearLabel}-${authorLabel}-${titleLabel}`.slice(0, 180)
    const dir = path.join(this.managedDir(), folder)
    await fs.mkdir(dir, { recursive: true })
    let target = path.join(dir, `${base}.pdf`)
    if (existsSync(target)) {
      target = path.join(dir, `${base}-${sha256.slice(0, 8)}.pdf`)
    }
    if (!existsSync(target)) await fs.writeFile(target, buffer)
    return target
  }

  private async engine(): Promise<PdfiumEngine> {
    if (!this.enginePromise) {
      this.enginePromise = (async () => {
        const wasm = await fs.readFile(pdfiumWasmPath())
        const wasmUrl = `data:application/wasm;base64,${wasm.toString('base64')}`
        return createPdfiumDirectEngine(wasmUrl, { fontFallback: null })
      })().catch((error) => {
        this.enginePromise = null
        throw error
      })
    }
    return this.enginePromise
  }

  async extract(buffer: Buffer): Promise<ExtractedPdf> {
    const engine = await this.engine()
    const content = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
    const doc = await engine.openDocumentBuffer({ id: randomUUID(), content }).toPromise()
    try {
      const pages: string[] = []
      let fullText = ''
      const pageLimit = Math.min(doc.pageCount, MAX_PAGES)
      let firstRuns: Array<{ text: string; fontSize: number; rect: { origin: { y: number } } }> = []
      for (let index = 0; index < pageLimit; index += 1) {
        const { runs } = await engine.getPageTextRuns(doc, doc.pages[index]).toPromise()
        if (index === 0) firstRuns = runs
        const pageText = normalizeWhitespace(runs.map((run) => run.text).join(' '))
        pages.push(pageText)
        fullText += `${pageText}\n`
        if (fullText.length > MAX_TEXT) break
      }
      fullText = fullText.slice(0, MAX_TEXT)

      let metadata: {
        title?: string | null
        author?: string | null
        subject?: string | null
        keywords?: string | null
        creationDate?: Date | null
      } | null = null
      try {
        metadata = await engine.getMetadata(doc).toPromise()
      } catch {
        /* metadata is optional */
      }
      const info: Record<string, unknown> = metadata
        ? {
            Title: metadata.title ?? undefined,
            Author: metadata.author ?? undefined,
            Subject: metadata.subject ?? undefined,
            Keywords: metadata.keywords ?? undefined,
            CreationDate: metadata.creationDate?.toISOString() ?? undefined
          }
        : {}
      const infoTitle = typeof info.Title === 'string' ? normalizeWhitespace(stripHtml(info.Title)) : ''
      const firstLines = groupRuns(firstRuns)
      const title =
        infoTitle && infoTitle.length > 8 && !/untitled|microsoft word|pdf/i.test(infoTitle)
          ? infoTitle
          : extractTitleFromLines(firstLines)
      const authorValue =
        (typeof info.Author === 'string' ? info.Author : '') ||
        (typeof info.author === 'string' ? (info.author as string) : '')
      const keywordsValue = typeof info.Keywords === 'string' ? info.Keywords : ''
      const doi = extractDois(`${fullText.slice(0, 20000)} ${String(info.Subject ?? '')} ${keywordsValue}`)[0] ?? null
      const citation = extractCitation(firstLines)
      const year =
        yearFromDate(typeof info.CreationDate === 'string' ? info.CreationDate : null) ??
        citation.year ??
        yearFromDate(fullText.slice(0, 20000))
      return {
        text: fullText,
        pages,
        pageCount: doc.pageCount,
        info,
        title: title || undefined,
        authors: splitAuthors(authorValue),
        abstract: extractAbstract(fullText.slice(0, 20000)),
        keywords: keywordsValue
          .split(/[;,]/)
          .map((item) => item.trim())
          .filter((item) => item.length > 1 && item.length < 80)
          .slice(0, 20),
        doi: doi ?? undefined,
        year: year ?? undefined,
        journalTitle: citation.journalTitle,
        volume: citation.volume,
        issue: citation.issue,
        pagesRange: citation.pagesRange
      }
    } finally {
      await engine.closeDocument(doc).toPromise().catch(() => undefined)
    }
  }

  async readBytes(pdfId: string): Promise<Uint8Array> {
    const pdf = this.deps.pdfs.get(pdfId)
    if (!pdf) throw new Error('PDF record not found')
    const buffer = await fs.readFile(pdf.filePath)
    return new Uint8Array(buffer)
  }

  async downloadOpenAccess(articleId: string): Promise<{ pdf?: PdfFile; error?: string }> {
    const article = this.deps.articles.get(articleId)
    if (!article) return { error: 'Article not found' }
    const directUrl = article.url && /\.pdf($|\?)/i.test(article.url) ? article.url : null
    if (!directUrl && !article.doi) return { error: 'This article has no DOI or direct PDF URL' }
    const url = directUrl ?? (await this.deps.metadata.unpaywallPdf(article.doi as string))
    if (!url) return { error: 'No open-access PDF was found for this article.' }
    const response = await this.deps.http.getBytes(url, { timeoutMs: 60000, retries: 1 })
    if (!response) return { error: 'Unable to download the open-access PDF' }
    if (response.bytes.byteLength > 120 * 1024 * 1024) return { error: 'The PDF exceeds the 120 MB size limit' }
    if (!/pdf/i.test(response.contentType) && !(response.bytes[0] === 0x25 && response.bytes[1] === 0x50)) {
      return { error: 'The open-access location did not return a PDF' }
    }
    const buffer = Buffer.from(response.bytes)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const existing = this.deps.pdfs.findBySha(sha256)
    if (existing) {
      if (!existing.articleId) {
        this.deps.pdfs.attachToArticle(existing.id, articleId)
        this.deps.onPdfChanged?.()
      }
      return { pdf: this.deps.pdfs.get(existing.id) ?? existing }
    }
    const storedPath = await this.storeFile(url, buffer, sha256, 'managed', {
      year: article.year,
      journalTitle: article.journalTitle,
      authors: article.authors.map((author) => author.name),
      title: article.title
    })
    const pdf = this.deps.pdfs.create({
      articleId,
      filePath: storedPath,
      storageMode: 'managed',
      sha256,
      size: buffer.byteLength,
      sourceUrl: url
    })
    try {
      const extracted = await this.extract(buffer)
      this.deps.pdfs.updateExtraction(pdf.id, {
        pageCount: extracted.pageCount,
        textExtracted: Boolean(extracted.text),
        extractionStatus: extracted.text ? 'ok' : 'unavailable'
      })
      if (extracted.text) this.deps.articles.saveFulltext(articleId, extracted.text, extracted.pages)
      if (!article.abstract && extracted.abstract) {
        this.deps.articles.update(articleId, { abstract: extracted.abstract }, false)
      }
    } catch {
      this.deps.pdfs.updateExtraction(pdf.id, { extractionStatus: 'error' })
    }
    this.deps.onPdfChanged?.()
    return { pdf: this.deps.pdfs.get(pdf.id) ?? pdf }
  }

  async deletePdf(pdfId: string, deleteManagedFile = false): Promise<void> {
    const pdf = this.deps.pdfs.get(pdfId)
    if (!pdf) return
    this.deps.pdfs.delete(pdfId)
    if (deleteManagedFile && pdf.storageMode === 'managed') {
      const managed = path.resolve(this.managedDir())
      const target = path.resolve(pdf.filePath)
      if (target.startsWith(managed) && existsSync(target)) {
        await fs.unlink(target).catch(() => undefined)
      }
    }
    this.deps.onPdfChanged?.()
  }

  newId(): string {
    return randomUUID()
  }
}
