import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Article,
  ArticleCategory,
  ArticleCategoryInput,
  ArticleListResult,
  ArticlePatch,
  ArticleQuery,
  ArticleSort,
  ArticleTranslation,
  Author,
  ClassificationHistoryEntry,
  ClassificationOutput,
  CreateArticleInput,
  DashboardStats,
  Note,
  PdfFile,
  ReadStatus,
  SearchResponseItem
} from '@shared/types'
import {
  isCjk,
  makeDedupKey,
  normalizeAuthorName,
  normalizeDoi,
  normalizeTitle,
  normalizeWhitespace,
  parseDateLoose,
  truncate,
  yearFromDate
} from '@shared/normalize'
import type { AppDatabase } from '../database'

interface ArticleRow {
  id: string
  title: string
  normalized_title: string
  doi: string | null
  doi_normalized: string | null
  journal_id: string | null
  journal_title: string | null
  publisher: string | null
  publication_date: string | null
  year: number | null
  volume: string | null
  issue: string | null
  pages: string | null
  abstract: string | null
  url: string | null
  article_type: string | null
  source: Article['source']
  subscription_id: string | null
  in_library: number
  read_status: ReadStatus
  starred: number
  saved_at: string | null
  created_at: string
  updated_at: string
  dedup_key: string | null
  ai_summary: string | null
  keywords: string | null
  needs_review: number
  metadata_confidence: string | null
  user_edited_fields: string | null
  deleted_at: string | null
  last_classified_at: string | null
  rowid?: number
}

interface CategoryRow {
  id: string
  category_id: string
  article_id: string
  source: ArticleCategory['source']
  confidence: number
  evidence: string | null
  reasoning: string | null
  matched_keywords: string | null
  status: ArticleCategory['status']
  decided_by: 'ai' | 'user'
  model: string | null
  prompt_version: string | null
  created_at: string
  updated_at: string
  name: string
  color: string | null
  parent_id: string | null
}

export interface InterestCorpusArticle {
  id: string
  title: string
  abstract: string | null
  keywords: string[]
  year: number | null
  journalTitle: string | null
  publicationDate: string | null
  updatedAt: string
  categories: Array<{
    categoryId: string
    name: string
    color: string | null
    confidence: number
    status: ArticleCategory['status']
  }>
}

function nowIso(): string {
  return new Date().toISOString()
}

function asBool(value: number | null): boolean {
  return value === 1
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function buildFtsQuery(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  const tokens: string[] = []
  const regex = /"([^"]+)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(raw))) {
    if (match[1]) tokens.push(`"${match[1].replace(/"/g, '""')}"`)
    else if (match[2]) tokens.push(match[2])
  }
  const parts: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (/^(AND|OR|NOT)$/i.test(token)) {
      parts.push(token.toUpperCase())
      continue
    }
    const isQuoted = token.startsWith('"') && token.endsWith('"')
    const cleaned = isQuoted ? token : token.replace(/["*():^]/g, ' ').trim()
    if (!cleaned) continue
    if (isQuoted) parts.push(cleaned)
    else parts.push(`"${cleaned}"${i === tokens.length - 1 ? '*' : ''}`)
  }
  while (parts.length && /^(AND|OR|NOT)$/.test(parts[parts.length - 1])) parts.pop()
  while (parts.length && /^(AND|OR|NOT)$/.test(parts[0])) parts.shift()
  return parts.join(' ')
}

export class ArticleRepo {
  constructor(
    private readonly database: AppDatabase,
    private readonly notify: (type: 'articles:changed', payload?: unknown) => void = () => {}
  ) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  create(input: CreateArticleInput): Article {
    return this.database.transaction(() => {
      const title = normalizeWhitespace(input.title || '')
      if (!title) throw new Error('Article title is required')
      const existing = this.findDuplicate({
        title,
        doi: input.doi,
        journalTitle: input.journalTitle,
        year: input.year
      })
      if (existing) throw new Error('An article with the same DOI or title already exists')
      const id = randomUUID()
      const doi = input.doi?.trim() || null
      const doiNormalized = normalizeDoi(doi)
      const publicationDate = parseDateLoose(input.publicationDate)
      const year = input.year ?? yearFromDate(publicationDate)
      const dedupKey = makeDedupKey({ title, journalTitle: input.journalTitle, year })
      const timestamp = nowIso()
      this.db
        .prepare(
          `INSERT INTO articles (
            id, title, normalized_title, doi, doi_normalized, journal_id, journal_title, publisher,
            publication_date, year, volume, issue, pages, abstract, url, article_type, source,
            subscription_id, in_library, read_status, starred, saved_at, created_at, updated_at,
            dedup_key, ai_summary, keywords, needs_review, metadata_confidence, user_edited_fields,
            deleted_at, last_classified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL)`
        )
        .run(
          id,
          title,
          normalizeTitle(title),
          doi,
          doiNormalized,
          input.journalId ?? null,
          input.journalTitle ?? null,
          input.publisher ?? null,
          publicationDate,
          year,
          input.volume ?? null,
          input.issue ?? null,
          input.pages ?? null,
          input.abstract ?? null,
          input.url ?? null,
          input.articleType ?? null,
          input.source ?? 'manual',
          input.subscriptionId ?? null,
          input.inLibrary === false ? 0 : 1,
          'unread',
          timestamp,
          timestamp,
          timestamp,
          dedupKey || null,
          JSON.stringify(input.keywords ?? []),
          input.needsReview ? 1 : 0
        )
      this.setAuthors(id, input.authors ?? [])
      this.db
        .prepare(
          'INSERT INTO reading_status (article_id, status, last_viewed_at, updated_at) VALUES (?, ?, NULL, ?) ON CONFLICT(article_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at'
        )
        .run(id, 'unread', timestamp)
      this.refreshSearchIndex(id)
      this.notify('articles:changed', { id })
      return this.get(id) as Article
    })
  }

  findRowByDoi(doi?: string | null): ArticleRow | null {
    const normalized = normalizeDoi(doi)
    if (!normalized) return null
    return (this.db.prepare('SELECT * FROM articles WHERE doi_normalized = ?').get(normalized) as ArticleRow | undefined) ?? null
  }

  findRowByDedupKey(title: string, journalTitle?: string | null, year?: number | null): ArticleRow | null {
    const key = makeDedupKey({ title, journalTitle, year })
    if (!key) return null
    return (this.db.prepare('SELECT * FROM articles WHERE dedup_key = ?').get(key) as ArticleRow | undefined) ?? null
  }

  findDuplicate(input: { title: string; doi?: string | null; journalTitle?: string | null; year?: number | null }): ArticleRow | null {
    return this.findRowByDoi(input.doi) ?? this.findRowByDedupKey(input.title, input.journalTitle, input.year)
  }

  dedupe(): { groups: number; removed: number } {
    return this.database.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT a.*, (SELECT COUNT(*) FROM pdf_files p WHERE p.article_id = a.id) AS pdf_count
           FROM articles a WHERE a.deleted_at IS NULL`
        )
        .all() as unknown as Array<ArticleRow & { pdf_count: number }>
      const groups = new Map<string, Array<ArticleRow & { pdf_count: number }>>()
      for (const row of rows) {
        const titleKey = row.normalized_title || normalizeTitle(row.title)
        const key =
          titleKey && titleKey.length >= 20
            ? `title:${titleKey}|${row.year ?? ''}`
            : row.doi_normalized
              ? `doi:${row.doi_normalized}`
              : row.dedup_key
                ? `key:${row.dedup_key}`
                : ''
        if (!key) continue
        const list = groups.get(key) ?? []
        list.push(row)
        groups.set(key, list)
      }

      let groupCount = 0
      let removed = 0
      for (const list of groups.values()) {
        if (list.length < 2) continue
        groupCount += 1
        const sorted = [...list].sort(
          (a, b) =>
            (b.doi_normalized ? 1 : 0) - (a.doi_normalized ? 1 : 0) ||
            b.pdf_count - a.pdf_count ||
            b.in_library - a.in_library ||
            a.created_at.localeCompare(b.created_at)
        )
        const primary = sorted[0]
        const duplicates = sorted.slice(1)
        const all = [primary, ...duplicates]
        const pick = (field: keyof ArticleRow): unknown => {
          const current = primary[field]
          if (current !== null && current !== undefined && current !== '') return current
          for (const row of duplicates) {
            const value = row[field]
            if (value !== null && value !== undefined && value !== '') return value
          }
          return current
        }

        const updates: Array<{ field: string; value: unknown }> = []
        const setIfChanged = (field: keyof ArticleRow): void => {
          const value = pick(field)
          if (value !== primary[field]) updates.push({ field, value })
        }
        for (const field of [
          'doi',
          'journal_id',
          'journal_title',
          'publisher',
          'publication_date',
          'year',
          'volume',
          'issue',
          'pages',
          'abstract',
          'url',
          'article_type',
          'ai_summary',
          'subscription_id',
          'last_classified_at'
        ] as const) {
          setIfChanged(field)
        }
        const title = String(pick('title'))
        if (title !== primary.title) {
          updates.push({ field: 'title', value: title })
          updates.push({ field: 'normalized_title', value: normalizeTitle(title) })
        }
        const keywords = [...new Set(all.flatMap((row) => parseJson<string[]>(row.keywords, [])))].slice(0, 50)
        if (JSON.stringify(keywords) !== primary.keywords) {
          updates.push({ field: 'keywords', value: JSON.stringify(keywords) })
        }
        if (!primary.in_library && all.some((row) => row.in_library)) updates.push({ field: 'in_library', value: 1 })
        if (!primary.starred && all.some((row) => row.starred)) updates.push({ field: 'starred', value: 1 })
        if (!primary.needs_review && all.some((row) => row.needs_review)) updates.push({ field: 'needs_review', value: 1 })
        if (primary.read_status === 'unread' && all.some((row) => row.read_status !== 'unread')) {
          updates.push({ field: 'read_status', value: 'read' })
        }
        const savedAt = all
          .map((row) => row.saved_at)
          .filter((value): value is string => Boolean(value))
          .sort()[0]
        if (savedAt && savedAt !== primary.saved_at) updates.push({ field: 'saved_at', value: savedAt })

        if (updates.length) {
          const sets = updates.map((update) => `${update.field} = ?`).join(', ')
          this.db
            .prepare(`UPDATE articles SET ${sets}, updated_at = ? WHERE id = ?`)
            .run(...updates.map((update) => update.value as string | number | null), nowIso(), primary.id)
        }

        const hasFulltext = this.db.prepare('SELECT 1 FROM article_fulltexts WHERE article_id = ?').get(primary.id)
        if (!hasFulltext) {
          for (const duplicate of duplicates) {
            const moved = this.db
              .prepare(
                `INSERT OR IGNORE INTO article_fulltexts (article_id, text, page_texts, char_count, extracted_at)
                 SELECT ?, text, page_texts, char_count, extracted_at FROM article_fulltexts WHERE article_id = ?`
              )
              .run(primary.id, duplicate.id)
            if (Number(moved.changes)) break
          }
        }

        for (const duplicate of duplicates) {
          this.db.prepare('UPDATE pdf_files SET article_id = ? WHERE article_id = ?').run(primary.id, duplicate.id)
          this.db.prepare('UPDATE notes SET article_id = ? WHERE article_id = ?').run(primary.id, duplicate.id)
          this.db.prepare('UPDATE ai_classifications SET article_id = ? WHERE article_id = ?').run(primary.id, duplicate.id)
          this.db.prepare('UPDATE classification_history SET article_id = ? WHERE article_id = ?').run(primary.id, duplicate.id)
          this.db
            .prepare(
              `INSERT OR IGNORE INTO article_authors (article_id, author_id, position)
               SELECT ?, author_id, position FROM article_authors WHERE article_id = ?`
            )
            .run(primary.id, duplicate.id)
          this.db
            .prepare(
              `INSERT OR IGNORE INTO article_categories (
                 id, article_id, category_id, source, confidence, evidence, reasoning, matched_keywords,
                 status, decided_by, model, prompt_version, created_at, updated_at
               )
               SELECT lower(hex(randomblob(16))), ?, category_id, source, confidence, evidence, reasoning, matched_keywords,
                      status, decided_by, model, prompt_version, created_at, updated_at
               FROM article_categories
               WHERE article_id = ? AND category_id NOT IN (SELECT category_id FROM article_categories WHERE article_id = ?)`
            )
            .run(primary.id, duplicate.id, primary.id)
          const row = this.db.prepare('SELECT rowid AS rid FROM articles WHERE id = ?').get(duplicate.id) as
            | { rid: number }
            | undefined
          this.db.prepare('DELETE FROM articles WHERE id = ?').run(duplicate.id)
          if (row) this.db.prepare('DELETE FROM article_fts WHERE rowid = ?').run(row.rid)
          removed += 1
        }
        this.refreshSearchIndex(primary.id)
      }
      return { groups: groupCount, removed }
    })
  }

  get(id: string): Article | null {
    const row = this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as ArticleRow | undefined
    if (!row) return null
    return this.hydrate([row])[0] ?? null
  }

  getRow(id: string): ArticleRow | null {
    return (this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as ArticleRow | undefined) ?? null
  }

  upsertFromSource(
    input: CreateArticleInput,
    options: { inLibrary: boolean; subscriptionId?: string | null; source?: Article['source'] }
  ): { article: Article; created: boolean; updated: boolean } {
    const existing = this.findDuplicate(input)
    if (!existing) {
      const article = this.create({
        ...input,
        source: options.source ?? input.source ?? 'rss',
        inLibrary: options.inLibrary,
        subscriptionId: options.subscriptionId ?? input.subscriptionId ?? null
      })
      return { article, created: true, updated: false }
    }
    const updated = this.mergeMissing(existing.id, input, options)
    return { article: this.get(existing.id) as Article, created: false, updated }
  }

  mergeMissing(
    articleId: string,
    input: CreateArticleInput,
    options: { inLibrary?: boolean; subscriptionId?: string | null } = {}
  ): boolean {
    return this.database.transaction(() => {
      const row = this.getRow(articleId)
      if (!row) return false
      const edited = new Set(parseJson<string[]>(row.user_edited_fields, []))
      const sets: string[] = []
      const values: Array<string | number | null> = []
      const maybeSet = (column: string, field: string, value: string | number | null, onlyMissing = true): void => {
        if (value === null || value === '' || edited.has(field)) return
        const current = (row as unknown as Record<string, unknown>)[column]
        if (onlyMissing && current !== null && current !== '') return
        sets.push(`${column} = ?`)
        values.push(value)
      }
      maybeSet('journal_title', 'journalTitle', input.journalTitle ?? null)
      maybeSet('journal_id', 'journalId', input.journalId ?? null)
      maybeSet('publisher', 'publisher', input.publisher ?? null)
      maybeSet('publication_date', 'publicationDate', parseDateLoose(input.publicationDate))
      maybeSet('year', 'year', input.year ?? yearFromDate(input.publicationDate))
      maybeSet('volume', 'volume', input.volume ?? null)
      maybeSet('issue', 'issue', input.issue ?? null)
      maybeSet('pages', 'pages', input.pages ?? null)
      maybeSet('article_type', 'articleType', input.articleType ?? null)
      maybeSet('url', 'url', input.url ?? null)
      if (input.abstract && !edited.has('abstract')) {
        if (!row.abstract || input.abstract.length > row.abstract.length * 1.25) {
          sets.push('abstract = ?')
          values.push(input.abstract)
        }
      }
      if (input.doi && !row.doi_normalized && !edited.has('doi')) {
        const doiNormalized = normalizeDoi(input.doi)
        if (doiNormalized) {
          sets.push('doi = ?', 'doi_normalized = ?')
          values.push(input.doi, doiNormalized)
        }
      }
      if (options.subscriptionId && !row.subscription_id) {
        sets.push('subscription_id = ?')
        values.push(options.subscriptionId)
      }
      if (options.inLibrary && !row.in_library) {
        sets.push('in_library = 1', 'saved_at = ?')
        values.push(nowIso())
      }
      if (input.keywords?.length) {
        const merged = [...new Set([...parseJson<string[]>(row.keywords, []), ...input.keywords])]
        sets.push('keywords = ?')
        values.push(JSON.stringify(merged))
      }
      if (!sets.length) return false
      sets.push('updated_at = ?')
      values.push(nowIso())
      values.push(articleId)
      this.db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      const refreshed = this.db.prepare('SELECT title, abstract FROM articles WHERE id = ?').get(articleId) as
        | { title: string; abstract: string | null }
        | undefined
      if (
        refreshed &&
        (refreshed.title !== row.title || (refreshed.abstract ?? '') !== (row.abstract ?? ''))
      ) {
        this.db.prepare('DELETE FROM article_translations WHERE article_id = ?').run(articleId)
      }
      const authorCount = this.db.prepare('SELECT COUNT(*) AS c FROM article_authors WHERE article_id = ?').get(articleId) as { c: number }
      if (authorCount.c === 0 && input.authors?.length) this.setAuthors(articleId, input.authors)
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return true
    })
  }

  update(id: string, patch: ArticlePatch, editedByUser = true): Article | null {
    return this.database.transaction(() => {
      const row = this.getRow(id)
      if (!row) return null
      const sets: string[] = []
      const values: Array<string | number | null> = []
      const edited = new Set(parseJson<string[]>(row.user_edited_fields, []))
      const push = (column: string, field: string, value: string | number | null): void => {
        sets.push(`${column} = ?`)
        values.push(value)
        if (editedByUser) edited.add(field)
      }
      if (patch.title !== undefined) {
        const title = normalizeWhitespace(patch.title)
        if (title) {
          push('title', 'title', title)
          sets.push('normalized_title = ?')
          values.push(normalizeTitle(title))
          const year = patch.year !== undefined ? patch.year : row.year
          const journal = patch.journalTitle !== undefined ? patch.journalTitle : row.journal_title
          sets.push('dedup_key = ?')
          values.push(makeDedupKey({ title, journalTitle: journal, year }) || null)
        }
      }
      if (patch.doi !== undefined) {
        push('doi', 'doi', patch.doi?.trim() || null)
        sets.push('doi_normalized = ?')
        values.push(normalizeDoi(patch.doi))
      }
      if (patch.journalTitle !== undefined) push('journal_title', 'journalTitle', patch.journalTitle)
      if (patch.publisher !== undefined) push('publisher', 'publisher', patch.publisher)
      if (patch.publicationDate !== undefined) {
        push('publication_date', 'publicationDate', parseDateLoose(patch.publicationDate))
        if (patch.year === undefined) {
          sets.push('year = ?')
          values.push(yearFromDate(patch.publicationDate))
        }
      }
      if (patch.year !== undefined) push('year', 'year', patch.year)
      if (patch.volume !== undefined) push('volume', 'volume', patch.volume)
      if (patch.issue !== undefined) push('issue', 'issue', patch.issue)
      if (patch.pages !== undefined) push('pages', 'pages', patch.pages)
      if (patch.abstract !== undefined) push('abstract', 'abstract', patch.abstract)
      if (patch.url !== undefined) push('url', 'url', patch.url)
      if (patch.articleType !== undefined) push('article_type', 'articleType', patch.articleType)
      if (patch.keywords !== undefined) push('keywords', 'keywords', JSON.stringify(patch.keywords))
      if (patch.readStatus !== undefined) {
        sets.push('read_status = ?')
        values.push(patch.readStatus)
        this.db
          .prepare(
            'INSERT INTO reading_status (article_id, status, last_viewed_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(article_id) DO UPDATE SET status = excluded.status, last_viewed_at = excluded.last_viewed_at, updated_at = excluded.updated_at'
          )
          .run(id, patch.readStatus, nowIso(), nowIso())
      }
      if (patch.starred !== undefined) {
        sets.push('starred = ?')
        values.push(patch.starred ? 1 : 0)
      }
      if (patch.inLibrary !== undefined) {
        sets.push('in_library = ?')
        values.push(patch.inLibrary ? 1 : 0)
        if (patch.inLibrary) {
          sets.push('saved_at = COALESCE(saved_at, ?)')
          values.push(nowIso())
        }
      }
      if (patch.needsReview !== undefined) {
        sets.push('needs_review = ?')
        values.push(patch.needsReview ? 1 : 0)
      }
      if (patch.aiSummary !== undefined) push('ai_summary', 'aiSummary', patch.aiSummary)
      if (patch.metadataConfidence !== undefined) {
        sets.push('metadata_confidence = ?')
        values.push(JSON.stringify(patch.metadataConfidence))
      }
      if (editedByUser && edited.size) {
        sets.push('user_edited_fields = ?')
        values.push(JSON.stringify([...edited]))
      }
      if (patch.title !== undefined || patch.abstract !== undefined) {
        this.db.prepare('DELETE FROM article_translations WHERE article_id = ?').run(id)
      }
      if (!sets.length) return this.get(id)
      sets.push('updated_at = ?')
      values.push(nowIso())
      values.push(id)
      this.db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      if (patch.authors !== undefined) this.setAuthors(id, patch.authors)
      this.refreshSearchIndex(id)
      this.notify('articles:changed', { id })
      return this.get(id)
    })
  }

  setRead(id: string, status: ReadStatus): void {
    this.db
      .prepare('UPDATE articles SET read_status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id)
    this.db
      .prepare(
        'INSERT INTO reading_status (article_id, status, last_viewed_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(article_id) DO UPDATE SET status = excluded.status, last_viewed_at = excluded.last_viewed_at, updated_at = excluded.updated_at'
      )
      .run(id, status, status === 'read' ? nowIso() : null, nowIso())
    this.notify('articles:changed', { id })
  }

  setStarred(id: string, starred: boolean): void {
    this.db.prepare('UPDATE articles SET starred = ?, updated_at = ? WHERE id = ?').run(starred ? 1 : 0, nowIso(), id)
    this.notify('articles:changed', { id })
  }

  setInLibrary(id: string, inLibrary: boolean): void {
    this.db
      .prepare('UPDATE articles SET in_library = ?, saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?')
      .run(inLibrary ? 1 : 0, inLibrary ? nowIso() : null, nowIso(), id)
    this.notify('articles:changed', { id })
  }

  trash(id: string): void {
    this.db.prepare('UPDATE articles SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id)
    this.notify('articles:changed', { id })
  }

  restore(id: string): void {
    this.db.prepare('UPDATE articles SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id)
    this.notify('articles:changed', { id })
  }

  deletePermanently(id: string): void {
    this.database.transaction(() => {
      const row = this.db.prepare('SELECT rowid AS rid FROM articles WHERE id = ?').get(id) as { rid: number } | undefined
      this.db.prepare('DELETE FROM pdf_files WHERE article_id = ?').run(id)
      this.db.prepare('DELETE FROM articles WHERE id = ?').run(id)
      if (row) this.db.prepare('DELETE FROM article_fts WHERE rowid = ?').run(row.rid)
      this.notify('articles:changed', { id })
    })
  }

  emptyTrash(): number {
    return this.database.transaction(() => {
      const rows = this.db.prepare('SELECT id FROM articles WHERE deleted_at IS NOT NULL').all() as Array<{ id: string }>
      for (const row of rows) this.deletePermanently(row.id)
      return rows.length
    })
  }

  addNote(articleId: string, content: string): Note {
    return this.database.transaction(() => {
      const id = randomUUID()
      const timestamp = nowIso()
      this.db
        .prepare('INSERT INTO notes (id, article_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, articleId, content, timestamp, timestamp)
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return { id, articleId, content, createdAt: timestamp, updatedAt: timestamp }
    })
  }

  updateNote(noteId: string, content: string): void {
    const row = this.db.prepare('SELECT article_id FROM notes WHERE id = ?').get(noteId) as { article_id: string } | undefined
    this.db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(content, nowIso(), noteId)
    if (row) this.refreshSearchIndex(row.article_id)
  }

  deleteNote(noteId: string): void {
    const row = this.db.prepare('SELECT article_id FROM notes WHERE id = ?').get(noteId) as { article_id: string } | undefined
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(noteId)
    if (row) this.refreshSearchIndex(row.article_id)
  }

  setAuthors(articleId: string, names: string[]): void {
    const clean = names.map((name) => normalizeWhitespace(name)).filter(Boolean)
    this.db.prepare('DELETE FROM article_authors WHERE article_id = ?').run(articleId)
    const insertAuthor = this.db.prepare('INSERT INTO authors (id, name, normalized_name) VALUES (?, ?, ?) ON CONFLICT(normalized_name) DO NOTHING')
    const findAuthor = this.db.prepare('SELECT id FROM authors WHERE normalized_name = ?')
    const link = this.db.prepare('INSERT OR IGNORE INTO article_authors (article_id, author_id, position) VALUES (?, ?, ?)')
    clean.forEach((name, index) => {
      const normalized = normalizeAuthorName(name)
      if (!normalized) return
      insertAuthor.run(randomUUID(), name, normalized)
      const found = findAuthor.get(normalized) as { id: string } | undefined
      if (found) link.run(articleId, found.id, index)
    })
  }

  saveFulltext(articleId: string, text: string, pageTexts?: string[]): void {
    const timestamp = nowIso()
    this.db
      .prepare(
        `INSERT INTO article_fulltexts (article_id, text, page_texts, char_count, extracted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET text = excluded.text, page_texts = excluded.page_texts, char_count = excluded.char_count, extracted_at = excluded.extracted_at`
      )
      .run(articleId, text, pageTexts ? JSON.stringify(pageTexts) : null, text.length, timestamp)
    this.db
      .prepare("UPDATE pdf_files SET text_extracted = 1, extraction_status = 'ok' WHERE article_id = ?")
      .run(articleId)
    this.refreshSearchIndex(articleId)
  }

  getFulltext(articleId: string): { text: string; pages: string[] } | null {
    const row = this.db
      .prepare('SELECT text, page_texts FROM article_fulltexts WHERE article_id = ?')
      .get(articleId) as { text: string; page_texts: string | null } | undefined
    if (!row) return null
    return { text: row.text, pages: parseJson<string[]>(row.page_texts, []) }
  }

  setAiSummary(articleId: string, summary: string | null): void {
    this.db.prepare('UPDATE articles SET ai_summary = ?, updated_at = ? WHERE id = ?').run(summary, nowIso(), articleId)
    this.refreshSearchIndex(articleId)
  }

  listArticleCategories(articleId: string): ArticleCategory[] {
    const rows = this.db
      .prepare(
        `SELECT ac.id, ac.category_id, ac.article_id, ac.source, ac.confidence, ac.evidence, ac.reasoning,
                ac.matched_keywords, ac.status, ac.decided_by, ac.model, ac.prompt_version, ac.created_at, ac.updated_at,
                c.name, c.color, c.parent_id
         FROM article_categories ac
         JOIN categories c ON c.id = ac.category_id
         WHERE ac.article_id = ? AND ac.status != 'rejected'
         ORDER BY ac.confidence DESC`
      )
      .all(articleId) as unknown as CategoryRow[]
    return this.mapCategories(rows)
  }

  private mapCategories(rows: CategoryRow[]): ArticleCategory[] {
    const paths = this.categoryPaths()
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      categoryId: row.category_id,
      categoryName: row.name,
      categoryPath: paths.get(row.category_id)?.path ?? row.name,
      color: row.color,
      source: row.source,
      confidence: row.confidence,
      evidence: row.evidence,
      reasoning: row.reasoning,
      matchedKeywords: parseJson<string[]>(row.matched_keywords, []),
      status: row.status,
      decidedBy: row.decided_by,
      model: row.model,
      promptVersion: row.prompt_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  private categoryPaths(): Map<string, { path: string; name: string }> {
    const rows = this.db.prepare('SELECT id, name, parent_id FROM categories').all() as Array<{
      id: string
      name: string
      parent_id: string | null
    }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    const paths = new Map<string, { path: string; name: string }>()
    const resolve = (id: string, seen: Set<string>): string => {
      if (seen.has(id)) return ''
      seen.add(id)
      const row = byId.get(id)
      if (!row) return ''
      const parent = row.parent_id ? resolve(row.parent_id, seen) : ''
      return parent ? `${parent} / ${row.name}` : row.name
    }
    for (const row of rows) paths.set(row.id, { path: resolve(row.id, new Set()), name: row.name })
    return paths
  }

  applyAiClassification(
    articleId: string,
    output: ClassificationOutput,
    meta: { provider: string; model: string; promptVersion: string }
  ): { preservedManual: number; applied: ArticleCategory[] } {
    return this.database.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM article_categories WHERE article_id = ?')
        .all(articleId) as Array<{
        id: string
        category_id: string
        source: string
        status: string
        decided_by: string
        confidence: number
        evidence: string | null
        reasoning: string | null
        matched_keywords: string | null
        model: string | null
        prompt_version: string | null
        created_at: string
        updated_at: string
      }>
      const existingMap = new Map(existing.map((row) => [row.category_id, row]))
      const now = nowIso()
      let preservedManual = 0
      const appliedIds = new Set<string>()

      for (const item of output.classifications) {
        const prev = existingMap.get(item.categoryId)
        if (prev && (prev.source === 'manual' || prev.decided_by === 'user')) {
          preservedManual += 1
          continue
        }
        appliedIds.add(item.categoryId)
        if (prev) {
          this.db
            .prepare(
              `UPDATE article_categories SET source = 'ai', confidence = ?, evidence = ?, reasoning = ?,
               matched_keywords = ?, status = ?, decided_by = 'ai', model = ?, prompt_version = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(
              item.confidence,
              item.evidence,
              item.reasoning,
              JSON.stringify(item.matchedKeywords),
              item.status,
              meta.model,
              meta.promptVersion,
              now,
              prev.id
            )
          this.insertHistory(articleId, item.categoryId, item.categoryName ?? null, 'reclassified', 'ai', prev, {
            status: item.status,
            confidence: item.confidence
          })
        } else {
          const id = randomUUID()
          this.db
            .prepare(
              `INSERT INTO article_categories (id, article_id, category_id, source, confidence, evidence, reasoning,
               matched_keywords, status, decided_by, model, prompt_version, created_at, updated_at)
               VALUES (?, ?, ?, 'ai', ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?)`
            )
            .run(
              id,
              articleId,
              item.categoryId,
              item.confidence,
              item.evidence,
              item.reasoning,
              JSON.stringify(item.matchedKeywords),
              item.status,
              meta.model,
              meta.promptVersion,
              now,
              now
            )
          this.insertHistory(articleId, item.categoryId, item.categoryName ?? null, 'assigned', 'ai', null, {
            status: item.status,
            confidence: item.confidence
          })
        }
      }

      for (const prev of existing) {
        if (prev.source !== 'ai' || prev.decided_by === 'user') continue
        if (appliedIds.has(prev.category_id)) continue
        this.db.prepare('DELETE FROM article_categories WHERE id = ?').run(prev.id)
        this.insertHistory(articleId, prev.category_id, null, 'removed', 'ai', prev, null)
      }

      this.db
        .prepare('UPDATE articles SET ai_summary = ?, last_classified_at = ?, needs_review = ?, updated_at = ? WHERE id = ?')
        .run(
          output.summary || null,
          now,
          output.needsHumanReview ? 1 : 0,
          now,
          articleId
        )
      if (output.researchTopics?.length) {
        const current = this.db.prepare('SELECT keywords FROM articles WHERE id = ?').get(articleId) as { keywords: string | null }
        const merged = [...new Set([...parseJson<string[]>(current?.keywords, []), ...output.researchTopics])].slice(0, 30)
        this.db.prepare('UPDATE articles SET keywords = ? WHERE id = ?').run(JSON.stringify(merged), articleId)
      }
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return { preservedManual, applied: this.listArticleCategories(articleId) }
    })
  }

  addManualCategory(articleId: string, categoryId: string, evidence?: string | null): ArticleCategory[] {
    return this.database.transaction(() => {
      const now = nowIso()
      const prev = this.db
        .prepare('SELECT * FROM article_categories WHERE article_id = ? AND category_id = ?')
        .get(articleId, categoryId) as { id: string; status: string; confidence: number } | undefined
      if (prev) {
        this.db
          .prepare(
            "UPDATE article_categories SET source = 'manual', status = 'confirmed', decided_by = 'user', confidence = 1, evidence = COALESCE(?, evidence), updated_at = ? WHERE id = ?"
          )
          .run(evidence ?? null, now, prev.id)
        this.insertHistory(articleId, categoryId, null, 'manual_add', 'user', prev, { status: 'confirmed' })
      } else {
        this.db
          .prepare(
            `INSERT INTO article_categories (id, article_id, category_id, source, confidence, evidence, reasoning,
             matched_keywords, status, decided_by, model, prompt_version, created_at, updated_at)
             VALUES (?, ?, ?, 'manual', 1, ?, NULL, '[]', 'confirmed', 'user', NULL, NULL, ?, ?)`
          )
          .run(randomUUID(), articleId, categoryId, evidence ?? null, now, now)
        this.insertHistory(articleId, categoryId, null, 'manual_add', 'user', null, { status: 'confirmed' })
      }
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return this.listArticleCategories(articleId)
    })
  }

  rejectCategory(articleId: string, categoryId: string): ArticleCategory[] {
    return this.database.transaction(() => {
      const now = nowIso()
      const prev = this.db
        .prepare('SELECT * FROM article_categories WHERE article_id = ? AND category_id = ?')
        .get(articleId, categoryId) as { id: string; status: string } | undefined
      if (prev) {
        this.db
          .prepare(
            "UPDATE article_categories SET status = 'rejected', decided_by = 'user', updated_at = ? WHERE id = ?"
          )
          .run(now, prev.id)
        this.insertHistory(articleId, categoryId, null, 'rejected', 'user', prev, { status: 'rejected' })
      } else {
        this.db
          .prepare(
            `INSERT INTO article_categories (id, article_id, category_id, source, confidence, evidence, reasoning,
             matched_keywords, status, decided_by, model, prompt_version, created_at, updated_at)
             VALUES (?, ?, ?, 'manual', 0, NULL, NULL, '[]', 'rejected', 'user', NULL, NULL, ?, ?)`
          )
          .run(randomUUID(), articleId, categoryId, now, now)
        this.insertHistory(articleId, categoryId, null, 'rejected', 'user', null, { status: 'rejected' })
      }
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return this.listArticleCategories(articleId)
    })
  }

  acceptCategory(articleId: string, categoryId: string): ArticleCategory[] {
    return this.database.transaction(() => {
      const prev = this.db
        .prepare('SELECT * FROM article_categories WHERE article_id = ? AND category_id = ?')
        .get(articleId, categoryId) as { id: string; status: string } | undefined
      if (!prev) return this.listArticleCategories(articleId)
      this.db
        .prepare("UPDATE article_categories SET status = 'confirmed', decided_by = 'user', updated_at = ? WHERE id = ?")
        .run(nowIso(), prev.id)
      this.insertHistory(articleId, categoryId, null, 'accepted', 'user', prev, { status: 'confirmed' })
      this.refreshSearchIndex(articleId)
      this.notify('articles:changed', { id: articleId })
      return this.listArticleCategories(articleId)
    })
  }

  private insertHistory(
    articleId: string,
    categoryId: string | null,
    categoryName: string | null,
    action: string,
    actor: 'ai' | 'user',
    before: unknown,
    after: unknown
  ): void {
    this.db
      .prepare(
        'INSERT INTO classification_history (id, article_id, category_id, category_name, action, actor, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        randomUUID(),
        articleId,
        categoryId,
        categoryName,
        action,
        actor,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        nowIso()
      )
  }

  saveClassificationRecord(input: {
    articleId: string
    provider: string
    model: string
    promptVersion: string
    rawResponse: string
    parsed: unknown
    status: 'success' | 'error'
    error?: string | null
    durationMs: number
    thresholds: { high: number; medium: number }
  }): void {
    this.db
      .prepare(
        'INSERT INTO ai_classifications (id, article_id, provider, model, prompt_version, raw_response, parsed_json, status, error, duration_ms, thresholds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        randomUUID(),
        input.articleId,
        input.provider,
        input.model,
        input.promptVersion,
        input.rawResponse,
        JSON.stringify(input.parsed),
        input.status,
        input.error ?? null,
        input.durationMs,
        JSON.stringify(input.thresholds),
        nowIso()
      )
  }

  listIdsForClassification(limit = 50): string[] {
    const rows = this.db
      .prepare(
        `SELECT a.id FROM articles a
         WHERE a.deleted_at IS NULL AND a.in_library = 1
           AND (a.last_classified_at IS NULL OR a.last_classified_at < a.updated_at)
         ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  listIdsUnclassified(limit = 200): string[] {
    const rows = this.db
      .prepare(
        `SELECT a.id FROM articles a
         WHERE a.deleted_at IS NULL AND a.in_library = 1
           AND NOT EXISTS (
             SELECT 1 FROM article_categories ac
             WHERE ac.article_id = a.id AND ac.status != 'rejected'
           )
         ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  listIdsUnclassifiedDiscover(limit = 200): string[] {
    const rows = this.db
      .prepare(
        `SELECT a.id FROM articles a
         WHERE a.deleted_at IS NULL AND a.subscription_id IS NOT NULL AND a.last_classified_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM article_categories ac
             WHERE ac.article_id = a.id AND ac.status != 'rejected'
           )
         ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  listIdsNeedingReview(limit = 100): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT a.id FROM articles a
         JOIN article_categories ac ON ac.article_id = a.id
         WHERE a.deleted_at IS NULL AND ac.status IN ('provisional', 'needs_review')
         ORDER BY a.updated_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  classificationHistory(articleId: string, limit = 40): ClassificationHistoryEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM classification_history WHERE article_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(articleId, limit) as Array<{
      id: string
      article_id: string
      category_id: string | null
      category_name: string | null
      action: string
      actor: 'ai' | 'user'
      before_json: string | null
      after_json: string | null
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      articleId: row.article_id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      action: row.action,
      actor: row.actor,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
      createdAt: row.created_at
    }))
  }

  recentUnmatchedTopics(limit = 400): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT value AS topic FROM ai_classifications,
             json_each(json_extract(ai_classifications.parsed_json, '$.unmatched_topics'))
           WHERE status = 'success' AND parsed_json IS NOT NULL
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Array<{ topic: string }>
      return rows.map((row) => row.topic).filter((topic) => typeof topic === 'string')
    } catch {
      return []
    }
  }

  all(scope: 'library' | 'trash' = 'library'): Article[] {
    const where = scope === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL AND in_library = 1'
    const rows = this.db
      .prepare(`SELECT * FROM articles WHERE ${where} ORDER BY created_at DESC`)
      .all() as unknown as ArticleRow[]
    return this.hydrate(rows)
  }

  interestCorpus(limit = 6000): InterestCorpusArticle[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, abstract, keywords, year, journal_title, publication_date, updated_at
         FROM articles
         WHERE in_library = 1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(Math.max(1, limit)) as Array<{
      id: string
      title: string
      abstract: string | null
      keywords: string | null
      year: number | null
      journal_title: string | null
      publication_date: string | null
      updated_at: string
    }>
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const categoryRows = this.db
      .prepare(
        `SELECT ac.article_id, ac.category_id, ac.confidence, ac.status, c.name, c.color
         FROM article_categories ac JOIN categories c ON c.id = ac.category_id
         WHERE ac.article_id IN (${placeholders}) AND ac.status != 'rejected'
         ORDER BY ac.confidence DESC`
      )
      .all(...ids) as Array<{
      article_id: string
      category_id: string
      confidence: number
      status: ArticleCategory['status']
      name: string
      color: string | null
    }>
    const byArticle = new Map<
      string,
      Array<{ categoryId: string; name: string; color: string | null; confidence: number; status: ArticleCategory['status'] }>
    >()
    for (const row of categoryRows) {
      const list = byArticle.get(row.article_id) ?? []
      list.push({
        categoryId: row.category_id,
        name: row.name,
        color: row.color,
        confidence: row.confidence,
        status: row.status
      })
      byArticle.set(row.article_id, list)
    }
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      abstract: row.abstract,
      keywords: parseJson<string[]>(row.keywords, []),
      year: row.year,
      journalTitle: row.journal_title,
      publicationDate: row.publication_date,
      updatedAt: row.updated_at,
      categories: byArticle.get(row.id) ?? []
    }))
  }

  /** Cheap content signature: read/star changes do not invalidate the interest profile. */
  interestSignature(): string {
    const articles = this.db
      .prepare(
        `SELECT COUNT(*) AS c,
                COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(abstract, ''))), 0) AS size,
                COALESCE(MAX(last_classified_at), '') AS classified
         FROM articles WHERE in_library = 1 AND deleted_at IS NULL`
      )
      .get() as { c: number; size: number; classified: string }
    const assignments = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(MAX(ac.updated_at), '') AS updated
         FROM article_categories ac JOIN articles a ON a.id = ac.article_id
         WHERE a.in_library = 1 AND a.deleted_at IS NULL AND ac.status != 'rejected'`
      )
      .get() as { c: number; updated: string }
    const taxonomy = this.db
      .prepare('SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), \'\') AS updated FROM categories')
      .get() as { c: number; updated: string }
    const keywords = this.db.prepare('SELECT COUNT(*) AS c FROM category_keywords').get() as { c: number }
    return [
      articles.c,
      articles.size,
      articles.classified,
      assignments.c,
      assignments.updated,
      taxonomy.c,
      taxonomy.updated,
      keywords.c
    ].join(':')
  }

  categoryCounts(
    scope: 'library' | 'discover' = 'discover',
    subscriptionId?: string | null
  ): Array<{
    categoryId: string
    name: string
    color: string | null
    count: number
  }> {
    const where: string[] = [
      scope === 'discover'
        ? 'a.subscription_id IS NOT NULL AND a.deleted_at IS NULL'
        : 'a.in_library = 1 AND a.deleted_at IS NULL',
      "ac.status != 'rejected'"
    ]
    const params: string[] = []
    if (scope === 'discover' && subscriptionId) {
      where.push('a.subscription_id = ?')
      params.push(subscriptionId)
    }
    return this.db
      .prepare(
        `SELECT c.id AS categoryId, c.name AS name, c.color AS color, COUNT(DISTINCT a.id) AS count
         FROM article_categories ac
         JOIN categories c ON c.id = ac.category_id
         JOIN articles a ON a.id = ac.article_id
         WHERE ${where.join(' AND ')}
         GROUP BY c.id
         ORDER BY count DESC, c.name ASC`
      )
      .all(...params) as Array<{ categoryId: string; name: string; color: string | null; count: number }>
  }

  translationSource(ids: string[]): Array<{ id: string; title: string; abstract: string | null }> {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    return this.db
      .prepare(`SELECT id, title, abstract FROM articles WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string; title: string; abstract: string | null }>
  }

  getTranslations(ids: string[], language: string): ArticleTranslation[] {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT article_id, language, title, abstract, fields, provider, model, created_at
         FROM article_translations WHERE language = ? AND article_id IN (${placeholders})`
      )
      .all(language, ...ids) as Array<{
      article_id: string
      language: string
      title: string
      abstract: string | null
      fields: string
      provider: string
      model: string | null
      created_at: string
    }>
    return rows.map((row) => ({
      articleId: row.article_id,
      language: row.language as ArticleTranslation['language'],
      title: row.title,
      abstract: row.abstract,
      fields: row.fields === 'all' ? 'all' : 'title',
      provider: 'ai',
      model: row.model,
      createdAt: row.created_at
    }))
  }

  saveTranslation(input: ArticleTranslation): ArticleTranslation {
    const createdAt = input.createdAt || nowIso()
    this.db
      .prepare(
        `INSERT INTO article_translations
           (article_id, language, title, abstract, fields, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(article_id, language) DO UPDATE SET
           title = excluded.title,
           abstract = CASE
             WHEN article_translations.fields = 'all' AND excluded.fields = 'title'
               THEN article_translations.abstract
             ELSE excluded.abstract
           END,
           fields = CASE
             WHEN article_translations.fields = 'all' AND excluded.fields = 'title' THEN 'all'
             ELSE excluded.fields
           END,
           provider = excluded.provider,
           model = excluded.model,
           created_at = excluded.created_at`
      )
      .run(
        input.articleId,
        input.language,
        input.title,
        input.abstract ?? null,
        input.fields,
        input.provider,
        input.model ?? null,
        createdAt
      )
    return { ...input, createdAt }
  }

  list(query: ArticleQuery = {}, categoryIds?: string[]): ArticleListResult {
    const scope = query.scope ?? 'library'
    const where: string[] = []
    const params: Array<string | number> = []
    const joins: string[] = []
    let ftsJoin = false
    let matchExpr = ''

    if (scope === 'library') where.push('a.in_library = 1 AND a.deleted_at IS NULL')
    else if (scope === 'discover') where.push('a.subscription_id IS NOT NULL AND a.deleted_at IS NULL')
    else if (scope === 'trash') where.push('a.deleted_at IS NOT NULL')
    else where.push('a.deleted_at IS NULL')

    if (query.subscriptionId) {
      where.push('a.subscription_id = ?')
      params.push(query.subscriptionId)
    }
    if (query.journalId) {
      where.push('a.journal_id = ?')
      params.push(query.journalId)
    }
    if (query.unreadOnly) where.push("a.read_status = 'unread'")
    if (query.starredOnly) where.push('a.starred = 1')
    if (query.hasPdf) where.push('EXISTS (SELECT 1 FROM pdf_files p WHERE p.article_id = a.id)')
    if (query.inLibraryOnly) where.push('a.in_library = 1')
    if (query.yearFrom) {
      where.push('a.year >= ?')
      params.push(query.yearFrom)
    }
    if (query.yearTo) {
      where.push('a.year <= ?')
      params.push(query.yearTo)
    }
    if (query.source) {
      where.push('a.source = ?')
      params.push(query.source)
    }
    if (query.journalTitle) {
      where.push("a.journal_title LIKE ? ESCAPE '\\'")
      params.push(`%${query.journalTitle.replace(/[%_]/g, (char) => `\\${char}`)}%`)
    }
    if (query.needsReviewOnly) {
      where.push("EXISTS (SELECT 1 FROM article_categories acr WHERE acr.article_id = a.id AND acr.status IN ('provisional','needs_review'))")
    }
    if (query.unclassifiedOnly) {
      where.push("NOT EXISTS (SELECT 1 FROM article_categories acu WHERE acu.article_id = a.id AND acu.status != 'rejected')")
    }
    if (query.ids?.length) {
      where.push(`a.id IN (${query.ids.map(() => '?').join(',')})`)
      params.push(...query.ids)
    }
    const requestedCategoryIds = query.categoryIds?.length
      ? query.categoryIds
      : query.categoryId
        ? [query.categoryId]
        : []
    if (requestedCategoryIds.length) {
      const ids = categoryIds ?? requestedCategoryIds
      if (ids.length) {
        where.push(
          `EXISTS (SELECT 1 FROM article_categories acc WHERE acc.article_id = a.id AND acc.status != 'rejected' AND acc.category_id IN (${ids
            .map(() => '?')
            .join(',')}))`
        )
        params.push(...ids)
      }
    }
    if (query.author) {
      const normalized = normalizeTitle(query.author)
      where.push(
        'EXISTS (SELECT 1 FROM article_authors aa JOIN authors au ON au.id = aa.author_id WHERE aa.article_id = a.id AND au.normalized_name LIKE ?)'
      )
      params.push(`%${normalized}%`)
    }
    if (query.search?.trim()) {
      const term = query.search.trim()
      if (this.database.fts5 && !isCjk(term)) {
        matchExpr = buildFtsQuery(term)
        if (matchExpr) {
          ftsJoin = true
          joins.push('JOIN article_fts ON article_fts.rowid = a.rowid')
          where.push('article_fts MATCH ?')
          params.push(matchExpr)
        }
      } else {
        const like = `%${term.replace(/[%_]/g, (char) => `\\${char}`)}%`
        where.push(
          `(a.title LIKE ? ESCAPE '\\' OR a.abstract LIKE ? ESCAPE '\\' OR a.journal_title LIKE ? ESCAPE '\\'
            OR a.keywords LIKE ? ESCAPE '\\' OR a.ai_summary LIKE ? ESCAPE '\\' OR a.doi LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM notes n WHERE n.article_id = a.id AND n.content LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM article_fulltexts ft WHERE ft.article_id = a.id AND ft.text LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM article_authors aa3 JOIN authors au3 ON au3.id = aa3.author_id WHERE aa3.article_id = a.id AND au3.name LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM article_categories acc3 JOIN categories c3 ON c3.id = acc3.category_id WHERE acc3.article_id = a.id AND c3.name LIKE ? ESCAPE '\\'))`
        )
        for (let i = 0; i < 10; i += 1) params.push(like)
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const sort = query.sort ?? 'publication_date'
    const order = query.order === 'asc' ? 'ASC' : 'DESC'
    const sortSql: Record<ArticleSort, string> = {
      publication_date: `CASE WHEN a.publication_date IS NULL THEN 1 ELSE 0 END ASC, a.publication_date ${order}`,
      created_at: `a.created_at ${order}`,
      title: `a.normalized_title ${order}`,
      journal: `LOWER(COALESCE(a.journal_title, '')) ${order}`,
      author: `(SELECT MIN(au2.normalized_name) FROM article_authors aa2 JOIN authors au2 ON au2.id = aa2.author_id WHERE aa2.article_id = a.id) ${order}`,
      smart: `CASE
          WHEN a.read_status = 'unread' AND EXISTS (
            SELECT 1 FROM article_categories acs WHERE acs.article_id = a.id AND acs.status != 'rejected'
          ) THEN 0
          WHEN a.read_status = 'unread' THEN 1
          WHEN EXISTS (
            SELECT 1 FROM article_categories acs WHERE acs.article_id = a.id AND acs.status != 'rejected'
          ) THEN 2
          ELSE 3
        END ASC,
        CASE WHEN a.publication_date IS NULL THEN 1 ELSE 0 END ASC,
        a.publication_date ${order}`,
      // Interest ranking is computed in AppContext because it needs the profile vector.
      interest: `CASE WHEN a.publication_date IS NULL THEN 1 ELSE 0 END ASC, a.publication_date ${order}`
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100000)
    const offset = Math.max(query.offset ?? 0, 0)

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM articles a ${joins.join(' ')} ${whereSql}`)
      .get(...params) as { c: number }
    const rows = this.db
      .prepare(
        `SELECT a.* FROM articles a ${joins.join(' ')} ${whereSql}
         ORDER BY ${sortSql[sort]} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as ArticleRow[]

    return { items: this.hydrate(rows), total: countRow.c }
  }

  search(query: ArticleQuery & { ftsQuery?: string }, categoryIds?: string[]): { items: SearchResponseItem[]; total: number; tookMs: number } {
    const started = Date.now()
    const term = (query.search ?? '').trim()
    if (!term) {
      const base = this.list({ ...query, search: undefined, limit: query.limit, offset: query.offset })
      return {
        items: base.items.map((article) => ({ article, snippet: article.abstract?.slice(0, 220) ?? '', score: 0 })),
        total: base.total,
        tookMs: Date.now() - started
      }
    }
    const useFts = this.database.fts5 && !isCjk(term)
    if (!useFts) {
      const base = this.list(query)
      return {
        items: base.items.map((article) => ({
          article,
          snippet: this.fallbackSnippet(article, term),
          score: 0
        })),
        total: base.total,
        tookMs: Date.now() - started
      }
    }
    const matchExpr = query.ftsQuery ?? buildFtsQuery(term)
    if (!matchExpr) return { items: [], total: 0, tookMs: Date.now() - started }

    const where: string[] = ['a.deleted_at IS NULL']
    const params: Array<string | number> = [matchExpr]
    if ((query.scope ?? 'library') === 'library') where.push('a.in_library = 1')
    if (query.scope === 'discover') where.push('a.subscription_id IS NOT NULL')
    if (query.subscriptionId) {
      where.push('a.subscription_id = ?')
      params.push(query.subscriptionId)
    }
    const requestedCategoryIds = query.categoryIds?.length
      ? query.categoryIds
      : query.categoryId
        ? [query.categoryId]
        : []
    if (requestedCategoryIds.length) {
      const ids = categoryIds ?? requestedCategoryIds
      where.push(
        `EXISTS (SELECT 1 FROM article_categories acc WHERE acc.article_id = a.id AND acc.status != 'rejected' AND acc.category_id IN (${ids
          .map(() => '?')
          .join(',')}))`
      )
      params.push(...ids)
    }
    if (query.journalId) {
      where.push('a.journal_id = ?')
      params.push(query.journalId)
    }
    if (query.yearFrom) {
      where.push('a.year >= ?')
      params.push(query.yearFrom)
    }
    if (query.yearTo) {
      where.push('a.year <= ?')
      params.push(query.yearTo)
    }
    if (query.unreadOnly) where.push("a.read_status = 'unread'")
    if (query.starredOnly) where.push('a.starred = 1')
    if (query.hasPdf) where.push('EXISTS (SELECT 1 FROM pdf_files p WHERE p.article_id = a.id)')
    if (query.unclassifiedOnly) {
      where.push(
        "NOT EXISTS (SELECT 1 FROM article_categories acu WHERE acu.article_id = a.id AND acu.status != 'rejected')"
      )
    }
    if (query.needsReviewOnly) {
      where.push(
        "EXISTS (SELECT 1 FROM article_categories acr WHERE acr.article_id = a.id AND acr.status IN ('provisional','needs_review'))"
      )
    }
    if (query.source) {
      where.push('a.source = ?')
      params.push(query.source)
    }
    if (query.journalTitle) {
      where.push("a.journal_title LIKE ? ESCAPE '\\'")
      params.push(`%${query.journalTitle.replace(/[%_]/g, (char) => `\\${char}`)}%`)
    }
    if (query.author) {
      where.push(
        'EXISTS (SELECT 1 FROM article_authors aa JOIN authors au ON au.id = aa.author_id WHERE aa.article_id = a.id AND au.normalized_name LIKE ?)'
      )
      params.push(`%${normalizeTitle(query.author)}%`)
    }
    where.unshift('article_fts MATCH ?')
    const whereSql = `WHERE ${where.join(' AND ')}`
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100000)
    const offset = Math.max(query.offset ?? 0, 0)
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM articles a JOIN article_fts ON article_fts.rowid = a.rowid ${whereSql}`)
      .get(...params) as { c: number }
    const rows = this.db
      .prepare(
        `SELECT a.*,
          bm25(article_fts, 10.0, 4.0, 2.0, 2.0, 3.0, 2.0, 3.0, 2.0, 1.0, 5.0) AS rank,
          snippet(article_fts, 1, '<mark>', '</mark>', '…', 28) AS snippet_abstract,
          snippet(article_fts, 8, '<mark>', '</mark>', '…', 28) AS snippet_fulltext,
          snippet(article_fts, 0, '<mark>', '</mark>', '…', 28) AS snippet_title
         FROM articles a JOIN article_fts ON article_fts.rowid = a.rowid
         ${whereSql}
         ORDER BY rank ASC, a.publication_date DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as Array<ArticleRow & { rank: number; snippet_abstract: string; snippet_fulltext: string; snippet_title: string }>
    const items = this.hydrate(rows.map((row) => ({ ...row }))).map((article, index) => {
      const row = rows[index]
      const snippet = row.snippet_abstract || row.snippet_fulltext || row.snippet_title || ''
      return { article, snippet, score: Math.max(0, -row.rank) }
    })
    return { items, total: totalRow.c, tookMs: Date.now() - started }
  }

  private fallbackSnippet(article: Article, term: string): string {
    const haystack = article.abstract || article.aiSummary || ''
    const index = haystack.toLowerCase().indexOf(term.toLowerCase())
    if (index < 0) return haystack.slice(0, 220)
    const start = Math.max(0, index - 60)
    return `${start > 0 ? '…' : ''}${haystack.slice(start, index + term.length + 140)}`
  }

  stats(): DashboardStats {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const scalar = (sql: string, ...params: Array<string | number>): number => {
      const row = this.db.prepare(sql).get(...params) as { c: number } | undefined
      return row?.c ?? 0
    }
    const classificationByCategory = this.db
      .prepare(
        `SELECT c.id AS categoryId, c.name AS name, c.color AS color, COUNT(*) AS count
         FROM article_categories ac JOIN categories c ON c.id = ac.category_id
         WHERE ac.status != 'rejected' AND c.is_active = 1
         GROUP BY c.id ORDER BY count DESC LIMIT 12`
      )
      .all() as Array<{ categoryId: string; name: string; color: string | null; count: number }>
    const recentArticles = this.hydrate(
      this.db
        .prepare('SELECT * FROM articles WHERE deleted_at IS NULL AND in_library = 1 ORDER BY created_at DESC LIMIT 6')
        .all() as unknown as ArticleRow[]
    )
    const recentPublications = this.hydrate(
      this.db
        .prepare(
          'SELECT * FROM articles WHERE deleted_at IS NULL AND in_library = 1 AND publication_date IS NOT NULL ORDER BY publication_date DESC LIMIT 6'
        )
        .all() as unknown as ArticleRow[]
    )
    const lastSync = this.db.prepare('SELECT MAX(last_sync_at) AS v FROM subscriptions').get() as { v: string | null } | undefined
    const sourceRows = this.db
      .prepare('SELECT source, COUNT(*) AS c FROM articles WHERE deleted_at IS NULL GROUP BY source')
      .all() as Array<{ source: string; c: number }>
    return {
      totalPapers: scalar('SELECT COUNT(*) AS c FROM articles WHERE deleted_at IS NULL AND in_library = 1'),
      newThisWeek: scalar('SELECT COUNT(*) AS c FROM articles WHERE deleted_at IS NULL AND created_at >= ?', oneWeekAgo),
      unread: scalar("SELECT COUNT(*) AS c FROM articles WHERE deleted_at IS NULL AND read_status = 'unread'"),
      starred: scalar('SELECT COUNT(*) AS c FROM articles WHERE deleted_at IS NULL AND starred = 1'),
      journals: scalar('SELECT COUNT(DISTINCT journal_id) AS c FROM subscriptions WHERE journal_id IS NOT NULL'),
      categories: scalar('SELECT COUNT(*) AS c FROM categories WHERE is_active = 1'),
      reviewCount: scalar(
        "SELECT COUNT(DISTINCT a.id) AS c FROM articles a JOIN article_categories ac ON ac.article_id = a.id WHERE a.deleted_at IS NULL AND ac.status IN ('provisional','needs_review')"
      ),
      unclassified: scalar(
        "SELECT COUNT(*) AS c FROM articles a WHERE a.deleted_at IS NULL AND a.in_library = 1 AND NOT EXISTS (SELECT 1 FROM article_categories ac WHERE ac.article_id = a.id AND ac.status != 'rejected')"
      ),
      pdfCount: scalar('SELECT COUNT(*) AS c FROM pdf_files'),
      classificationByCategory,
      recentArticles,
      recentPublications,
      lastSyncAt: lastSync?.v ?? null,
      pendingJobs: scalar("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued','running')"),
      sourceCounts: Object.fromEntries(sourceRows.map((row) => [row.source, row.c]))
    }
  }

  refreshSearchIndex(articleId: string): void {
    const row = this.db.prepare('SELECT rowid AS rid, * FROM articles WHERE id = ?').get(articleId) as
      | (ArticleRow & { rid: number })
      | undefined
    if (!row) return
    const authors = (
      this.db
        .prepare(
          'SELECT au.name FROM article_authors aa JOIN authors au ON au.id = aa.author_id WHERE aa.article_id = ? ORDER BY aa.position'
        )
        .all(articleId) as Array<{ name: string }>
    )
      .map((item) => item.name)
      .join(', ')
    const categories = this.listArticleCategories(articleId)
      .map((item) => item.categoryPath)
      .join(', ')
    const notes = (
      this.db.prepare('SELECT content FROM notes WHERE article_id = ? ORDER BY created_at').all(articleId) as Array<{
        content: string
      }>
    )
      .map((item) => item.content)
      .join('\n')
    const fulltextRow = this.db.prepare('SELECT text FROM article_fulltexts WHERE article_id = ?').get(articleId) as
      | { text: string }
      | undefined
    try {
      this.db.prepare('DELETE FROM article_fts WHERE rowid = ?').run(row.rid)
      this.db
        .prepare(
          `INSERT INTO article_fts (rowid, title, abstract, authors, journal, keywords, notes, ai_summary, categories, fulltext, doi)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.rid,
          row.title,
          row.abstract ?? '',
          authors,
          row.journal_title ?? '',
          parseJson<string[]>(row.keywords, []).join(', '),
          notes,
          row.ai_summary ?? '',
          categories,
          truncate(fulltextRow?.text ?? '', 400000),
          row.doi ?? ''
        )
    } catch {
      /* search index is best effort; the article remains usable */
    }
  }

  rebuildSearchIndex(): void {
    this.db.prepare('DELETE FROM article_fts').run()
    const rows = this.db.prepare('SELECT id FROM articles').all() as Array<{ id: string }>
    for (const row of rows) this.refreshSearchIndex(row.id)
  }

  private hydrate(rows: ArticleRow[]): Article[] {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const authorRows = this.db
      .prepare(
        `SELECT aa.article_id, au.id, au.name, aa.position FROM article_authors aa
         JOIN authors au ON au.id = aa.author_id WHERE aa.article_id IN (${placeholders}) ORDER BY aa.position`
      )
      .all(...ids) as Array<{ article_id: string; id: string; name: string; position: number }>
    const categoryRows = this.db
      .prepare(
        `SELECT ac.*, c.name, c.color, c.parent_id FROM article_categories ac JOIN categories c ON c.id = ac.category_id
         WHERE ac.article_id IN (${placeholders}) AND ac.status != 'rejected' ORDER BY ac.confidence DESC`
      )
      .all(...ids) as unknown as CategoryRow[]
    const pdfRows = this.db
      .prepare(`SELECT * FROM pdf_files WHERE article_id IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...ids) as Array<Record<string, unknown>>
    const noteRows = this.db
      .prepare(`SELECT * FROM notes WHERE article_id IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...ids) as Array<Record<string, unknown>>

    const authorsBy = new Map<string, Author[]>()
    for (const row of authorRows) {
      const list = authorsBy.get(row.article_id) ?? []
      list.push({ id: row.id, name: row.name, position: row.position })
      authorsBy.set(row.article_id, list)
    }
    const categoriesBy = new Map<string, CategoryRow[]>()
    for (const row of categoryRows) {
      const list = categoriesBy.get(row.article_id) ?? []
      list.push(row)
      categoriesBy.set(row.article_id, list)
    }
    const pdfBy = new Map<string, PdfFile[]>()
    for (const row of pdfRows) {
      const articleId = row.article_id as string
      const list = pdfBy.get(articleId) ?? []
      list.push({
        id: row.id as string,
        articleId,
        filePath: row.file_path as string,
        storageMode: row.storage_mode as PdfFile['storageMode'],
        sha256: row.sha256 as string,
        size: row.size as number,
        pageCount: (row.page_count as number | null) ?? null,
        textExtracted: row.text_extracted === 1,
        extractionStatus: (row.extraction_status as PdfFile['extractionStatus']) ?? 'pending',
        sourceUrl: (row.source_url as string | null) ?? null,
        createdAt: row.created_at as string
      })
      pdfBy.set(articleId, list)
    }
    const notesBy = new Map<string, Note[]>()
    for (const row of noteRows) {
      const articleId = row.article_id as string
      const list = notesBy.get(articleId) ?? []
      list.push({
        id: row.id as string,
        articleId,
        content: row.content as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      })
      notesBy.set(articleId, list)
    }
    const paths = this.categoryPaths()
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      doi: row.doi,
      journalId: row.journal_id,
      journalTitle: row.journal_title,
      publisher: row.publisher,
      publicationDate: row.publication_date,
      year: row.year,
      volume: row.volume,
      issue: row.issue,
      pages: row.pages,
      abstract: row.abstract,
      url: row.url,
      articleType: row.article_type,
      source: row.source,
      subscriptionId: row.subscription_id,
      inLibrary: asBool(row.in_library),
      readStatus: row.read_status,
      starred: asBool(row.starred),
      savedAt: row.saved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dedupKey: row.dedup_key,
      aiSummary: row.ai_summary,
      keywords: parseJson<string[]>(row.keywords, []),
      needsReview: asBool(row.needs_review),
      metadataConfidence: parseJson<Record<string, number> | null>(row.metadata_confidence, null),
      userEditedFields: parseJson<string[]>(row.user_edited_fields, []),
      deletedAt: row.deleted_at,
      lastClassifiedAt: row.last_classified_at,
      authors: authorsBy.get(row.id) ?? [],
      pdfFiles: pdfBy.get(row.id) ?? [],
      categories: this.mapCategories(categoriesBy.get(row.id) ?? []),
      notes: notesBy.get(row.id) ?? []
    }))
  }
}
