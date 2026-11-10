import type { ArticleTranslation, ArticleTranslationResult, Language } from '@shared/types'
import type { ArticleRepo } from '../db/repositories/articles'
import type { SettingsService } from './settings'
import { HeuristicProvider, createProvider, type ChatMessage } from './ai/providers'

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g

export function textLanguage(text: string): 'zh' | 'en' | 'other' {
  const trimmed = text.trim()
  if (!trimmed) return 'other'
  const cjk = trimmed.match(CJK_RE)?.length ?? 0
  const letters = trimmed.match(/[A-Za-z]/g)?.length ?? 0
  if (cjk > 0 && cjk >= letters * 0.15) return 'zh'
  if (letters > 0) return 'en'
  return 'other'
}

export function needsTranslation(title: string, abstract: string | null | undefined, target: Language): boolean {
  const sample = `${title} ${abstract ?? ''}`.trim()
  const source = textLanguage(sample)
  if (source === 'other') return false
  return source !== target
}

function parseJsonResponse(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  const payload = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned
  return JSON.parse(payload)
}

export class TranslationService {
  constructor(
    private readonly articles: ArticleRepo,
    private readonly settings: SettingsService
  ) {}

  cached(ids: string[], language: Language): ArticleTranslation[] {
    return this.articles.getTranslations(ids, language)
  }

  async translate(ids: string[], language: Language, includeAbstract: boolean): Promise<ArticleTranslationResult> {
    const target: Language = language === 'en' ? 'en' : 'zh'
    const unique = [...new Set(ids)].slice(0, 200)
    const sources = this.articles.translationSource(unique)
    if (!sources.length) {
      return { translations: [], requested: 0, provider: 'skip' }
    }
    const cached = this.articles.getTranslations(
      sources.map((source) => source.id),
      target
    )
    const cachedById = new Map(cached.map((item) => [item.articleId, item]))
    const pending = sources.filter((source) => {
      const existing = cachedById.get(source.id)
      if (!existing) return true
      if (includeAbstract && source.abstract && existing.fields !== 'all') return true
      return false
    })
    const relevant = pending.filter((source) => needsTranslation(source.title, source.abstract, target))
    if (!relevant.length) {
      return { translations: cached, requested: sources.length, provider: 'cache' }
    }

    const settings = this.settings.get()
    let provider
    try {
      provider = createProvider(this.settings.providerConfig()).provider
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    if (provider instanceof HeuristicProvider) {
      throw new Error(
        settings.appearance.language === 'zh'
          ? '文章翻译需要配置 AI API。请在设置中填写 OpenAI 兼容的接口与密钥。'
          : 'Article translation requires an AI API. Configure an OpenAI-compatible endpoint and key in Settings.'
      )
    }

    const batchSize = includeAbstract ? 8 : 20
    const results: ArticleTranslation[] = []
    for (let start = 0; start < relevant.length; start += batchSize) {
      const batch = relevant.slice(start, start + batchSize)
      const payload = batch.map((source) => ({
        id: source.id,
        title: source.title,
        abstract: includeAbstract ? (source.abstract ?? '') : ''
      }))
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You translate academic article metadata into ${target === 'zh' ? 'Simplified Chinese' : 'English'}.
Return strict JSON only:
{"items":[{"id":"the supplied id","title":"translated title","abstract":"translated abstract"}]}
Rules:
- Translate titles and abstracts faithfully. Do not summarize, shorten, or add claims.
- Preserve author names, journal names, gene/protein names, chemical names, abbreviations, numbers, equations, and DOIs.
- Keep established technical terminology in the target language; when no accepted translation exists, keep the original term.
- If an abstract is empty or not supplied, return an empty string for it.
- Never merge, drop, or reorder items. Return exactly one item per input id.`
        },
        {
          role: 'user',
          content: JSON.stringify({ target_language: target, items: payload })
        }
      ]
      const response = await provider.chat(messages, {
        temperature: 0,
        maxTokens: includeAbstract ? 3200 : 1400
      })
      const parsed = parseJsonResponse(response) as unknown
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
          ? ((parsed as { items: unknown[] }).items ?? [])
          : []
      const byId = new Map(
        batch.map((source) => [
          source.id,
          {
            title: source.title,
            abstract: source.abstract,
            fields: includeAbstract && source.abstract ? ('all' as const) : ('title' as const)
          }
        ])
      )
      const translatedAt = new Date().toISOString()
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as { id?: unknown; title?: unknown; abstract?: unknown }
        const id = typeof item.id === 'string' ? item.id : ''
        const source = byId.get(id)
        if (!source) continue
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        if (!title) continue
        const abstract =
          includeAbstract && typeof item.abstract === 'string' && item.abstract.trim()
            ? item.abstract.trim()
            : includeAbstract
              ? null
              : null
        const record = this.articles.saveTranslation({
          articleId: id,
          language: target,
          title: title.slice(0, 1200),
          abstract: abstract ? abstract.slice(0, 12000) : null,
          fields: includeAbstract && abstract ? 'all' : 'title',
          provider: 'ai',
          model: provider.model,
          createdAt: translatedAt
        })
        results.push(record)
      }
      if (!includeAbstract || start + batchSize < relevant.length) {
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    }

    if (!results.length) {
      throw new Error(
        settings.appearance.language === 'zh'
          ? 'AI 未返回可用的译文，请重试或检查模型输出。'
          : 'The AI returned no usable translations. Try again or check the model output.'
      )
    }
    return { translations: results, requested: sources.length, provider: provider.model || provider.id }
  }
}
