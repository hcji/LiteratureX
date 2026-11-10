import * as cheerio from 'cheerio'
import Parser from 'rss-parser'
import type { DiscoverFeedsResult, FeedCandidate, JournalCandidate } from '@shared/types'
import { normalizeDoi, similarity, stripHtml, yearFromDate } from '@shared/normalize'
import type { HttpService } from './http'
import type { SettingsService } from './settings'

interface CrossrefJournal {
  title?: string
  ISSN?: string[]
  publisher?: string
}

interface CrossrefDateParts {
  'date-parts'?: number[][]
}

interface CrossrefWork {
  DOI?: string
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  published?: CrossrefDateParts
  'published-print'?: CrossrefDateParts
  'published-online'?: CrossrefDateParts
  issued?: CrossrefDateParts
  abstract?: string
  URL?: string
  type?: string
  subject?: string[]
  'container-title'?: string[]
  link?: Array<{ URL?: string; 'content-type'?: string }>
}

interface OpenAlexSource {
  display_name?: string
  issn_l?: string
  issn?: string[]
  homepage_url?: string
  host_organization_name?: string
  works_count?: number
}

export interface ParsedFeedItem {
  title?: string
  link?: string
  isoDate?: string
  pubDate?: string
  updated?: string
  creator?: string
  author?: string
  'dc:creator'?: string
  contentSnippet?: string
  content?: string
  summary?: string
  description?: string
  guid?: string
  id?: string
  categories?: string[]
  enclosure?: { url?: string; type?: string; length?: string }
  doi?: string
  'prism:doi'?: string
  'dc:identifier'?: string
}

export interface ParsedFeed {
  title?: string
  description?: string
  link?: string
  items: ParsedFeedItem[]
}

interface CandidateSeed {
  url: string
  source: string
  priority: number
}

const ISSN_RE = /^\d{4}-\d{3}[\dXx]$/
const CROSSREF_FEED_PREFIX = 'crossref://journal/'

export function crossrefFeedUrl(issn: string): string {
  return `${CROSSREF_FEED_PREFIX}${normalizeIssn(issn) ?? issn.trim()}`
}

export function crossrefIssnFromFeedUrl(url: string): string | null {
  if (!url.toLowerCase().startsWith(CROSSREF_FEED_PREFIX)) return null
  return normalizeIssn(url.slice(CROSSREF_FEED_PREFIX.length))
}

function issnDigits(value?: string | null): string {
  return (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function crossrefWorkDate(work: CrossrefWork): string | null {
  for (const key of ['published', 'published-online', 'published-print', 'issued'] as const) {
    const parts = work[key]?.['date-parts']?.[0]
    if (parts?.length && parts[0]) {
      const [year, month = 1, day = 1] = parts
      const date = new Date(Date.UTC(year, Math.max(0, month - 1), Math.max(1, day)))
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
  }
  return null
}

function crossrefWorkAuthors(work: CrossrefWork): string {
  return (work.author ?? [])
    .map((author) => [author.given, author.family].filter(Boolean).join(' ') || author.name || '')
    .filter(Boolean)
    .join('; ')
}

function crossrefWorkToItem(work: CrossrefWork): ParsedFeedItem {
  const pdf = (work.link ?? []).find(
    (link) => /pdf/i.test(link['content-type'] ?? '') || /\.pdf($|\?)/i.test(link.URL ?? '')
  )
  return {
    title: work.title?.[0] ?? '',
    link: work.URL ?? (work.DOI ? `https://doi.org/${work.DOI}` : undefined),
    isoDate: crossrefWorkDate(work) ?? undefined,
    creator: crossrefWorkAuthors(work) || undefined,
    contentSnippet: work.abstract ?? undefined,
    categories: work.subject ?? [],
    guid: work.DOI,
    doi: work.DOI,
    enclosure: pdf?.URL ? { url: pdf.URL, type: pdf['content-type'] ?? 'application/pdf' } : undefined
  }
}


export function normalizeIssn(value?: string | null): string | null {
  if (!value) return null
  const match = value.trim().match(/\b(\d{4})-?(\d{3}[\dXx])\b/)
  if (!match) return null
  return `${match[1]}-${match[2].toUpperCase()}`
}

export class DiscoveryService {
  private readonly parser = new Parser<Record<string, unknown>, Record<string, unknown>>({
    timeout: 20000,
    headers: {
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': 'LiteratureX/0.1 (journal feed discovery)'
    },
    customFields: {
      item: ['doi', 'dc:creator', 'prism:doi', 'dc:identifier', 'citation_doi', 'author', 'authors']
    }
  })

  constructor(
    private readonly http: HttpService,
    private readonly settings: SettingsService
  ) {}

  async searchJournals(query: string): Promise<JournalCandidate[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const issn = normalizeIssn(trimmed)
    const candidates: JournalCandidate[] = []
    const mailto = this.contactEmail.trim()
    const mailtoQuery = mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''
    const mailtoOnly = mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''
    let crossrefError: string | null = null
    let openalexError: string | null = null

    if (issn) {
      try {
        const crossref = await this.http.getJson<{ message: CrossrefJournal }>(
          `https://api.crossref.org/journals/${encodeURIComponent(issn)}${mailtoOnly}`
        )
        if (crossref?.message) {
          candidates.push({
            title: crossref.message.title ?? issn,
            issn: normalizeIssn(crossref.message.ISSN?.[0]) ?? issn,
            eissn: normalizeIssn(crossref.message.ISSN?.[1]) ?? null,
            publisher: crossref.message.publisher,
            homepageUrl: null,
            source: 'crossref',
            score: 1
          })
        }
      } catch (error) {
        crossrefError = error instanceof Error ? error.message : String(error)
      }
      try {
        const openalex = await this.http.getJson<{ results: OpenAlexSource[] }>(
          `https://api.openalex.org/sources?filter=issn:${encodeURIComponent(issn)}&per-page=5${mailtoQuery}`
        )
        for (const source of openalex?.results ?? []) {
          candidates.push({
            title: source.display_name ?? issn,
            issn: normalizeIssn(source.issn_l ?? source.issn?.[0]) ?? issn,
            eissn: normalizeIssn(source.issn?.[1]) ?? null,
            publisher: source.host_organization_name,
            homepageUrl: source.homepage_url,
            source: 'openalex',
            score: 0.99
          })
        }
      } catch (error) {
        openalexError = error instanceof Error ? error.message : String(error)
      }
    } else {
      try {
        const crossref = await this.http.getJson<{ message: { items: CrossrefJournal[] } }>(
          `https://api.crossref.org/journals?query=${encodeURIComponent(trimmed)}&rows=12${mailtoQuery}`
        )
        for (const item of crossref?.message.items ?? []) {
          const title = item.title ?? ''
          candidates.push({
            title,
            issn: normalizeIssn(item.ISSN?.[0]),
            eissn: normalizeIssn(item.ISSN?.[1]),
            publisher: item.publisher,
            homepageUrl: null,
            source: 'crossref',
            score: similarity(title, trimmed)
          })
        }
      } catch (error) {
        crossrefError = error instanceof Error ? error.message : String(error)
      }
      try {
        const openalex = await this.http.getJson<{ results: OpenAlexSource[] }>(
          `https://api.openalex.org/sources?search=${encodeURIComponent(trimmed)}&per-page=12${mailtoQuery}`
        )
        for (const source of openalex?.results ?? []) {
          const title = source.display_name ?? ''
          candidates.push({
            title,
            issn: normalizeIssn(source.issn_l ?? source.issn?.[0]),
            eissn: normalizeIssn(source.issn?.[1]),
            publisher: source.host_organization_name,
            homepageUrl: source.homepage_url,
            source: 'openalex',
            score: similarity(title, trimmed) + (source.homepage_url ? 0.04 : 0)
          })
        }
      } catch (error) {
        openalexError = error instanceof Error ? error.message : String(error)
      }
    }

    const merged = new Map<string, JournalCandidate>()
    for (const candidate of candidates) {
      if (!candidate.title) continue
      const key = candidate.issn ?? candidate.title.toLowerCase()
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, candidate)
        continue
      }
      merged.set(key, {
        ...existing,
        homepageUrl: existing.homepageUrl ?? candidate.homepageUrl,
        publisher: existing.publisher ?? candidate.publisher,
        eissn: existing.eissn ?? candidate.eissn,
        score: Math.max(existing.score, candidate.score) + 0.01
      })
    }
    const results = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 12)
    if (!results.length && crossrefError && openalexError) {
      throw new Error(`Journal search providers are unavailable (${crossrefError}; ${openalexError})`)
    }
    return results
  }

  async discoverFeeds(journal: JournalCandidate): Promise<DiscoverFeedsResult> {
    const notes: string[] = []
    const seeds = new Map<string, CandidateSeed>()
    const add = (url: string, source: string, priority: number): void => {
      try {
        const parsed = new URL(url)
        if (!/^https?:$/.test(parsed.protocol)) return
        parsed.hash = ''
        const clean = parsed.toString()
        if (!seeds.has(clean)) seeds.set(clean, { url: clean, source, priority })
      } catch {
        /* invalid URL */
      }
    }

    if (journal.homepageUrl) {
      const discovered = await this.htmlFeedLinks(journal.homepageUrl)
      for (const url of discovered.links) add(url, 'website-autodiscovery', 100)
      if (discovered.error) {
        notes.push(`The journal website could not be read (${discovered.error}); trying publisher feed patterns instead.`)
      } else if (!discovered.links.length) {
        notes.push('No RSS autodiscovery link was found on the journal website.')
      }
    } else {
      notes.push('No journal homepage was available from metadata providers; trying publisher feed patterns.')
    }

    for (const seed of this.publisherPatterns(journal)) add(seed.url, seed.source, seed.priority)

    const base = (() => {
      try {
        return journal.homepageUrl ? new URL(journal.homepageUrl) : null
      } catch {
        return null
      }
    })()
    if (base) {
      const origin = base.origin
      for (const path of ['/rss', '/feed', '/rss.xml', '/feed.xml', '/atom.xml', '/feeds/all.atom.xml']) {
        add(`${origin}${path}`, 'guessed-pattern', 20)
      }
    }

    const limited = [...seeds.values()].slice(0, 18)
    const candidates = await this.validateCandidates(limited)
    const valid = candidates
      .filter((candidate) => !candidate.error && candidate.itemCount > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
    const failed = candidates.filter((candidate) => candidate.error)
    if (!valid.length) {
      const fallback = await this.crossrefFeedCandidate(journal)
      if (fallback) {
        valid.push(fallback)
        notes.push(
          "No publisher RSS/Atom feed could be validated. A Crossref-based article feed is offered instead; it contains bibliographic metadata rather than the publisher's own RSS feed."
        )
        if (failed.length) notes.push(`${failed.length} candidate RSS URL(s) could not be fetched or parsed.`)
      } else {
        notes.push(
          'No working RSS/Atom feed was detected automatically. Some publishers do not publish RSS; you can paste a feed URL manually.'
        )
        if (failed.length) notes.push(`${failed.length} candidate feed URL(s) could not be parsed.`)
      }
    } else if (valid.length > 1) {
      notes.push('Multiple feeds were found. Choose the one that matches the journal edition you follow.')
    }
    return { journal, candidates: valid, notes }
  }

  async validateFeedUrl(url: string): Promise<FeedCandidate> {
    const crossrefIssn = crossrefIssnFromFeedUrl(url)
    if (crossrefIssn) {
      try {
        const parsed = await this.fetchCrossrefFeed(crossrefIssn, 20)
        const items = parsed.items.filter((item) => Boolean(item.title))
        if (!items.length) {
          return {
            url,
            feedTitle: parsed.title || crossrefIssn,
            type: 'crossref',
            source: 'crossref',
            itemCount: 0,
            latestDate: null,
            sampleTitles: [],
            score: 0,
            error: 'Crossref returned no journal articles'
          }
        }
        return {
          url,
          feedTitle: parsed.title || crossrefIssn,
          type: 'crossref',
          source: 'crossref',
          itemCount: items.length,
          latestDate: items[0]?.isoDate ?? null,
          sampleTitles: items.slice(0, 3).map((item) => stripHtml(item.title ?? '')).filter(Boolean),
          score: 50,
          error: null
        }
      } catch (error) {
        return {
          url,
          feedTitle: crossrefIssn,
          type: 'crossref',
          source: 'crossref',
          itemCount: 0,
          latestDate: null,
          sampleTitles: [],
          score: 0,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
    const [candidate] = await this.validateCandidates([{ url, source: 'manual', priority: 50 }])
    return candidate
  }

  private async validateCandidates(seeds: CandidateSeed[]): Promise<FeedCandidate[]> {
    const results: FeedCandidate[] = []
    const queue = [...seeds]
    const worker = async (): Promise<void> => {
      while (queue.length) {
        const seed = queue.shift()
        if (!seed) return
        results.push(await this.validateOne(seed))
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    return results
  }

  private async validateOne(seed: CandidateSeed): Promise<FeedCandidate> {
    const fallback: FeedCandidate = {
      url: seed.url,
      feedTitle: '',
      type: 'unknown',
      source: seed.source,
      itemCount: 0,
      latestDate: null,
      sampleTitles: [],
      score: seed.priority,
      error: null
    }
    try {
      const fetched = await this.http.getText(seed.url, { timeoutMs: 15000, retries: 1 })
      if (!fetched) return { ...fallback, error: 'Feed returned 404' }
      const text = fetched.text
      const feed = (await this.parser.parseString(text)) as unknown as ParsedFeed
      const items = feed.items ?? []
      if (!items.length) return { ...fallback, error: 'Feed contained no items' }
      const dates = items
        .map((item) => item.isoDate ?? item.pubDate ?? item.updated)
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())
      const latest = dates[0]?.toISOString() ?? null
      const recentBoost = latest ? Math.max(0, 20 - (Date.now() - new Date(latest).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 0
      return {
        url: seed.url,
        feedTitle: stripHtml(feed.title ?? '') || new URL(seed.url).hostname,
        type: /<feed[\s>]/i.test(text) ? 'atom' : 'rss',
        source: seed.source,
        itemCount: items.length,
        latestDate: latest,
        sampleTitles: items
          .slice(0, 3)
          .map((item) => stripHtml(item.title ?? ''))
          .filter(Boolean),
        score: seed.priority + Math.min(30, items.length) + recentBoost,
        error: null
      }
    } catch (error) {
      return { ...fallback, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async htmlFeedLinks(homepageUrl: string): Promise<{ links: string[]; error: string | null }> {
    try {
      const fetched = await this.http.getText(homepageUrl, { timeoutMs: 15000, retries: 1 })
      if (!fetched) return { links: [], error: 'HTTP 404' }
      const $ = cheerio.load(fetched.text)
      const found = new Set<string>()
      const addUrl = (href?: string): void => {
        if (!href) return
        try {
          found.add(new URL(href, homepageUrl).toString())
        } catch {
          /* invalid href */
        }
      }
      $('link[rel~="alternate"]').each((_, element) => {
        const type = ($(element).attr('type') ?? '').toLowerCase()
        if (type.includes('rss') || type.includes('atom') || type.includes('xml')) addUrl($(element).attr('href'))
      })
      $('link[type*="rss"], link[type*="atom"]').each((_, element) => addUrl($(element).attr('href')))
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href') ?? ''
        const label = `${$(element).text()} ${$(element).attr('title') ?? ''} ${href}`.toLowerCase()
        if (/(rss|atom|feed|subscribe)/.test(label) && !/\.(css|js|png|jpg|svg)$/i.test(href)) addUrl(href)
      })
      const links = [...found]
        .filter((url) => !/comments|podcast|jobs|toc-alerts/i.test(url))
        .slice(0, 10)
      return { links, error: null }
    } catch (error) {
      return { links: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  private publisherPatterns(journal: JournalCandidate): CandidateSeed[] {
    const seeds: CandidateSeed[] = []
    const homepage = (() => {
      try {
        return journal.homepageUrl ? new URL(journal.homepageUrl) : null
      } catch {
        return null
      }
    })()
    const host = homepage?.hostname.toLowerCase() ?? ''
    const segments = (homepage?.pathname.split('/') ?? [])
      .filter(Boolean)
      .map((segment) => segment.replace(/\.(html?|php|aspx)$/i, ''))
      .filter((segment) => segment && !/^(index|home|default)$/i.test(segment))
    const publisher = (journal.publisher ?? '').toLowerCase()
    const title = journal.title ?? ''
    const slug = slugify(title)
    const firstPathSlug = segments[0] ?? ''
    const pathSlug = segments[segments.length - 1] ?? ''
    const issnClean = issnDigits(journal.issn)
    const eissnClean = issnDigits(journal.eissn)
    const knownFeeds: Record<string, string[]> = {
      // Plant Physiology (Oxford Academic) publishes its feed under an opaque site id.
      '0032-0889': ['https://academic.oup.com/rss/site_6323/4080.xml']
    }
    const add = (url: string, source = 'publisher-pattern', priority = 70): void => {
      if (!url || url.includes('undefined') || url.includes('//undefined')) return
      seeds.push({ url, source, priority })
    }

    if (host.includes('nature.com') || publisher.includes('nature portfolio') || publisher.includes('springer nature')) {
      const natureSlug = firstPathSlug || pathSlug || slug
      if (natureSlug) add(`https://www.nature.com/${natureSlug}.rss`, 'known-pattern', 95)
    }
    if (publisher.includes('cell press') || host.includes('cell.com')) {
      const trends = /^trends in (.+)$/i.exec(title)
      const cellSlug =
        host.includes('cell.com') && segments.length
          ? segments[0] === 'trends' && segments[1]
            ? `${segments[0]}/${segments[1]}`
            : segments[0]
          : trends
            ? `trends/${slugify(trends[1])}`
            : slug
      if (cellSlug) {
        add(`https://www.cell.com/${cellSlug}/current.rss`, 'known-pattern', 95)
        add(`https://www.cell.com/${cellSlug}/inpress.rss`, 'known-pattern', 85)
      }
    }
    for (const known of [journal.issn, journal.eissn]) {
      const feeds = known ? knownFeeds[known.toUpperCase()] : undefined
      if (feeds) for (const url of feeds) add(url, 'known-pattern', 95)
    }
    if (publisher.includes('elsevier') || host.includes('sciencedirect')) {
      for (const value of [issnClean, eissnClean]) {
        if (value) add(`https://rss.sciencedirect.com/publication/science/${value}`, 'publisher-pattern', 88)
      }
    }
    if (publisher.includes('wiley') || host.includes('wiley.com')) {
      for (const value of [eissnClean, issnClean]) {
        if (value) add(`https://onlinelibrary.wiley.com/feed/${value}/most-recent`, 'publisher-pattern', 85)
      }
    }
    if (publisher.includes('american chemical society') || host.includes('acs.org')) {
      if (pathSlug) add(`https://pubs.acs.org/action/showFeed?type=etoc&feed=rss&jc=${pathSlug}`, 'publisher-pattern', 90)
    }
    if (publisher.includes('mdpi') || host.includes('mdpi.com')) {
      add(`https://www.mdpi.com/rss/journal/${pathSlug || slug}`, 'publisher-pattern', 85)
    }
    if (publisher.includes('frontiers') || host.includes('frontiersin.org')) {
      add(`https://www.frontiersin.org/journals/${pathSlug || slug}/rss`, 'publisher-pattern', 85)
    }
    if (publisher.includes('plos') || host.includes('plos.org')) {
      add(`https://journals.plos.org/${pathSlug || slug}/feed/atom`, 'publisher-pattern', 85)
    }
    if (publisher.includes('springer') && !publisher.includes('nature')) {
      const journalId = segments.find((segment) => /^\d+$/.test(segment)) ?? issnClean
      if (journalId) add(`https://link.springer.com/journal/${journalId}/rss`, 'publisher-pattern', 60)
    }
    if (publisher.includes('taylor') || host.includes('tandfonline.com')) {
      add(`https://www.tandfonline.com/feed/rss/${pathSlug || slug}`, 'publisher-pattern', 55)
    }
    return seeds
  }

  private async crossrefFeedCandidate(journal: JournalCandidate): Promise<FeedCandidate | null> {
    const issn = journal.issn ?? journal.eissn
    if (!issn) return null
    try {
      const parsed = await this.fetchCrossrefFeed(issn, 20)
      const items = parsed.items.filter((item) => Boolean(item.title))
      if (!items.length) return null
      const dates = items
        .map((item) => item.isoDate)
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())
      return {
        url: crossrefFeedUrl(issn),
        feedTitle: journal.title,
        type: 'crossref',
        source: 'crossref',
        itemCount: items.length,
        latestDate: dates[0]?.toISOString() ?? null,
        sampleTitles: items
          .slice(0, 3)
          .map((item) => stripHtml(item.title ?? ''))
          .filter(Boolean),
        score: 10,
        error: null
      }
    } catch {
      return null
    }
  }

  async fetchCrossrefFeed(issn: string, limit = 50): Promise<ParsedFeed> {
    const rows = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100)
    const params = new URLSearchParams({
      rows: String(rows),
      sort: 'published',
      order: 'desc',
      filter: 'type:journal-article',
      select: 'DOI,title,author,published,published-online,published-print,issued,abstract,URL,type,subject,link,container-title'
    })
    const email = this.contactEmail.trim()
    if (email) params.set('mailto', email)
    const payload = await this.http.getJson<{ message?: { items?: CrossrefWork[] } }>(
      `https://api.crossref.org/journals/${encodeURIComponent(normalizeIssn(issn) ?? issn)}/works?${params.toString()}`
    )
    const works = payload?.message?.items ?? []
    const title = works.find((work) => work['container-title']?.[0])?.['container-title']?.[0] ?? ''
    return { title, items: works.map(crossrefWorkToItem) }
  }

  parseFeed(text: string): Promise<ParsedFeed> {
    return this.parser.parseString(text) as unknown as Promise<ParsedFeed>
  }

  mapItemMetadata(item: ParsedFeedItem, feed: ParsedFeed, fallbackJournal?: string | null): {
    title: string
    doi: string | null
    authors: string[]
    abstract: string | null
    url: string | null
    journalTitle: string | null
    publicationDate: string | null
    year: number | null
    articleType: string | null
    keywords: string[]
    pdfUrl: string | null
    guid: string | null
  } {
    const title = stripHtml(item.title ?? '') || 'Untitled'
    const rawDoi =
      item.doi ??
      item['prism:doi'] ??
      item['dc:identifier'] ??
      item.link ??
      item.guid ??
      item.description ??
      item.content ??
      ''
    const doi = normalizeDoi(rawDoi)
    const authorFields: string[] = []
    for (const value of [item.creator, item.author, item['dc:creator']]) {
      if (typeof value === 'string' && value.trim()) authorFields.push(value)
      else if (Array.isArray(value)) authorFields.push(...(value as string[]))
    }
    const authors = [...new Set(authorFields.flatMap((value) => value.split(/\s*(?:;|,| and )\s*/i)).map((value) => value.trim()))].filter(
      (value) => value && value.length < 120
    )
    const abstract = stripHtml(item.contentSnippet ?? item.summary ?? item.content ?? item.description ?? '') || null
    const date = item.isoDate ?? item.pubDate ?? item.updated ?? null
    const keywords = (item.categories ?? []).map((value) => stripHtml(value)).filter(Boolean)
    const enclosureUrl = item.enclosure?.url ?? null
    return {
      title,
      doi,
      authors,
      abstract,
      url: item.link ?? null,
      journalTitle: stripHtml(feed.title ?? '') || fallbackJournal || null,
      publicationDate: date,
      year: yearFromDate(date),
      articleType: keywords[0] ?? null,
      keywords,
      pdfUrl: enclosureUrl && /\.pdf($|\?)/i.test(enclosureUrl) ? enclosureUrl : null,
      guid: item.guid ?? item.id ?? null
    }
  }

  get contactEmail(): string {
    return this.settings.get().rss.contactEmail
  }
}
