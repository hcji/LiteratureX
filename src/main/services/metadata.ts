import { normalizeDoi, similarity, stripHtml, yearFromDate } from '@shared/normalize'
import type { CacheRepo } from '../db/repositories/cache'
import type { SettingsService } from './settings'
import type { HttpService } from './http'

export interface MetadataRecord {
  title?: string
  authors?: string[]
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
  issn?: string
  source: string
}

export interface EnrichResult {
  record: MetadataRecord
  sources: string[]
  confidence: Record<string, number>
}

interface CrossrefWork {
  message: {
    DOI?: string
    title?: string[]
    author?: Array<{ given?: string; family?: string; name?: string }>
    'container-title'?: string[]
    publisher?: string
    issued?: { 'date-parts'?: number[][] }
    'published-print'?: { 'date-parts'?: number[][] }
    'published-online'?: { 'date-parts'?: number[][] }
    volume?: string
    issue?: string
    page?: string
    abstract?: string
    URL?: string
    type?: string
    subject?: string[]
    ISSN?: string[]
  }
}

interface OpenAlexWork {
  id?: string
  doi?: string
  title?: string
  display_name?: string
  publication_year?: number
  publication_date?: string
  primary_location?: {
    source?: { display_name?: string; publisher?: string; issn_l?: string; issn?: string[] }
    landing_page_url?: string
    pdf_url?: string
  }
  best_oa_location?: { landing_page_url?: string; pdf_url?: string; is_oa?: boolean }
  locations?: Array<{ landing_page_url?: string; pdf_url?: string; is_oa?: boolean }>
  open_access?: { is_oa?: boolean; oa_url?: string }
  authorships?: Array<{ author?: { display_name?: string } }>
  abstract_inverted_index?: Record<string, number[]>
  type?: string
  keywords?: Array<{ display_name?: string }>
}

interface SemanticScholarPaper {
  title?: string
  abstract?: string
  authors?: Array<{ name?: string }>
  year?: number
  venue?: string
  publicationDate?: string
  externalIds?: { DOI?: string }
  url?: string
  journal?: { name?: string; volume?: string; pages?: string }
  publicationTypes?: string[]
  fieldsOfStudy?: string[]
}

interface UnpaywallResponse {
  best_oa_location?: { url_for_pdf?: string; url?: string }
  oa_locations?: Array<{ url_for_pdf?: string; url?: string }>
}

function dateFromParts(parts?: number[][]): string | undefined {
  const value = parts?.[0]
  if (!value?.length) return undefined
  const [year, month = 1, day = 1] = value
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function joinAuthors(authors?: Array<{ given?: string; family?: string; name?: string }>): string[] | undefined {
  if (!authors?.length) return undefined
  const names = authors
    .map((author) => [author.given, author.family].filter(Boolean).join(' ').trim() || author.name || '')
    .filter(Boolean)
  return names.length ? names : undefined
}

function reconstructAbstract(index?: Record<string, number[]>): string | undefined {
  if (!index) return undefined
  const positions: Array<[number, string]> = []
  for (const [word, positionList] of Object.entries(index)) {
    for (const position of positionList) positions.push([position, word])
  }
  if (!positions.length) return undefined
  positions.sort((a, b) => a[0] - b[0])
  return positions.map((item) => item[1]).join(' ')
}

export class MetadataService {
  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheRepo,
    private readonly settings: SettingsService
  ) {}

  private contactEmail(): string {
    return this.settings.get().rss.contactEmail.trim()
  }

  private mailtoParam(): string {
    const email = this.contactEmail()
    return email ? `&mailto=${encodeURIComponent(email)}` : ''
  }

  async lookupDoi(doiInput: string): Promise<EnrichResult | null> {
    const doi = normalizeDoi(doiInput)
    if (!doi) return null
    const cached = this.cache.get<EnrichResult>(`doi:${doi}`, 30 * 24 * 60 * 60 * 1000)
    if (cached) return cached
    const sources: string[] = []
    const confidence: Record<string, number> = {}
    const state: { merged: MetadataRecord | null } = { merged: null }
    const merge = (record: MetadataRecord, weight: number): void => {
      sources.push(record.source)
      if (!state.merged) {
        state.merged = { ...record }
        for (const key of ['title', 'authors', 'abstract', 'journalTitle', 'publicationDate', 'doi']) {
          if ((record as unknown as Record<string, unknown>)[key]) confidence[key] = weight
        }
        return
      }
      state.merged = this.mergeRecords(state.merged, record, confidence, weight)
    }
    try {
      const crossref = await this.crossrefDoi(doi)
      if (crossref) merge(crossref, 1)
    } catch {
      /* provider unavailable */
    }
    try {
      const openalex = await this.openalexDoi(doi)
      if (openalex) merge(openalex, 0.85)
    } catch {
      /* provider unavailable */
    }
    if (!state.merged || !state.merged.abstract || !state.merged.authors) {
      try {
        const scholar = await this.semanticScholarDoi(doi)
        if (scholar) merge(scholar, 0.75)
      } catch {
        /* provider unavailable */
      }
    }
    if (state.merged && (!state.merged.abstract || !state.merged.authors)) {
      try {
        const pubmed = await this.pubmedDoi(doi)
        if (pubmed) merge(pubmed, 0.7)
      } catch {
        /* provider unavailable */
      }
    }
    const merged: MetadataRecord | null = state.merged
    if (!merged) return null
    merged.doi = merged.doi ?? doi
    const result: EnrichResult = { record: merged, sources, confidence }
    this.cache.set(`doi:${doi}`, result)
    return result
  }

  async lookupTitle(title: string, journalTitle?: string | null): Promise<EnrichResult | null> {
    const trimmed = title.trim()
    if (!trimmed) return null
    const cached = this.cache.get<EnrichResult>(`title:${trimmed.toLowerCase()}`, 7 * 24 * 60 * 60 * 1000)
    if (cached) return cached
    try {
      const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(trimmed)}&rows=5&select=DOI,title,author,container-title,issued,volume,issue,page,abstract,URL,type${this.mailtoParam()}`
      const data = await this.http.getJson<{ message: { items: CrossrefWork['message'][] } }>(url, {
        timeoutMs: 20000
      })
      const items = data?.message.items ?? []
      if (!items.length) return null
      const scored = items
        .map((item) => ({
          item,
          score: similarity(item.title?.[0] ?? '', trimmed) + (journalTitle && similarity(item['container-title']?.[0] ?? '', journalTitle) > 0.6 ? 0.05 : 0)
        }))
        .sort((a, b) => b.score - a.score)
      const best = scored[0]
      if (!best || best.score < 0.55 || !best.item.DOI) return null
      const enriched = await this.lookupDoi(best.item.DOI)
      if (enriched) this.cache.set(`title:${trimmed.toLowerCase()}`, enriched)
      return enriched
    } catch {
      return null
    }
  }

  private mergeRecords(
    base: MetadataRecord,
    incoming: MetadataRecord,
    confidence: Record<string, number>,
    weight: number
  ): MetadataRecord {
    const result: MetadataRecord = { ...base }
    const fields: Array<keyof MetadataRecord> = [
      'title',
      'authors',
      'journalTitle',
      'publisher',
      'publicationDate',
      'year',
      'volume',
      'issue',
      'pages',
      'abstract',
      'url',
      'articleType',
      'keywords',
      'issn',
      'doi'
    ]
    for (const field of fields) {
      const value = incoming[field]
      const empty = result[field] === undefined || result[field] === null || result[field] === '' || (Array.isArray(result[field]) && (result[field] as unknown[]).length === 0)
      if (empty && value !== undefined && value !== null && value !== '') {
        ;(result as unknown as Record<string, unknown>)[field] = value
        confidence[field] = weight
      }
    }
    if (incoming.abstract && base.abstract && incoming.abstract.length > base.abstract.length * 1.5) {
      result.abstract = incoming.abstract
      confidence.abstract = weight
    }
    if (incoming.authors?.length && (!base.authors || incoming.authors.length > base.authors.length)) {
      result.authors = incoming.authors
      confidence.authors = weight
    }
    return result
  }

  private async crossrefDoi(doi: string): Promise<MetadataRecord | null> {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${this.contactEmail() ? `?mailto=${encodeURIComponent(this.contactEmail())}` : ''}`
    const data = await this.http.getJson<CrossrefWork>(url, { timeoutMs: 20000 })
    if (!data?.message) return null
    const message = data.message
    const date =
      dateFromParts(message['published-print']?.['date-parts']) ??
      dateFromParts(message['published-online']?.['date-parts']) ??
      dateFromParts(message.issued?.['date-parts'])
    return {
      title: message.title?.[0] ? stripHtml(message.title[0]) : undefined,
      authors: joinAuthors(message.author),
      doi: normalizeDoi(message.DOI ?? doi) ?? doi,
      journalTitle: message['container-title']?.[0],
      publisher: message.publisher,
      publicationDate: date,
      year: yearFromDate(date) ?? undefined,
      volume: message.volume,
      issue: message.issue,
      pages: message.page,
      abstract: message.abstract ? stripHtml(message.abstract) : undefined,
      url: message.URL,
      articleType: message.type,
      keywords: message.subject,
      issn: message.ISSN?.[0],
      source: 'crossref'
    }
  }

  private async openalexDoi(doi: string): Promise<MetadataRecord | null> {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${this.contactEmail() ? `?mailto=${encodeURIComponent(this.contactEmail())}` : ''}`
    const data = await this.http.getJson<OpenAlexWork>(url, { timeoutMs: 20000 })
    if (!data) return null
    return {
      title: data.title ?? data.display_name,
      authors: data.authorships
        ?.map((item) => item.author?.display_name ?? '')
        .filter((name): name is string => Boolean(name)),
      doi: normalizeDoi(data.doi ?? doi) ?? doi,
      journalTitle: data.primary_location?.source?.display_name,
      publisher: data.primary_location?.source?.publisher,
      publicationDate: data.publication_date,
      year: data.publication_year,
      abstract: reconstructAbstract(data.abstract_inverted_index),
      url: data.primary_location?.landing_page_url ?? data.id,
      articleType: data.type,
      keywords: data.keywords?.map((item) => item.display_name).filter((item): item is string => Boolean(item)),
      issn: data.primary_location?.source?.issn_l ?? data.primary_location?.source?.issn?.[0],
      source: 'openalex'
    }
  }

  private async semanticScholarDoi(doi: string): Promise<MetadataRecord | null> {
    const fields =
      'title,abstract,authors,year,venue,publicationDate,externalIds,url,journal,publicationTypes,fieldsOfStudy'
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${fields}`
    const data = await this.http.getJson<SemanticScholarPaper>(url, { timeoutMs: 20000, retries: 1 })
    if (!data) return null
    return {
      title: data.title,
      authors: data.authors?.map((item) => item.name ?? '').filter((name): name is string => Boolean(name)),
      doi: normalizeDoi(data.externalIds?.DOI ?? doi) ?? doi,
      journalTitle: data.journal?.name ?? data.venue,
      publicationDate: data.publicationDate,
      year: data.year,
      volume: data.journal?.volume,
      pages: data.journal?.pages,
      abstract: data.abstract,
      url: data.url,
      articleType: data.publicationTypes?.[0],
      keywords: data.fieldsOfStudy,
      source: 'semantic-scholar'
    }
  }

  private async pubmedDoi(doi: string): Promise<MetadataRecord | null> {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(`${doi}[DOI]`)}&retmode=json&retmax=1`
    const search = await this.http.getJson<{ esearchresult?: { idlist?: string[] } }>(searchUrl, { timeoutMs: 15000 })
    const pmid = search?.esearchresult?.idlist?.[0]
    if (!pmid) return null
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
    const summary = await this.http.getJson<{ result?: Record<string, unknown> }>(summaryUrl, { timeoutMs: 15000 })
    const item = summary?.result?.[pmid] as
      | {
          title?: string
          authors?: Array<{ name?: string }>
          fulljournalname?: string
          source?: string
          pubdate?: string
          volume?: string
          issue?: string
          pages?: string
          elocationid?: string
        }
      | undefined
    if (!item) return null
    let abstract: string | undefined
    try {
      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`
      const xml = await this.http.getText(fetchUrl, { timeoutMs: 20000 })
      if (xml) {
        const matches = [...xml.text.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)]
        if (matches.length) abstract = stripHtml(matches.map((match) => match[1]).join(' '))
      }
    } catch {
      /* abstract is optional */
    }
    return {
      title: item.title ? stripHtml(item.title) : undefined,
      authors: item.authors?.map((author) => author.name ?? '').filter((name): name is string => Boolean(name)),
      journalTitle: item.fulljournalname ?? item.source,
      publicationDate: item.pubdate,
      year: yearFromDate(item.pubdate) ?? undefined,
      volume: item.volume,
      issue: item.issue,
      pages: item.pages ?? item.elocationid,
      abstract,
      source: 'pubmed',
      doi
    } as MetadataRecord
  }

  async unpaywallPdf(doiInput: string): Promise<string | null> {
    const doi = normalizeDoi(doiInput)
    if (!doi) return null
    const cached = this.cache.get<{ url: string | null }>(`unpaywall:${doi}`, 7 * 24 * 60 * 60 * 1000)
    if (cached) return cached.url
    let url: string | null = null
    let landingUrl: string | null = null
    const email = this.contactEmail()
    if (email) {
      try {
        const data = await this.http.getJson<UnpaywallResponse>(
          `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,
          { timeoutMs: 20000 }
        )
        const candidates = [data?.best_oa_location, ...(data?.oa_locations ?? [])]
        url =
          candidates
            .map((item) => item?.url_for_pdf)
            .find((value): value is string => Boolean(value && /^https?:\/\//i.test(value))) ?? null
        landingUrl =
          candidates
            .map((item) => item?.url)
            .find((value): value is string => Boolean(value && /^https?:\/\//i.test(value))) ?? null
      } catch {
        /* try OpenAlex below */
      }
    }
    if (!url) {
      try {
        const work = await this.http.getJson<OpenAlexWork>(
          `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${email ? `?mailto=${encodeURIComponent(email)}` : ''}`
        )
        const locations = [work?.best_oa_location, work?.primary_location, ...(work?.locations ?? [])]
        url =
          locations
            .map((item) => item?.pdf_url)
            .find((value): value is string => Boolean(value && /^https?:\/\//i.test(value))) ??
          (work?.open_access?.oa_url && /^https?:\/\/.*\.pdf($|\?)/i.test(work.open_access.oa_url)
            ? work.open_access.oa_url
            : null)
      } catch {
        /* no open-access location available */
      }
    }
    if (!url) url = landingUrl
    this.cache.set(`unpaywall:${doi}`, { url })
    return url
  }

  async enrich(input: {
    title?: string | null
    doi?: string | null
    journalTitle?: string | null
    abstract?: string | null
    authors?: string[]
    year?: number | null
  }): Promise<EnrichResult | null> {
    let result: EnrichResult | null = null
    if (input.doi) result = await this.lookupDoi(input.doi)
    if (!result && input.title) {
      result = await this.lookupTitle(input.title, input.journalTitle)
    }
    if (!result) return null
    const record = { ...result.record }
    if (input.title && !record.title) record.title = input.title
    if (input.abstract && (!record.abstract || record.abstract.length < input.abstract.length)) record.abstract = input.abstract
    if (input.authors?.length && !record.authors?.length) record.authors = input.authors
    if (input.journalTitle && !record.journalTitle) record.journalTitle = input.journalTitle
    if (input.year && !record.year) record.year = input.year
    return { ...result, record }
  }
}
