import { describe, expect, it } from 'vitest'
import { HttpService } from '../../src/main/services/http'
import { DiscoveryService, crossrefFeedUrl } from '../../src/main/services/discovery'

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Journal</title>
    <item>
      <title>Test article</title>
      <link>https://example.org/article</link>
      <pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

class FakeHttp extends HttpService {
  constructor(
    private readonly jsonHandler: (url: string) => unknown,
    private readonly textHandler: (url: string) => string | null
  ) {
    super((() => Promise.reject(new Error('Network disabled in test'))) as unknown as typeof fetch)
  }

  override async getJson<T>(url: string): Promise<T | null> {
    return (this.jsonHandler(url) as T | null) ?? null
  }

  override async getText(url: string): Promise<{ text: string; response: Response } | null> {
    const text = this.textHandler(url)
    if (text == null) return null
    return { text, response: new Response(text, { status: 200 }) }
  }
}

const settings = { get: () => ({ rss: { contactEmail: '' } }) } as never

describe('journal search', () => {
  it('uses the supported Crossref query endpoint and merges OpenAlex homepage data', async () => {
    const urls: string[] = []
    const http = new FakeHttp(
      (url) => {
        urls.push(url)
        if (url.startsWith('https://api.crossref.org/journals?')) {
          return {
            message: {
              items: [{ title: 'Nature', ISSN: ['0028-0836', '1476-4687'], publisher: 'Nature Portfolio' }]
            }
          }
        }
        if (url.startsWith('https://api.openalex.org/sources?')) {
          return {
            results: [
              {
                display_name: 'Nature',
                issn_l: '0028-0836',
                issn: ['0028-0836', '1476-4687'],
                homepage_url: 'https://www.nature.com/nature/',
                host_organization_name: 'Nature Portfolio'
              }
            ]
          }
        }
        return null
      },
      () => null
    )
    const discovery = new DiscoveryService(http, settings)

    const results = await discovery.searchJournals('Nature')

    expect(results[0]).toMatchObject({
      title: 'Nature',
      issn: '0028-0836',
      homepageUrl: 'https://www.nature.com/nature/'
    })
    expect(urls.some((url) => url.includes('/journals?query=Nature'))).toBe(true)
    expect(urls.some((url) => url.includes('query.bibliographic') || url.includes('select='))).toBe(false)
  })

  it('reports provider failures instead of silently returning no results', async () => {
    const http = new FakeHttp(
      () => {
        throw new Error('offline')
      },
      () => null
    )
    const discovery = new DiscoveryService(http, settings)

    await expect(discovery.searchJournals('Nature')).rejects.toThrow(/providers are unavailable/)
  })
})

describe('publisher feed patterns', () => {
  async function discoverWithFeed(journal: Parameters<DiscoveryService['discoverFeeds']>[0], feedUrl: string) {
    const http = new FakeHttp(
      () => null,
      (url) => (url === feedUrl ? feedXml : null)
    )
    const discovery = new DiscoveryService(http, settings)
    return discovery.discoverFeeds(journal)
  }

  it('finds the Cell Press current-issue feed', async () => {
    const result = await discoverWithFeed(
      {
        title: 'Cell',
        issn: '0092-8674',
        eissn: '1097-4172',
        publisher: 'Cell Press',
        homepageUrl: 'https://www.sciencedirect.com/journal/cell',
        source: 'openalex',
        score: 1
      },
      'https://www.cell.com/cell/current.rss'
    )

    expect(result.candidates.map((candidate) => candidate.url)).toContain('https://www.cell.com/cell/current.rss')
  })

  it('uses the ScienceDirect ISSN without hyphens', async () => {
    const result = await discoverWithFeed(
      {
        title: 'Plant Physiology and Biochemistry',
        issn: '0981-9428',
        publisher: 'Elsevier',
        homepageUrl: 'https://www.journals.elsevier.com/plant-physiology-and-biochemistry',
        source: 'openalex',
        score: 1
      },
      'https://rss.sciencedirect.com/publication/science/09819428'
    )

    expect(result.candidates.map((candidate) => candidate.url)).toContain(
      'https://rss.sciencedirect.com/publication/science/09819428'
    )
  })

  it('uses the Wiley eISSN without hyphens', async () => {
    const result = await discoverWithFeed(
      {
        title: 'New Phytologist',
        issn: '0028-646X',
        eissn: '1469-8137',
        publisher: 'Wiley (Blackwell Publishing)',
        homepageUrl: 'https://nph.onlinelibrary.wiley.com/journal/14698137',
        source: 'openalex',
        score: 1
      },
      'https://onlinelibrary.wiley.com/feed/14698137/most-recent'
    )

    expect(result.candidates.map((candidate) => candidate.url)).toContain(
      'https://onlinelibrary.wiley.com/feed/14698137/most-recent'
    )
  })

  it('uses the ACS journal code instead of the ISSN', async () => {
    const result = await discoverWithFeed(
      {
        title: 'Analytical Chemistry',
        issn: '0003-2700',
        publisher: 'American Chemical Society',
        homepageUrl: 'http://pubs.acs.org/journal/ancham',
        source: 'openalex',
        score: 1
      },
      'https://pubs.acs.org/action/showFeed?type=etoc&feed=rss&jc=ancham'
    )

    expect(result.candidates.map((candidate) => candidate.url)).toContain(
      'https://pubs.acs.org/action/showFeed?type=etoc&feed=rss&jc=ancham'
    )
  })

  it('uses the first Nature URL segment instead of index.html', async () => {
    const result = await discoverWithFeed(
      {
        title: 'Nature Communications',
        issn: '2041-1723',
        publisher: 'Nature Portfolio',
        homepageUrl: 'http://www.nature.com/ncomms/index.html',
        source: 'openalex',
        score: 1
      },
      'https://www.nature.com/ncomms.rss'
    )

    expect(result.candidates.map((candidate) => candidate.url)).toContain('https://www.nature.com/ncomms.rss')
  })
})

describe('Crossref fallback discovery', () => {
  it('offers a Crossref feed when no publisher RSS can be validated', async () => {
    const http = new FakeHttp(
      (url) => {
        if (url.includes('/journals/0003-2700/works')) {
          return {
            message: {
              items: [
                {
                  DOI: '10.1021/acs.analchem.test',
                  title: ['A fallback article'],
                  author: [{ given: 'Ada', family: 'Lovelace' }],
                  published: { 'date-parts': [[2026, 11, 2]] },
                  'container-title': ['Analytical Chemistry'],
                  URL: 'https://doi.org/10.1021/acs.analchem.test'
                }
              ]
            }
          }
        }
        return null
      },
      () => null
    )
    const discovery = new DiscoveryService(http, settings)

    const result = await discovery.discoverFeeds({
      title: 'Analytical Chemistry',
      issn: '0003-2700',
      publisher: 'American Chemical Society',
      homepageUrl: 'http://pubs.acs.org/journal/ancham',
      source: 'openalex',
      score: 1
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      url: crossrefFeedUrl('0003-2700'),
      type: 'crossref',
      source: 'crossref',
      itemCount: 1,
      sampleTitles: ['A fallback article']
    })
    expect(result.notes.join(' ')).toMatch(/Crossref/)
  })

  it('parses Crossref works into feed items', async () => {
    const http = new FakeHttp(
      () => ({
        message: {
          items: [
            {
              DOI: '10.1093/plphys/test',
              title: ['<scp>Machine</scp> learning in plants'],
              author: [
                { given: 'Sara', family: 'Shakir' },
                { given: 'Ved', family: 'Prakash' }
              ],
              'published-online': { 'date-parts': [[2026, 11, 6]] },
              abstract: '<jats:p>An abstract.</jats:p>',
              subject: ['Plant Science'],
              URL: 'https://doi.org/10.1093/plphys/test',
              link: [{ URL: 'https://example.org/test.pdf', 'content-type': 'application/pdf' }]
            }
          ]
        }
      }),
      () => null
    )
    const discovery = new DiscoveryService(http, settings)

    const parsed = await discovery.fetchCrossrefFeed('0032-0889', 10)

    expect(parsed.title).toBe('')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      doi: '10.1093/plphys/test',
      creator: 'Sara Shakir; Ved Prakash',
      isoDate: '2026-11-06T00:00:00.000Z',
      categories: ['Plant Science']
    })
  })
})
