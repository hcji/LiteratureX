import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { PluginService } from '../../src/main/services/pluginService'

const resourcesRoot = path.resolve(process.cwd(), 'resources')

describe('office plugin service', () => {
  let dataDir: string
  let database: AppDatabase
  let articles: ArticleRepo
  let service: PluginService
  let articleId: string

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-plugin-'))
    database = new AppDatabase(':memory:')
    articles = new ArticleRepo(database)
    articleId = articles.create({
      title: 'Deep Learning for Tandem Mass Spectra',
      authors: ['Hongchao Ji', 'Mei Wang'],
      journalTitle: 'Journal of Natural Products',
      year: 2024,
      volume: '87',
      issue: '4',
      pages: '1001-1012',
      doi: '10.1021/acs.jnatprod.4c00123',
      source: 'manual'
    }).id
    service = new PluginService({
      dataDir,
      resourcesRoot,
      version: '0.1.0',
      token: 'test-plugin-token',
      articles,
      httpPort: 0,
      httpsPort: 0,
      wpsAddonsDir: path.join(dataDir, 'jsaddons'),
      trustCertificate: async () => undefined,
      analyzeCitationFormat: async (example) => ({
        name: example.toLowerCase().includes('nature') ? 'Nature Test' : 'Example Test',
        description: 'A format learned from an example.',
        inText: '({author}, {year})',
        bibliography: '{authors}. {title}. {journal} {year}.'
      })
    })
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('serves the token-protected API on loopback', async () => {
    const status = service.status()
    expect(status.httpRunning).toBe(true)
    expect(status.httpPort).toBeGreaterThan(0)
    const headers = { 'X-LiteratureX-Token': 'test-plugin-token' }

    const statusResponse = await fetch(`http://127.0.0.1:${status.httpPort}/api/plugin/status`, { headers })
    expect(statusResponse.status).toBe(200)
    const statusPayload = (await statusResponse.json()) as { count: number }
    expect(statusPayload.count).toBe(1)

    const searchResponse = await fetch(
      `http://127.0.0.1:${status.httpPort}/api/plugin/search?q=${encodeURIComponent('deep learning')}`,
      { headers }
    )
    const searchPayload = (await searchResponse.json()) as { items: Array<{ id: string; title: string }> }
    expect(searchPayload.items[0]?.id).toBe(articleId)

    const refsResponse = await fetch(
      `http://127.0.0.1:${status.httpPort}/api/plugin/references?ids=${articleId}`,
      { headers }
    )
    const refsPayload = (await refsResponse.json()) as { items: Array<{ doi: string }> }
    expect(refsPayload.items[0]?.doi).toBe('10.1021/acs.jnatprod.4c00123')

    const unauthorized = await fetch(`http://127.0.0.1:${status.httpPort}/api/plugin/status`)
    expect(unauthorized.status).toBe(401)
  })

  it('lists public citation formats and saves LLM-learned formats', async () => {
    const port = service.status().httpPort
    const headers = { 'X-LiteratureX-Token': 'test-plugin-token', 'Content-Type': 'application/json' }
    const base = `http://127.0.0.1:${port}/api/plugin/formats`

    const initial = (await (await fetch(base, { headers })).json()) as {
      formats: Array<{ id: string; source: string; numbered?: boolean }>
      publicStyleUrl: string
    }
    expect(initial.formats.some((format) => format.id === 'builtin-numeric')).toBe(true)
    expect(initial.formats.some((format) => format.source === 'public')).toBe(true)
    expect(initial.formats.find((format) => format.id === 'public-gbt7714')?.numbered).toBe(true)
    expect(initial.formats.find((format) => format.id === 'public-apa')?.numbered).toBe(false)
    expect(initial.publicStyleUrl).toContain('zotero.org/styles')

    const analyze = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ example: 'Nature 2024 example citation', language: 'en' })
    })
    expect(analyze.status).toBe(200)
    const created = (await analyze.json()) as { format: { id: string; name: string; source: string } }
    expect(created.format.name).toBe('Nature Test')
    expect(created.format.source).toBe('custom')

    const withCustom = (await (await fetch(base, { headers })).json()) as {
      formats: Array<{ id: string }>
    }
    expect(withCustom.formats.some((format) => format.id === created.format.id)).toBe(true)

    const removed = await fetch(`${base}/${encodeURIComponent(created.format.id)}`, { method: 'DELETE', headers })
    expect(removed.status).toBe(200)
    const finalList = (await (await fetch(base, { headers })).json()) as { formats: Array<{ id: string }> }
    expect(finalList.formats.some((format) => format.id === created.format.id)).toBe(false)
  })

  it('installs, registers and uninstalls the WPS add-in without touching other add-ins', async () => {
    const addonsDir = path.join(dataDir, 'jsaddons')
    mkdirSync(addonsDir, { recursive: true })
    writeFileSync(
      path.join(addonsDir, 'publish.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n  <jsplugin name="Other" type="wps" url="Other_1.0.0" version="1.0.0"/>\n</jsplugins>\n',
      'utf8'
    )
    const result = await service.installWps()
    expect(existsSync(path.join(result.path, 'index.html'))).toBe(true)
    expect(existsSync(path.join(result.path, 'ui', 'taskpane.html'))).toBe(true)
    expect(existsSync(path.join(result.path, 'shared', 'app.js'))).toBe(true)
    const config = readFileSync(path.join(result.path, 'js', 'config.js'), 'utf8')
    expect(config).toContain('test-plugin-token')
    const ribbon = readFileSync(path.join(result.path, 'ribbon.xml'), 'utf8')
    for (const id of [
      'btnAddEditCitation',
      'btnAddEditBib',
      'btnRefresh',
      'btnPref',
      'btnAddNote',
      'btnUnlink',
      'btnExport',
      'btnAbout'
    ]) {
      expect(ribbon).toContain(`id="${id}"`)
    }
    expect(ribbon).toContain('插入/编辑引用')
    expect(existsSync(path.join(result.path, 'images', 'citation.svg'))).toBe(true)
    expect(existsSync(path.join(result.path, 'images', 'bibliography.svg'))).toBe(true)
    const publish = readFileSync(result.publishXml, 'utf8')
    expect(publish).toContain('name="LiteratureX"')
    expect(publish).toContain('name="Other"')
    expect(service.status().wpsInstalled).toBe(true)

    await service.uninstallWps()
    expect(service.status().wpsInstalled).toBe(false)
    const publishAfter = readFileSync(result.publishXml, 'utf8')
    expect(publishAfter).not.toContain('name="LiteratureX"')
    expect(publishAfter).toContain('name="Other"')
  })

  it('generates a Word manifest, local certificate and HTTPS task pane', async () => {
    const result = await service.setupWord()
    expect(result.trusted).toBe(true)
    expect(existsSync(result.certPath)).toBe(true)
    expect(existsSync(result.manifestPath)).toBe(true)
    const status = service.status()
    expect(status.httpsRunning).toBe(true)
    expect(status.httpsPort).toBeGreaterThan(0)
    const manifest = readFileSync(result.manifestPath, 'utf8')
    expect(manifest).toContain(`https://127.0.0.1:${status.httpsPort}/office/index.html`)
    expect(manifest).toContain('ReadWriteDocument')

    const html = await new Promise<string>((resolve, reject) => {
      https
        .get(
          `https://127.0.0.1:${status.httpsPort}/office/index.html`,
          { rejectUnauthorized: false },
          (response) => {
            let body = ''
            response.on('data', (chunk) => {
              body += chunk
            })
            response.on('end', () => resolve(body))
          }
        )
        .on('error', reject)
    })
    expect(html).toContain('office.js')
    expect(html).toContain('test-plugin-token')
    expect(html).toContain('/office/app.js')
  })
})
