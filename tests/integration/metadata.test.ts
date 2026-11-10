import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/db/database'
import { CacheRepo } from '../../src/main/db/repositories/cache'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { HttpService } from '../../src/main/services/http'
import { MetadataService } from '../../src/main/services/metadata'

const secretBox = {
  available: true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8')
}

class FakeHttp extends HttpService {
  constructor(private readonly jsonHandler: (url: string) => unknown) {
    super((() => Promise.reject(new Error('Network disabled in test'))) as unknown as typeof fetch)
  }

  override async getJson<T>(url: string): Promise<T | null> {
    return (this.jsonHandler(url) as T | null) ?? null
  }
}

describe('open-access PDF resolution', () => {
  let database: AppDatabase
  let settings: SettingsService

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    settings = new SettingsService(new SettingsRepo(database), secretBox, { managedDir: 'C:/tmp/pdfs' })
  })

  afterEach(() => {
    database.close()
  })

  it('falls back to OpenAlex when no contact email is configured', async () => {
    const http = new FakeHttp((url) => {
      expect(url).toContain('api.openalex.org/works/doi:10.1038%2Ftest')
      return { best_oa_location: { pdf_url: 'https://example.org/paper.pdf' } }
    })
    const metadata = new MetadataService(http, new CacheRepo(database), settings)

    await expect(metadata.unpaywallPdf('10.1038/test')).resolves.toBe('https://example.org/paper.pdf')
  })

  it('prefers direct PDF locations over landing pages', async () => {
    const http = new FakeHttp((url) => {
      expect(url).toContain('api.openalex.org/works/doi:')
      return {
        best_oa_location: { landing_page_url: 'https://example.org/article' },
        locations: [
          { landing_page_url: 'https://example.org/article' },
          { pdf_url: 'https://example.org/article.pdf' }
        ]
      }
    })
    const metadata = new MetadataService(http, new CacheRepo(database), settings)

    await expect(metadata.unpaywallPdf('10.1038/test-2')).resolves.toBe('https://example.org/article.pdf')
  })

  it('prefers an OpenAlex PDF over a Unpaywall landing page', async () => {
    settings.update({ rss: { contactEmail: 'researcher@example.org' } })
    const http = new FakeHttp((url) => {
      if (url.includes('api.unpaywall.org')) {
        return { best_oa_location: { url: 'https://example.org/landing-page' } }
      }
      if (url.includes('api.openalex.org')) {
        expect(url).toContain('?mailto=researcher%40example.org')
        return { best_oa_location: { pdf_url: 'https://example.org/direct.pdf' } }
      }
      return null
    })
    const metadata = new MetadataService(http, new CacheRepo(database), settings)

    await expect(metadata.unpaywallPdf('10.1038/test-3')).resolves.toBe('https://example.org/direct.pdf')
  })
})
