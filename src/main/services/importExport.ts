import type { Article, Category, IoResult } from '@shared/types'
import { normalizeWhitespace } from '@shared/normalize'
import type { ArticleRepo } from '../db/repositories/articles'
import type { CategoryRepo } from '../db/repositories/categories'

interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
}

function stripBibValue(value: string): string {
  let result = value.trim()
  while (result.startsWith('{') && result.endsWith('}')) result = result.slice(1, -1)
  if (result.startsWith('"') && result.endsWith('"')) result = result.slice(1, -1)
  return result.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  let index = 0
  while (index < text.length) {
    const at = text.indexOf('@', index)
    if (at < 0) break
    const header = text.slice(at + 1).match(/^([A-Za-z]+)\s*([{(])/)
    if (!header) {
      index = at + 1
      continue
    }
    const type = header[1].toLowerCase()
    const open = header[2]
    const close = open === '{' ? '}' : ')'
    let cursor = at + 1 + header[0].length
    let depth = 1
    let inQuote = false
    const contentStart = cursor
    let contentEnd = -1
    while (cursor < text.length) {
      const char = text[cursor]
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === '"') inQuote = !inQuote
      if (!inQuote) {
        if (char === open) depth += 1
        else if (char === close) {
          depth -= 1
          if (depth === 0) {
            contentEnd = cursor
            break
          }
        }
      }
      cursor += 1
    }
    if (contentEnd < 0) break
    const content = text.slice(contentStart, contentEnd)
    const commaIndex = findTopLevelComma(content)
    const key = commaIndex >= 0 ? content.slice(0, commaIndex).trim() : content.trim()
    const fieldPart = commaIndex >= 0 ? content.slice(commaIndex + 1) : ''
    entries.push({ type, key, fields: parseBibFields(fieldPart) })
    index = contentEnd + 1
  }
  return entries
}

function findTopLevelComma(value: string): number {
  let depth = 0
  let inQuote = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '"') inQuote = !inQuote
    if (!inQuote) {
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === ',' && depth === 0) return index
    }
  }
  return -1
}

function parseBibFields(value: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let index = 0
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index += 1
    const nameStart = index
    while (index < value.length && /[A-Za-z0-9_-]/.test(value[index])) index += 1
    const name = value.slice(nameStart, index).toLowerCase()
    if (!name) {
      index += 1
      continue
    }
    while (index < value.length && /\s/.test(value[index])) index += 1
    if (value[index] !== '=') {
      while (index < value.length && value[index] !== ',') index += 1
      continue
    }
    index += 1
    let assembled = ''
    let done = false
    while (index < value.length && !done) {
      while (index < value.length && /\s/.test(value[index])) index += 1
      const char = value[index]
      if (char === '{') {
        let depth = 1
        index += 1
        const start = index
        while (index < value.length && depth > 0) {
          if (value[index] === '\\') {
            index += 2
            continue
          }
          if (value[index] === '{') depth += 1
          else if (value[index] === '}') depth -= 1
          if (depth > 0) index += 1
        }
        assembled += value.slice(start, index)
        index += 1
      } else if (char === '"') {
        index += 1
        const start = index
        while (index < value.length && value[index] !== '"') {
          if (value[index] === '\\') index += 2
          else index += 1
        }
        assembled += value.slice(start, index)
        index += 1
      } else {
        const start = index
        while (index < value.length && value[index] !== ',' && value[index] !== '#') index += 1
        assembled += value.slice(start, index)
      }
      while (index < value.length && /\s/.test(value[index])) index += 1
      if (value[index] === '#') {
        index += 1
        continue
      }
      done = true
    }
    if (name) fields[name] = stripBibValue(assembled)
    while (index < value.length && value[index] !== ',') index += 1
    if (value[index] === ',') index += 1
  }
  return fields
}

function splitKeywords(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitAuthors(value?: string): string[] {
  if (!value) return []
  return value
    .split(/\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean)
}

function bibEntryToArticle(entry: BibEntry): {
  title: string
  authors: string[]
  journalTitle?: string
  year?: number
  volume?: string
  issue?: string
  pages?: string
  doi?: string
  abstract?: string
  url?: string
  publisher?: string
  keywords: string[]
  articleType?: string
} | null {
  const fields = entry.fields
  const title = normalizeWhitespace(fields.title ?? fields.booktitle ?? '')
  if (!title) return null
  const yearValue = Number((fields.year ?? fields.date ?? '').match(/\d{4}/)?.[0])
  const pages = fields.pages?.replace(/--/g, '-')
  return {
    title,
    authors: splitAuthors(fields.author ?? fields.editor),
    journalTitle: fields.journal ?? fields.journaltitle ?? fields.booktitle ?? undefined,
    year: Number.isFinite(yearValue) ? yearValue : undefined,
    volume: fields.volume,
    issue: fields.number ?? fields.issue,
    pages,
    doi: fields.doi,
    abstract: fields.abstract,
    url: fields.url,
    publisher: fields.publisher,
    keywords: splitKeywords(fields.keywords),
    articleType: entry.type
  }
}

function exportKey(article: Article, used: Set<string>): string {
  const family = (article.authors[0]?.name ?? 'unknown').split(/\s+/).pop() ?? 'unknown'
  const firstWord = (article.title.match(/[A-Za-z0-9]+/)?.[0] ?? 'paper').toLowerCase()
  const base = `${family}${article.year ?? ''}${firstWord}`.replace(/[^A-Za-z0-9]/g, '')
  let key = base || `paper${article.id.slice(0, 6)}`
  let suffix = 1
  while (used.has(key)) {
    suffix += 1
    key = `${base}${suffix}`
  }
  used.add(key)
  return key
}

function escapeBib(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

export class ImportExportService {
  constructor(
    private readonly articles: ArticleRepo,
    private readonly categories: CategoryRepo
  ) {}

  exportBibtex(articleIds?: string[]): { content: string; count: number } {
    const items = articleIds?.length
      ? articleIds.map((id) => this.articles.get(id)).filter((item): item is Article => Boolean(item))
      : this.articles.all()
    const used = new Set<string>()
    const blocks = items.map((article) => {
      const key = exportKey(article, used)
      const fields: Array<[string, string | undefined]> = [
        ['title', article.title],
        ['author', article.authors.map((author) => author.name).join(' and ')],
        ['journal', article.journalTitle ?? undefined],
        ['year', article.year ? String(article.year) : undefined],
        ['volume', article.volume ?? undefined],
        ['number', article.issue ?? undefined],
        ['pages', article.pages ?? undefined],
        ['doi', article.doi ?? undefined],
        ['url', article.url ?? undefined],
        ['publisher', article.publisher ?? undefined],
        ['keywords', article.keywords.join(', ') || undefined],
        ['abstract', article.abstract ?? undefined]
      ]
      const lines = fields
        .filter(([, value]) => Boolean(value))
        .map(([name, value]) => `  ${name} = {${escapeBib(value as string)}}`)
      return `@${article.articleType && /^[a-z]+$/i.test(article.articleType) ? article.articleType.toLowerCase() : 'article'}{${key},\n${lines.join(',\n')}\n}`
    })
    return { content: `${blocks.join('\n\n')}\n`, count: items.length }
  }

  importBibtex(text: string, source: 'import' = 'import'): IoResult {
    const entries = parseBibtex(text)
    let imported = 0
    let skipped = 0
    const errors: string[] = []
    for (const entry of entries) {
      try {
        const parsed = bibEntryToArticle(entry)
        if (!parsed) {
          skipped += 1
          continue
        }
        const existing = this.articles.findDuplicate(parsed)
        if (existing) {
          this.articles.mergeMissing(existing.id, { ...parsed, source }, { inLibrary: true })
          skipped += 1
        } else {
          this.articles.create({ ...parsed, source, inLibrary: true })
          imported += 1
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    return { imported, skipped, errors, count: entries.length }
  }

  exportRis(articleIds?: string[]): { content: string; count: number } {
    const items = articleIds?.length
      ? articleIds.map((id) => this.articles.get(id)).filter((item): item is Article => Boolean(item))
      : this.articles.all()
    const blocks = items.map((article) => {
      const lines: string[] = ['TY  - JOUR']
      const push = (tag: string, value?: string | null): void => {
        if (value) lines.push(`${tag}  - ${value.replace(/\r?\n/g, ' ')}`)
      }
      push('TI', article.title)
      for (const author of article.authors) push('AU', author.name)
      push('JO', article.journalTitle)
      push('PY', article.year ? String(article.year) : undefined)
      push('VL', article.volume)
      push('IS', article.issue)
      if (article.pages) {
        const [start, end] = article.pages.split(/[-–]/)
        push('SP', start?.trim())
        push('EP', end?.trim())
      }
      push('DO', article.doi)
      push('UR', article.url)
      push('AB', article.abstract)
      for (const keyword of article.keywords) push('KW', keyword)
      push('ER', '')
      return lines.join('\n')
    })
    return { content: `${blocks.join('\n\n')}\n`, count: items.length }
  }

  importRis(text: string): IoResult {
    const records: Array<Record<string, string[]>> = []
    let current: Record<string, string[]> = {}
    for (const rawLine of text.split(/\r?\n/)) {
      const match = rawLine.match(/^([A-Z][A-Z0-9])  - ?(.*)$/)
      if (!match) {
        if (rawLine.trim() && Object.keys(current).length) {
          const keys = Object.keys(current)
          const last = keys[keys.length - 1]
          current[last][current[last].length - 1] += ` ${rawLine.trim()}`
        }
        continue
      }
      const [, tag, value] = match
      if (tag === 'ER') {
        if (Object.keys(current).length) records.push(current)
        current = {}
        continue
      }
      current[tag] = current[tag] ?? []
      current[tag].push(value.trim())
    }
    if (Object.keys(current).length) records.push(current)
    let imported = 0
    let skipped = 0
    const errors: string[] = []
    for (const record of records) {
      try {
        const title = record.TI?.[0] ?? record.T1?.[0]
        if (!title) {
          skipped += 1
          continue
        }
        const authors = [...(record.AU ?? []), ...(record.A1 ?? [])]
        const year = Number((record.PY?.[0] ?? record.Y1?.[0] ?? '').match(/\d{4}/)?.[0])
        const startPage = record.SP?.[0]
        const endPage = record.EP?.[0]
        const parsed = {
          title: normalizeWhitespace(title),
          authors,
          journalTitle: record.JO?.[0] ?? record.JF?.[0] ?? record.T2?.[0],
          year: Number.isFinite(year) ? year : undefined,
          volume: record.VL?.[0],
          issue: record.IS?.[0],
          pages: startPage ? (endPage ? `${startPage}-${endPage}` : startPage) : undefined,
          doi: record.DO?.[0],
          abstract: record.AB?.[0],
          url: record.UR?.[0],
          keywords: record.KW ?? [],
          source: 'import' as const
        }
        const existing = this.articles.findDuplicate(parsed)
        if (existing) {
          this.articles.mergeMissing(existing.id, parsed, { inLibrary: true })
          skipped += 1
        } else {
          this.articles.create({ ...parsed, inLibrary: true })
          imported += 1
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    return { imported, skipped, errors, count: records.length }
  }

  exportCsv(articleIds?: string[]): { content: string; count: number } {
    const items = articleIds?.length
      ? articleIds.map((id) => this.articles.get(id)).filter((item): item is Article => Boolean(item))
      : this.articles.all()
    const header = [
      'title',
      'authors',
      'journal',
      'year',
      'volume',
      'issue',
      'pages',
      'doi',
      'url',
      'abstract',
      'keywords',
      'categories',
      'source',
      'read_status',
      'starred',
      'added_at'
    ]
    const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
    const rows = items.map((article) =>
      [
        article.title,
        article.authors.map((author) => author.name).join('; '),
        article.journalTitle ?? '',
        article.year ? String(article.year) : '',
        article.volume ?? '',
        article.issue ?? '',
        article.pages ?? '',
        article.doi ?? '',
        article.url ?? '',
        article.abstract ?? '',
        article.keywords.join('; '),
        article.categories.map((category) => category.categoryPath).join('; '),
        article.source,
        article.readStatus,
        article.starred ? 'yes' : 'no',
        article.createdAt
      ]
        .map(escape)
        .join(',')
    )
    return { content: `\uFEFF${[header.join(','), ...rows].join('\r\n')}\r\n`, count: items.length }
  }

  exportJson(): { content: string; count: number } {
    const items = this.articles.all()
    const categories = this.categories.listFlat()
    const payload = {
      app: 'LiteratureX',
      kind: 'metadata',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: categories.map((category) => ({
        id: category.id,
        parentId: category.parentId,
        name: category.name,
        description: category.description,
        instructions: category.instructions,
        color: category.color,
        priority: category.priority,
        keywords: category.keywords.map((keyword) => ({ keyword: keyword.keyword, kind: keyword.kind, weight: keyword.weight }))
      })),
      articles: items.map((article) => ({
        title: article.title,
        doi: article.doi,
        journalTitle: article.journalTitle,
        publisher: article.publisher,
        publicationDate: article.publicationDate,
        year: article.year,
        volume: article.volume,
        issue: article.issue,
        pages: article.pages,
        abstract: article.abstract,
        url: article.url,
        articleType: article.articleType,
        keywords: article.keywords,
        authors: article.authors.map((author) => author.name),
        readStatus: article.readStatus,
        starred: article.starred,
        aiSummary: article.aiSummary,
        categories: article.categories.map((category) => category.categoryPath)
      }))
    }
    return { content: JSON.stringify(payload, null, 2), count: items.length }
  }

  importJson(text: string): IoResult {
    let payload: {
      articles?: Array<{
        title?: string
        doi?: string
        journalTitle?: string
        publisher?: string
        publicationDate?: string
        year?: number
        volume?: string
        issue?: string
        pages?: string
        abstract?: string
        url?: string
        articleType?: string
        keywords?: string[]
        authors?: string[]
        aiSummary?: string
        categories?: string[]
      }>
      categories?: Array<{
        id?: string
        parentId?: string | null
        name: string
        description?: string
        instructions?: string
        color?: string
        priority?: number
        keywords?: Array<{ keyword: string; kind?: 'keyword' | 'synonym'; weight?: number }>
      }>
    }
    try {
      payload = JSON.parse(text)
    } catch {
      return { imported: 0, skipped: 0, errors: ['The JSON file is not valid JSON'] }
    }
    const errors: string[] = []
    const pathToId = new Map<string, string>()
    for (const category of this.categories.listFlat()) pathToId.set(category.path ?? category.name, category.id)
    const importedCategories = payload.categories ?? []
    const idMap = new Map<string, string>()
    const byId = new Map(importedCategories.filter((item) => item.id).map((item) => [item.id as string, item]))
    const resolvePath = (category: (typeof importedCategories)[number], seen = new Set<string>()): string => {
      if (!category.parentId) return category.name
      const parent = byId.get(category.parentId)
      if (!parent || seen.has(parent.id as string)) return category.name
      seen.add(parent.id as string)
      return `${resolvePath(parent, seen)} / ${category.name}`
    }
    const ensureCategory = (category: (typeof importedCategories)[number]): string | null => {
      if (category.id && idMap.has(category.id)) return idMap.get(category.id) as string
      const pathKey = resolvePath(category)
      const existingId = pathToId.get(pathKey)
      if (existingId) {
        if (category.id) idMap.set(category.id, existingId)
        return existingId
      }
      let parentId: string | null = null
      if (category.parentId) {
        const parent = byId.get(category.parentId)
        if (parent) parentId = ensureCategory(parent)
      }
      const created = this.categories.create({
        name: category.name,
        parentId,
        description: category.description,
        instructions: category.instructions,
        color: category.color,
        priority: category.priority,
        keywords: category.keywords?.map((keyword) => ({
          keyword: keyword.keyword,
          kind: keyword.kind,
          weight: keyword.weight
        }))
      })
      pathToId.set(pathKey, created.id)
      if (category.id) idMap.set(category.id, created.id)
      return created.id
    }
    for (const category of importedCategories) ensureCategory(category)
    let imported = 0
    let skipped = 0
    for (const item of payload.articles ?? []) {
      try {
        if (!item.title) {
          skipped += 1
          continue
        }
        const input = {
          title: item.title,
          doi: item.doi,
          journalTitle: item.journalTitle,
          publisher: item.publisher,
          publicationDate: item.publicationDate,
          year: item.year,
          volume: item.volume,
          issue: item.issue,
          pages: item.pages,
          abstract: item.abstract,
          url: item.url,
          articleType: item.articleType,
          keywords: item.keywords ?? [],
          authors: item.authors ?? [],
          source: 'import' as const
        }
        const existing = this.articles.findDuplicate(input)
        let articleId: string
        if (existing) {
          this.articles.mergeMissing(existing.id, input, { inLibrary: true })
          articleId = existing.id
          skipped += 1
        } else {
          const created = this.articles.create({ ...input, inLibrary: true })
          articleId = created.id
          imported += 1
        }
        if (item.aiSummary) this.articles.setAiSummary(articleId, item.aiSummary)
        for (const path of item.categories ?? []) {
          const categoryId = pathToId.get(path)
          if (categoryId) this.articles.addManualCategory(articleId, categoryId, 'Imported from metadata backup')
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    return { imported, skipped, errors, count: payload.articles?.length ?? 0 }
  }
}

export function categoryPath(category: Category): string {
  return category.path ?? category.name
}
