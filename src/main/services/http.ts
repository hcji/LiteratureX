export interface HttpOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
  method?: string
  body?: string
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class HttpService {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent = 'LiteratureX/0.1 (desktop literature manager)'
  ) {}

  async request(url: string, options: HttpOptions = {}): Promise<Response> {
    const retries = options.retries ?? 2
    const timeoutMs = options.timeoutMs ?? 20000
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          body: options.body,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json, text/xml, application/xml, application/rss+xml, text/html;q=0.9, */*;q=0.8',
            ...options.headers
          },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow'
        })
        if (response.status === 429 || response.status >= 500) {
          lastError = new HttpError(`HTTP ${response.status}`, url, response.status)
          if (attempt < retries) {
            await this.sleep(400 * 2 ** attempt)
            continue
          }
        }
        return response
      } catch (error) {
        lastError = error
        if (attempt < retries) {
          await this.sleep(400 * 2 ** attempt)
          continue
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`)
  }

  async getJson<T>(url: string, options: HttpOptions = {}): Promise<T | null> {
    const response = await this.request(url, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers }
    })
    if (response.status === 404) return null
    if (!response.ok) throw new HttpError(`HTTP ${response.status} for ${url}`, url, response.status)
    return (await response.json()) as T
  }

  async getText(url: string, options: HttpOptions = {}): Promise<{ text: string; response: Response } | null> {
    const response = await this.request(url, options)
    if (response.status === 404) return null
    if (!response.ok) throw new HttpError(`HTTP ${response.status} for ${url}`, url, response.status)
    return { text: await response.text(), response }
  }

  async getBytes(url: string, options: HttpOptions = {}): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const response = await this.request(url, options)
    if (response.status === 404) return null
    if (!response.ok) throw new HttpError(`HTTP ${response.status} for ${url}`, url, response.status)
    const buffer = await response.arrayBuffer()
    return { bytes: new Uint8Array(buffer), contentType: response.headers.get('content-type') ?? '' }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
