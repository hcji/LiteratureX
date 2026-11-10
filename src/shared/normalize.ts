const DOI_PREFIX = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g

export function normalizeDoi(input?: string | null): string | null {
  if (!input) return null
  let value = input.trim()
  if (!value) return null
  value = value.replace(DOI_PREFIX, '')
  value = value.replace(/^doi:\s*/i, '')
  const match = value.match(DOI_RE)
  if (!match) return null
  return match[0].replace(/[.,;:)\]}'"]+$/, '').toLowerCase()
}

export function extractDois(text?: string | null): string[] {
  if (!text) return []
  const found = text.match(DOI_RE) ?? []
  const unique = new Set<string>()
  for (const raw of found) {
    const doi = normalizeDoi(raw)
    if (doi) unique.add(doi)
  }
  return [...unique]
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
  )
}

export function normalizeAuthorName(name: string): string {
  return normalizeTitle(name)
}

export function normalizeJournalName(name?: string | null): string {
  if (!name) return ''
  return normalizeTitle(
    name
      .replace(/\s*[-–|:]\s*(rss|atom|feed|latest articles?|current issue|online first).*$/i, '')
      .replace(/\s*\(.*?\)\s*$/, '')
  )
}

export function makeDedupKey(input: {
  title: string
  journalTitle?: string | null
  year?: number | null
}): string {
  const title = normalizeTitle(input.title)
  if (!title) return ''
  return `${title}|${normalizeJournalName(input.journalTitle)}|${input.year ?? ''}`
}

export function stripHtml(html?: string | null): string {
  if (!html) return ''
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
  )
}

export function parseDateLoose(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    const yearMatch = value.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) return `${yearMatch[0]}-01-01`
    return null
  }
  return date.toISOString()
}

export function yearFromDate(value?: string | null): number | null {
  if (!value) return null
  const match = value.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function similarity(a: string, b: string): number {
  const left = normalizeTitle(a)
  const right = normalizeTitle(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  const jaccard = union === 0 ? 0 : intersection / union
  const prefix = left.startsWith(right) || right.startsWith(left) ? 0.15 : 0
  return Math.min(1, jaccard + prefix)
}

export function isCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value)
}

export function stripTags(value: string): string {
  return value.replace(/<\/?mark>/g, '')
}
