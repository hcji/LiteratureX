import http from 'node:http'
import https from 'node:https'
import { promises as fs, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { X509Certificate, randomUUID } from 'node:crypto'
import { generate as generateCertificate } from 'selfsigned'
import type {
  Article,
  CitationFormatTemplate,
  PluginReference,
  PluginStatus,
  WpsInstallResult,
  WordSetupResult
} from '@shared/types'
import type { ArticleRepo } from '../db/repositories/articles'

const execFileAsync = promisify(execFile)

export interface PluginServiceOptions {
  dataDir: string
  resourcesRoot: string
  version: string
  token: string
  articles: ArticleRepo
  httpPort?: number
  httpsPort?: number
  wpsAddonsDir?: string
  trustCertificate?: (certPath: string) => Promise<void>
  analyzeCitationFormat?: (
    example: string,
    language: 'zh' | 'en'
  ) => Promise<Omit<CitationFormatTemplate, 'id' | 'source' | 'createdAt'>>
}

export class PluginService {
  private httpServer: http.Server | null = null
  private httpsServer: https.Server | null = null
  private httpPort: number
  private httpsPort: number
  private httpError: string | null = null
  private httpsError: string | null = null
  private started = false
  private readonly wordDir: string
  private readonly certDir: string
  private readonly keyPath: string
  private readonly certPath: string
  private readonly trustMarkerPath: string
  private readonly manifestPath: string
  private readonly wpsAddonsDir: string
  private readonly formatsPath: string

  constructor(private readonly options: PluginServiceOptions) {
    this.httpPort = options.httpPort ?? 47831
    this.httpsPort = options.httpsPort ?? 47832
    this.wordDir = path.join(options.dataDir, 'office-addin')
    this.certDir = path.join(this.wordDir, 'certs')
    this.keyPath = path.join(this.certDir, 'localhost.key')
    this.certPath = path.join(this.certDir, 'localhost.crt')
    this.trustMarkerPath = path.join(this.certDir, 'trusted.txt')
    this.manifestPath = path.join(this.wordDir, 'manifest.xml')
    this.formatsPath = path.join(this.wordDir, 'citation-formats.json')
    this.wpsAddonsDir = options.wpsAddonsDir ?? defaultWpsAddonsDir()
  }

  private get wpsTargetDir(): string {
    return path.join(this.wpsAddonsDir, `LiteratureX_${this.options.version}`)
  }

  private get wpsPublishPath(): string {
    return path.join(this.wpsAddonsDir, 'publish.xml')
  }

  private get officeSource(): string {
    return path.join(this.options.resourcesRoot, 'office-plugin')
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.startHttp()
    await this.startHttps()
  }

  async stop(): Promise<void> {
    const close = (server: http.Server | https.Server | null): Promise<void> =>
      new Promise((resolve) => {
        if (!server) {
          resolve()
          return
        }
        server.close(() => resolve())
      })
    const httpServer = this.httpServer
    const httpsServer = this.httpsServer
    this.httpServer = null
    this.httpsServer = null
    await Promise.all([close(httpServer), close(httpsServer)])
    this.started = false
  }

  private startHttp(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const server = http.createServer((request, response) => {
          void this.handle(request, response, 'http')
        })
        server.on('error', (error) => {
          this.httpError = error.message
          this.httpServer = null
          resolve()
        })
        server.listen(this.httpPort, '127.0.0.1', () => {
          this.httpServer = server
          this.httpError = null
          const address = server.address()
          if (address && typeof address === 'object') this.httpPort = address.port
          resolve()
        })
      } catch (error) {
        this.httpError = error instanceof Error ? error.message : String(error)
        resolve()
      }
    })
  }

  private async startHttps(): Promise<void> {
    if (!existsSync(this.certPath) || !existsSync(this.keyPath)) return
    await new Promise<void>((resolve) => {
      try {
        const server = https.createServer(
          {
            key: readFileSync(this.keyPath),
            cert: readFileSync(this.certPath)
          },
          (request, response) => {
            void this.handle(request, response, 'https')
          }
        )
        server.on('error', (error) => {
          this.httpsError = error.message
          this.httpsServer = null
          resolve()
        })
        server.listen(this.httpsPort, '127.0.0.1', () => {
          this.httpsServer = server
          this.httpsError = null
          const address = server.address()
          if (address && typeof address === 'object') this.httpsPort = address.port
          resolve()
        })
      } catch (error) {
        this.httpsError = error instanceof Error ? error.message : String(error)
        resolve()
      }
    })
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse, scheme: 'http' | 'https'): Promise<void> {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'X-LiteratureX-Token, Content-Type')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', `${scheme}://127.0.0.1`)
    const pathname = url.pathname
    const method = request.method ?? 'GET'
    if (!pathname.startsWith('/api/plugin/') && method !== 'GET') {
      this.sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    if (pathname.startsWith('/api/plugin/') && !['GET', 'POST', 'DELETE'].includes(method)) {
      this.sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    try {
      if (pathname === '/office' || pathname === '/office/' || pathname === '/office/index.html') {
        this.sendHtml(response, this.wordTaskpaneHtml(scheme))
        return
      }
      if (pathname === '/office/support.html') {
        this.sendHtml(response, this.supportHtml())
        return
      }
      if (pathname.startsWith('/office/')) {
        const file = pathname.slice('/office/'.length)
        const allowed = new Set(['app.js', 'app.css', 'icon-32.png', 'icon-80.png'])
        if (allowed.has(file)) {
          const filePath = path.join(this.officeSource, 'shared', file)
          const contentType = file.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : file.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'image/png'
          await this.sendFile(response, filePath, contentType)
          return
        }
      }
      if (pathname.startsWith('/api/plugin/')) {
        if (request.headers['x-literaturex-token'] !== this.options.token) {
          this.sendJson(response, 401, { error: 'Invalid LiteratureX plugin token' })
          return
        }
        if (pathname === '/api/plugin/status') {
          this.sendJson(response, 200, {
            name: 'LiteratureX',
            version: this.options.version,
            count: this.options.articles.list({ scope: 'library', limit: 1 }).total
          })
          return
        }
        if (pathname === '/api/plugin/search') {
          const query = (url.searchParams.get('q') ?? '').trim()
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 100)
          this.sendJson(response, 200, this.search(query, limit))
          return
        }
        if (pathname === '/api/plugin/references') {
          const ids = (url.searchParams.get('ids') ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, 200)
          this.sendJson(response, 200, { items: this.references(ids) })
          return
        }
        if (pathname === '/api/plugin/formats' && method === 'GET') {
          this.sendJson(response, 200, {
            formats: [...this.builtinFormats(), ...(await this.customFormats())],
            publicStyleUrl: 'https://www.zotero.org/styles'
          })
          return
        }
        if (pathname === '/api/plugin/formats/analyze' && method === 'POST') {
          const body = await this.readJsonBody(request)
          const example = typeof body.example === 'string' ? body.example.slice(0, 8000) : ''
          const language = body.language === 'zh' ? 'zh' : 'en'
          if (!example.trim()) {
            this.sendJson(response, 400, { error: 'Paste a citation example first' })
            return
          }
          if (!this.options.analyzeCitationFormat) {
            this.sendJson(response, 503, { error: 'AI citation analysis is not available' })
            return
          }
          const draft = await this.options.analyzeCitationFormat(example, language)
          const format: CitationFormatTemplate = {
            id: `custom-${randomUUID()}`,
            source: 'custom',
            createdAt: new Date().toISOString(),
            ...draft
          }
          const formats = await this.customFormats()
          formats.push(format)
          await this.writeCustomFormats(formats)
          this.sendJson(response, 200, { format })
          return
        }
        if (pathname.startsWith('/api/plugin/formats/') && method === 'DELETE') {
          const id = decodeURIComponent(pathname.slice('/api/plugin/formats/'.length))
          const formats = await this.customFormats()
          const next = formats.filter((format) => format.id !== id)
          if (next.length === formats.length) {
            this.sendJson(response, 404, { error: 'Citation format not found' })
            return
          }
          await this.writeCustomFormats(next)
          this.sendJson(response, 200, { ok: true })
          return
        }
      }
      this.sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      this.sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private search(query: string, limit: number): { items: PluginReference[]; total: number } {
    if (query) {
      const result = this.options.articles.search({ scope: 'library', search: query, limit })
      return {
        items: result.items.map((item) => this.toReference(item.article)),
        total: result.total
      }
    }
    const result = this.options.articles.list({ scope: 'library', limit, sort: 'created_at' })
    return { items: result.items.map((article) => this.toReference(article)), total: result.total }
  }

  private references(ids: string[]): PluginReference[] {
    const seen = new Set<string>()
    const result: PluginReference[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const article = this.options.articles.get(id)
      if (article) result.push(this.toReference(article))
    }
    return result
  }

  private toReference(article: Article): PluginReference {
    return {
      id: article.id,
      title: article.title,
      authors: article.authors.map((author) => author.name),
      journalTitle: article.journalTitle ?? null,
      year: article.year ?? null,
      volume: article.volume ?? null,
      issue: article.issue ?? null,
      pages: article.pages ?? null,
      doi: article.doi ?? null,
      url: article.url ?? null
    }
  }

  private builtinFormats(): CitationFormatTemplate[] {
    return [
      {
        id: 'builtin-numeric',
        name: '数字 [1]',
        description: 'Numeric citations with a bracketed issue number.',
        inText: '[{index}]',
        bibliography: '[{index}] {authors}. {title}. {journal}, {year}, {volume}({issue}), {pages}. {doi}',
        numbered: true,
        source: 'builtin'
      },
      {
        id: 'builtin-author-year',
        name: '作者-年份',
        description: 'Author-year in-text citations.',
        inText: '({author}, {year})',
        bibliography: '{authors}. {title}. {journal}, {year}, {volume}({issue}), {pages}. {doi}',
        numbered: false,
        source: 'builtin'
      },
      {
        id: 'public-apa',
        name: 'APA (public CSL style)',
        description: 'Template inspired by the open-source APA CSL style.',
        inText: '({author}, {year})',
        bibliography: '{authors}. ({year}). {title}. {journal}, {volume}({issue}), {pages}. {doi}',
        numbered: false,
        source: 'public'
      },
      {
        id: 'public-gbt7714',
        name: 'GB/T 7714 (public CSL style)',
        description: 'Template inspired by the open-source GB/T 7714 CSL style.',
        inText: '[{index}]',
        bibliography: '[{index}] {authors}. {title}[J]. {journal}, {year}, {volume}({issue}): {pages}.',
        numbered: true,
        source: 'public'
      },
      {
        id: 'public-nature',
        name: 'Nature (public CSL style)',
        description: 'Template inspired by the open-source Nature CSL style.',
        inText: '{index}',
        bibliography: '{index}. {authors}. {title}. {journal} {volume}, {pages} ({year}).',
        numbered: true,
        source: 'public'
      },
      {
        id: 'public-ieee',
        name: 'IEEE (public CSL style)',
        description: 'Template inspired by the open-source IEEE CSL style.',
        inText: '[{index}]',
        bibliography: '[{index}] {authors}, "{title}," {journal}, vol. {volume}, no. {issue}, pp. {pages}, {year}.',
        numbered: true,
        source: 'public'
      }
    ]
  }

  private async customFormats(): Promise<CitationFormatTemplate[]> {
    try {
      const raw = await fs.readFile(this.formatsPath, 'utf8')
      const parsed = JSON.parse(raw) as CitationFormatTemplate[]
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (format) =>
          format &&
          typeof format.id === 'string' &&
          typeof format.name === 'string' &&
          typeof format.bibliography === 'string' &&
          typeof format.inText === 'string'
      )
    } catch {
      return []
    }
  }

  private async writeCustomFormats(formats: CitationFormatTemplate[]): Promise<void> {
    await fs.mkdir(this.wordDir, { recursive: true })
    await fs.writeFile(this.formatsPath, JSON.stringify(formats.slice(0, 100), null, 2), 'utf8')
  }

  private readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let data = ''
      request.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8')
        if (data.length > 1_000_000) {
          request.destroy()
          reject(new Error('Request body is too large'))
        }
      })
      request.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}') as Record<string, unknown>)
        } catch {
          resolve({})
        }
      })
      request.on('error', reject)
    })
  }

  status(): PluginStatus {
    return {
      version: this.options.version,
      httpRunning: Boolean(this.httpServer),
      httpsRunning: Boolean(this.httpsServer),
      httpPort: this.httpPort,
      httpsPort: this.httpsPort,
      httpError: this.httpError,
      httpsError: this.httpsError,
      wpsInstalled: existsSync(this.wpsTargetDir),
      wpsPath: this.wpsTargetDir,
      wpsPublishPath: this.wpsPublishPath,
      wordManifestExists: existsSync(this.manifestPath),
      wordManifestPath: this.manifestPath,
      certExists: existsSync(this.certPath) && existsSync(this.keyPath),
      wordTrusted: existsSync(this.certPath) && existsSync(this.trustMarkerPath)
    }
  }

  guidePath(): string {
    return path.join(this.officeSource, 'GUIDE.md')
  }

  async installWps(): Promise<WpsInstallResult> {
    const source = path.join(this.officeSource, 'wps')
    if (!existsSync(source)) throw new Error('WPS add-in assets are missing from the installation')
    await fs.mkdir(this.wpsAddonsDir, { recursive: true })
    await fs.rm(this.wpsTargetDir, { recursive: true, force: true })
    await fs.mkdir(this.wpsTargetDir, { recursive: true })
    await fs.cp(source, this.wpsTargetDir, { recursive: true })
    await fs.cp(path.join(this.officeSource, 'shared'), path.join(this.wpsTargetDir, 'shared'), { recursive: true })
    const config = {
      apiBase: `http://127.0.0.1:${this.httpPort}`,
      token: this.options.token,
      host: 'wps',
      version: this.options.version
    }
    await fs.writeFile(
      path.join(this.wpsTargetDir, 'js', 'config.js'),
      `window.__LX_CONFIG__ = ${JSON.stringify(config, null, 2)}\n`,
      'utf8'
    )
    await fs.writeFile(
      path.join(this.wpsTargetDir, 'manifest.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<JsPlugin>\n  <ApiVersion>1.0.0</ApiVersion>\n  <Name>LiteratureX</Name>\n  <Description>Insert citations and a bibliography from the LiteratureX library.</Description>\n</JsPlugin>\n`,
      'utf8'
    )
    await this.writePublishXml()
    return { path: this.wpsTargetDir, publishXml: this.wpsPublishPath }
  }

  async uninstallWps(): Promise<void> {
    await fs.rm(this.wpsTargetDir, { recursive: true, force: true })
    if (existsSync(this.wpsPublishPath)) {
      let xml = await fs.readFile(this.wpsPublishPath, 'utf8')
      xml = xml.replace(/<jsplugin\b[^>]*\bname="LiteratureX"[^>]*\/>\s*/gi, '')
      await fs.writeFile(this.wpsPublishPath, xml, 'utf8')
    }
  }

  private async writePublishXml(): Promise<void> {
    const entry = `  <jsplugin name="LiteratureX" type="wps" url="LiteratureX_${this.options.version}" version="${this.options.version}" enable="enable_dev" install="null" customDomain="" debug=""/>`
    let xml = ''
    if (existsSync(this.wpsPublishPath)) {
      xml = await fs.readFile(this.wpsPublishPath, 'utf8')
    }
    if (!xml.trim()) {
      xml = '<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n</jsplugins>\n'
    }
    xml = xml.replace(/<jsplugin\b[^>]*\bname="LiteratureX"[^>]*\/>\s*/gi, '')
    if (xml.indexOf('</jsplugins>') >= 0) {
      xml = xml.replace('</jsplugins>', `${entry}\n</jsplugins>`)
    } else {
      xml = `${xml.trim()}\n<jsplugins>\n${entry}\n</jsplugins>\n`
    }
    await fs.writeFile(this.wpsPublishPath, xml, 'utf8')
  }

  async setupWord(): Promise<WordSetupResult> {
    await fs.mkdir(this.certDir, { recursive: true })
    await this.ensureCertificate()
    let trusted = existsSync(this.trustMarkerPath)
    let trustError: string | null = null
    if (!trusted) {
      try {
        if (this.options.trustCertificate) await this.options.trustCertificate(this.certPath)
        else await defaultTrustCertificate(this.certPath)
        await fs.writeFile(this.trustMarkerPath, new Date().toISOString(), 'utf8')
        trusted = true
      } catch (error) {
        trustError = error instanceof Error ? error.message : String(error)
      }
    }
    if (!this.httpsServer) await this.startHttps()
    await this.writeWordManifest()
    return {
      manifestPath: this.manifestPath,
      certPath: this.certPath,
      trusted,
      trustError,
      httpsRunning: Boolean(this.httpsServer),
      httpsError: this.httpsError
    }
  }

  private async ensureCertificate(): Promise<void> {
    if (existsSync(this.certPath) && existsSync(this.keyPath)) {
      try {
        const cert = new X509Certificate(await fs.readFile(this.certPath, 'utf8'))
        if (new Date(cert.validTo).getTime() > Date.now() + 86400000) return
      } catch {
        /* regenerate */
      }
    }
    const pems = await generateCertificate([{ name: 'commonName', value: 'localhost' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' }
          ]
        }
      ]
    })
    await fs.writeFile(this.keyPath, pems.private, { encoding: 'utf8', mode: 0o600 })
    await fs.writeFile(this.certPath, pems.cert, 'utf8')
    await fs.rm(this.trustMarkerPath, { force: true }).catch(() => undefined)
  }

  private async writeWordManifest(): Promise<void> {
    const base = `https://127.0.0.1:${this.httpsPort}`
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
  <Id>6f2c2f1e-3c1a-4b7e-9c6d-4d2a5b8e7c41</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>LiteratureX</ProviderName>
  <DefaultLocale>zh-CN</DefaultLocale>
  <DisplayName DefaultValue="LiteratureX 参考文献" />
  <Description DefaultValue="从本地 LiteratureX 文库搜索文献，并在 Word 中插入引用与参考文献表。" />
  <IconUrl DefaultValue="${base}/office/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="${base}/office/icon-80.png" />
  <SupportUrl DefaultValue="${base}/office/support.html" />
  <AppDomains>
    <AppDomain>${base}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document" />
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="WordApi" MinVersion="1.1" />
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${base}/office/index.html" />
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
</OfficeApp>
`
    await fs.mkdir(this.wordDir, { recursive: true })
    await fs.writeFile(this.manifestPath, manifest, 'utf8')
  }

  private wordTaskpaneHtml(scheme: 'http' | 'https'): string {
    const port = scheme === 'https' ? this.httpsPort : this.httpPort
    const host = scheme === 'https' ? '127.0.0.1' : '127.0.0.1'
    const config = {
      apiBase: `${scheme}://${host}:${port}`,
      token: this.options.token,
      host: 'word',
      version: this.options.version
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LiteratureX 参考文献</title>
<link rel="stylesheet" href="/office/app.css" />
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<script>window.__LX_CONFIG__ = ${JSON.stringify(config)};</script>
</head>
<body>
<div id="app"></div>
<script src="/office/app.js"></script>
</body>
</html>`
  }

  private supportHtml(): string {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>LiteratureX 插件帮助</title>
<style>body{font-family:Segoe UI,Microsoft YaHei UI,sans-serif;margin:24px;max-width:720px;line-height:1.7;color:#16202a}h1{font-size:18px}h2{font-size:14px;margin-top:20px}code{background:#eef2f5;padding:2px 5px;border-radius:4px}p{font-size:13px}</style>
</head><body>
<h1>LiteratureX 参考文献插件</h1>
<h2>使用方式</h2>
<p>保持 LiteratureX 桌面应用运行，在任务窗格搜索文献，选择后点击“插入引用”。点击“参考文献表”会把已引用文献的完整条目插入文档末尾。</p>
<h2>Word 加载</h2>
<p>在 Word 中打开“插入 → 获取加载项 → 我的加载项 → 上传我的加载项”，选择 LiteratureX 生成的 <code>manifest.xml</code>。</p>
<h2>无法连接</h2>
<p>确认 LiteratureX 正在运行；本地插件服务地址为 <code>https://127.0.0.1:${this.httpsPort}</code>。首次使用需要在设置中安装 Word 加载项并信任本地证书。</p>
<h2>隐私</h2>
<p>插件只访问本机 127.0.0.1 上的 LiteratureX 服务；参考文献数据不会离开本机。</p>
</body></html>`
  }

  private async sendFile(response: http.ServerResponse, filePath: string, contentType: string): Promise<void> {
    try {
      const data = await fs.readFile(filePath)
      response.writeHead(200, { 'Content-Type': contentType })
      response.end(data)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  }

  private sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(body)
  }

  private sendHtml(response: http.ServerResponse, html: string): void {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html)
  }
}

function defaultWpsAddonsDir(): string {
  const override = process.env['LITERATUREX_WPS_ADDONS_DIR']
  if (override) return path.resolve(override)
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'kingsoft', 'wps', 'jsaddons')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Containers', 'com.kingsoft.wpsoffice.mac', 'Data', '.kingsoft', 'wps', 'jsaddons')
  }
  return path.join(os.homedir(), '.local', 'share', 'Kingsoft', 'wps', 'jsaddons')
}

async function defaultTrustCertificate(certPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic certificate trust is only implemented on Windows. Trust the generated certificate manually.')
  }
  await execFileAsync('certutil.exe', ['-user', '-addstore', '-f', 'Root', certPath], {
    windowsHide: true
  })
}
