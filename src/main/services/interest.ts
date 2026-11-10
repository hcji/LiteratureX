import type {
  Article,
  InterestMatchedCategory,
  InterestMatchArticle,
  InterestMatchReport,
  InterestProfile,
  InterestProfileCategory,
  InterestScore,
  InterestTheme,
  Language
} from '@shared/types'
import { normalizeTitle, truncate } from '@shared/normalize'
import type { AppDatabase } from '../db/database'
import type { ArticleRepo, InterestCorpusArticle } from '../db/repositories/articles'
import type { SettingsService } from './settings'
import { HeuristicProvider, createProvider, type AiProvider, type ChatMessage } from './ai/providers'

interface ProfileVector {
  articleCount: number
  analyzedArticles: number
  language: Language
  /** L2-normalized term weights. */
  terms: Record<string, number>
  categories: Record<string, number>
  categoryNames: Record<string, string>
  signature: string
}

interface CorpusSnapshot {
  signature: string
  docs: InterestCorpusArticle[]
  idf: Map<string, number>
  categoryCount: Map<string, number>
  journalCount: Map<string, number>
}

const ENGLISH_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'were',
  'was',
  'are',
  'has',
  'have',
  'had',
  'been',
  'being',
  'into',
  'using',
  'used',
  'use',
  'based',
  'study',
  'studies',
  'paper',
  'article',
  'research',
  'results',
  'result',
  'method',
  'methods',
  'analysis',
  'approach',
  'data',
  'new',
  'also',
  'can',
  'may',
  'our',
  'their',
  'its',
  'between',
  'among',
  'under',
  'over',
  'more',
  'most',
  'than',
  'such',
  'via',
  'two',
  'three',
  'first',
  'high',
  'low',
  'however',
  'therefore',
  'thus',
  'here',
  'show',
  'shows',
  'shown',
  'propose',
  'proposed',
  'present',
  'presented',
  'provide',
  'provides',
  'including',
  'include',
  'included',
  'different',
  'significant',
  'significantly',
  'compared',
  'respectively',
  'well',
  'both',
  'each',
  'other',
  'which',
  'what',
  'when',
  'where',
  'while',
  'about',
  'within',
  'without',
  'across',
  'during',
  'after',
  'before',
  'through',
  'not',
  'all',
  'any',
  'but'
])

const CJK_STOPWORDS = new Set([
  '研究',
  '方法',
  '结果',
  '分析',
  '基于',
  '本文',
  '我们',
  '以及',
  '通过',
  '不同',
  '影响',
  '作用',
  '数据',
  '进行',
  '表明',
  '显示',
  '具有',
  '可以',
  '一个',
  '一种',
  '这些',
  '该文',
  '文章',
  '文献',
  '问题',
  '过程',
  '相关',
  '主要',
  '重要',
  '提高',
  '增加',
  '降低',
  '使用',
  '采用',
  '发现',
  '认为',
  '提出',
  '构建',
  '实现'
])

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function tokenizeInterestText(value: string): string[] {
  const lower = value.toLowerCase()
  const tokens: string[] = []
  for (const match of lower.matchAll(/[a-z][a-z0-9'-]{2,}/g)) {
    const token = match[0].replace(/^['-]+|['-]+$/g, '')
    if (token.length >= 3 && !ENGLISH_STOPWORDS.has(token)) tokens.push(token)
  }
  for (const match of lower.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let index = 0; index < run.length - 1; index += 1) {
      const token = run.slice(index, index + 2)
      if (!CJK_STOPWORDS.has(token)) tokens.push(token)
    }
  }
  return tokens
}

function termCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokenizeInterestText(value)) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

function articleTermCounts(article: { title: string; abstract?: string | null; keywords: string[] }): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (source: Map<string, number>, weight: number): void => {
    for (const [token, count] of source) counts.set(token, (counts.get(token) ?? 0) + count * weight)
  }
  add(termCounts(article.title), 3)
  add(termCounts(article.keywords.join(' ')), 2)
  if (article.abstract) add(termCounts(article.abstract.slice(0, 2400)), 1)
  return counts
}

function normalizeVector(weights: Map<string, number>, limit = 1600): Map<string, number> {
  if (!weights.size) return new Map()
  const top = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  const norm = Math.sqrt(top.reduce((sum, [, weight]) => sum + weight * weight, 0)) || 1
  return new Map(top.map(([term, weight]) => [term, weight / norm]))
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) return 0
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function displayTerm(term: string): string {
  if (/^[a-z]/.test(term)) return term.charAt(0).toUpperCase() + term.slice(1)
  return term
}

function bandOf(score: number): InterestMatchReport['band'] {
  if (score >= 0.68) return 'high'
  if (score >= 0.42) return 'medium'
  return 'low'
}

function parseJsonResponse(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  const payload = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned
  return JSON.parse(payload)
}

export class InterestService {
  private cachedSnapshot: CorpusSnapshot | null = null
  private cachedVector: ProfileVector | null = null
  private readonly termCache = new Map<string, { updatedAt: string; counts: Map<string, number> }>()

  constructor(
    private readonly database: AppDatabase,
    private readonly articles: ArticleRepo,
    private readonly settings: SettingsService
  ) {}

  private language(): Language {
    return this.settings.get().appearance.language
  }

  private cachedTermCounts(article: Article): Map<string, number> {
    const cached = this.termCache.get(article.id)
    if (cached && cached.updatedAt === article.updatedAt) return cached.counts
    const counts = articleTermCounts({ title: article.title, abstract: article.abstract, keywords: article.keywords })
    if (this.termCache.size > 12000) this.termCache.clear()
    this.termCache.set(article.id, { updatedAt: article.updatedAt, counts })
    return counts
  }

  private emptyProfile(language: Language): InterestProfile {
    return {
      status: 'empty',
      language,
      articleCount: 0,
      analyzedArticles: 0,
      updatedAt: null,
      summary:
        language === 'zh'
          ? '文库暂无文献。导入论文或把订阅文章加入文库后，LiteratureX 会自动生成研究兴趣画像，用于订阅内容的匹配排序。'
          : 'Your library is empty. Import papers or save subscription items to the library and LiteratureX will build a research interest profile for match ranking.',
      highlights: [],
      themes: [],
      keywords: [],
      categories: [],
      journals: [],
      provider: 'local',
      model: null,
      warning: null
    }
  }

  private snapshot(): CorpusSnapshot {
    const signature = this.articles.interestSignature()
    if (this.cachedSnapshot?.signature === signature) return this.cachedSnapshot
    const docs = this.articles.interestCorpus()
    const documentFrequency = new Map<string, number>()
    const categoryCount = new Map<string, number>()
    const journalCount = new Map<string, number>()
    for (const doc of docs) {
      const terms = articleTermCounts(doc)
      for (const term of terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
      const seenCategories = new Set<string>()
      for (const category of doc.categories) {
        if (seenCategories.has(category.categoryId)) continue
        seenCategories.add(category.categoryId)
        categoryCount.set(category.categoryId, (categoryCount.get(category.categoryId) ?? 0) + 1)
      }
      if (doc.journalTitle) journalCount.set(doc.journalTitle, (journalCount.get(doc.journalTitle) ?? 0) + 1)
    }
    const total = docs.length
    const idf = new Map<string, number>()
    for (const [term, df] of documentFrequency) {
      idf.set(term, Math.log((total + 1) / (df + 1)) + 1)
    }
    const snapshot = { signature, docs, idf, categoryCount, journalCount }
    this.cachedSnapshot = snapshot
    return snapshot
  }

  private buildLocalProfile(
    language: Language,
    corpus: CorpusSnapshot
  ): { profile: InterestProfile; vector: ProfileVector } {
    const docs = corpus.docs
    if (!docs.length) {
      return {
        profile: this.emptyProfile(language),
        vector: {
          articleCount: 0,
          analyzedArticles: 0,
          language,
          terms: {},
          categories: {},
          categoryNames: {},
          signature: corpus.signature
        }
      }
    }

    const termWeights = new Map<string, number>()
    for (const doc of docs) {
      const counts = articleTermCounts(doc)
      for (const [term, count] of counts) {
        const weight = (1 + Math.log(count)) * (corpus.idf.get(term) ?? 1)
        termWeights.set(term, (termWeights.get(term) ?? 0) + weight)
      }
    }
    const normalizedTerms = normalizeVector(termWeights)
    const terms: Record<string, number> = {}
    for (const [term, weight] of normalizedTerms) terms[term] = weight

    const categoryRows = [...corpus.categoryCount.entries()]
      .map(([categoryId, count]) => {
        const samples = docs.flatMap((doc) => doc.categories.filter((category) => category.categoryId === categoryId))
        const sample = samples[0]
        const confidence = samples.reduce((sum, category) => sum + category.confidence, 0) / Math.max(1, samples.length)
        return {
          categoryId,
          name: sample?.name ?? categoryId,
          color: sample?.color ?? null,
          count,
          weight: 0,
          confidence
        }
      })
      .sort((a, b) => b.count - a.count)
    const maxCategoryCount = Math.max(1, ...categoryRows.map((row) => row.count))
    const profileCategories: InterestProfileCategory[] = categoryRows.map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      color: row.color,
      count: row.count,
      weight: round(row.count / maxCategoryCount, 3)
    }))
    const categoryWeights: Record<string, number> = {}
    const categoryNames: Record<string, string> = {}
    for (const row of profileCategories) {
      categoryWeights[row.categoryId] = row.weight
      categoryNames[row.categoryId] = row.name
    }

    const themes: InterestTheme[] = profileCategories.slice(0, 6).map((category) => ({
      id: `category:${category.categoryId}`,
      label: category.name,
      weight: category.weight,
      articleCount: category.count,
      keywords: this.categoryKeywords(docs, category.categoryId),
      categoryIds: [category.categoryId],
      color: category.color
    }))
    if (themes.length < 3) {
      const rawKeywordCounts = new Map<string, number>()
      for (const doc of docs) {
        for (const keyword of doc.keywords) {
          const key = keyword.trim()
          if (key) rawKeywordCounts.set(key, (rawKeywordCounts.get(key) ?? 0) + 1)
        }
      }
      const maxKeywordCount = Math.max(1, ...rawKeywordCounts.values())
      const usedLabels = new Set(themes.map((theme) => theme.label.toLowerCase()))
      const keywordThemes = [...rawKeywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .filter(([keyword]) => {
          const label = keyword.toLowerCase()
          return !usedLabels.has(label) && ![...usedLabels].some((used) => used.includes(label))
        })
        .slice(0, 3 - themes.length)
      for (const [keyword, count] of keywordThemes) {
        themes.push({
          id: `keyword:${keyword}`,
          label: keyword,
          weight: round(Math.max(0.18, Math.min(0.85, (count / maxKeywordCount) * 0.8)), 3),
          articleCount: count,
          keywords: [keyword],
          categoryIds: [],
          color: null
        })
      }
    }
    if (themes.length && themes.length < 3) {
      themes.push({
        id: 'other',
        label: language === 'zh' ? '其他方向' : 'Other directions',
        weight: 0.2,
        articleCount: docs.length,
        keywords: [],
        categoryIds: [],
        color: null
      })
    }
    if (themes.length) {
      const maxWeight = Math.max(...themes.map((theme) => theme.weight), 0.01)
      for (const theme of themes) {
        theme.weight = round(Math.max(0.12, Math.min(1, theme.weight / maxWeight)), 3)
      }
    }

    const keywordStats = new Map<string, { display: string; count: number; weight: number }>()
    for (const doc of docs) {
      for (const keyword of doc.keywords) {
        const key = keyword.trim()
        if (!key) continue
        const normalized = normalizeTitle(key)
        const weight = normalized
          .split(' ')
          .filter(Boolean)
          .reduce((sum, token) => sum + (normalizedTerms.get(token) ?? 0), 0)
        const existing = keywordStats.get(normalized)
        if (existing) {
          existing.count += 1
          existing.weight = Math.max(existing.weight, weight)
        } else {
          keywordStats.set(normalized, { display: key, count: 1, weight })
        }
      }
    }
    const keywords = [...keywordStats.values()]
      .sort((a, b) => b.count - a.count || b.weight - a.weight)
      .slice(0, 20)
      .map((item) => ({ term: item.display, weight: round(item.weight, 4) }))
    if (keywords.length < 8) {
      for (const [term, weight] of [...normalizedTerms.entries()].sort((a, b) => b[1] - a[1])) {
        const label = displayTerm(term)
        if (keywords.some((keyword) => keyword.term.toLowerCase() === label.toLowerCase())) continue
        keywords.push({ term: label, weight: round(weight, 4) })
        if (keywords.length >= 12) break
      }
    }

    const journals = [...corpus.journalCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))
    const frequentJournals = journals.filter((journal) => journal.count > 1)

    const analyzed = docs.length
    const topCategories = profileCategories.slice(0, 3)
    const years = docs.map((doc) => doc.year).filter((year): year is number => Boolean(year))
    const yearRange = years.length
      ? Math.min(...years) === Math.max(...years)
        ? String(Math.min(...years))
        : `${Math.min(...years)}–${Math.max(...years)}`
      : null
    const zh = language === 'zh'
    const summary = topCategories.length
      ? zh
        ? `你的文库共 ${analyzed} 篇文献，研究兴趣集中在${topCategories
            .map((category) => `${category.name}（${category.count} 篇）`)
            .join('、')}。高频主题词包括 ${keywords
            .slice(0, 5)
            .map((keyword) => keyword.term)
            .join('、')}${
            frequentJournals.length
              ? `，常读期刊为 ${frequentJournals.slice(0, 2).map((journal) => journal.name).join('、')}`
              : ''
          }。订阅文章的“兴趣匹配”排序会优先展示与这些方向最接近的条目。`
        : `Your library contains ${analyzed} papers, with research interests concentrated in ${topCategories
            .map((category) => `${category.name} (${category.count} papers)`)
            .join(', ')}. Frequent concepts include ${keywords
            .slice(0, 5)
            .map((keyword) => keyword.term)
            .join(', ')}${
            frequentJournals.length
              ? `, and you read most often from ${frequentJournals.slice(0, 2).map((journal) => journal.name).join(', ')}`
              : ''
          }. The interest-match sort in Discover prioritizes subscription items closest to these directions.`
      : zh
        ? `你的文库共 ${analyzed} 篇文献，目前主要由 ${keywords
            .slice(0, 5)
            .map((keyword) => keyword.term)
            .join('、')} 等主题构成。创建分类并完成 AI 分类后，画像会按研究方向进一步细化。`
        : `Your library contains ${analyzed} papers, currently centered on ${keywords
            .slice(0, 5)
            .map((keyword) => keyword.term)
            .join(', ')}. Create categories and run classification to refine the profile by research direction.`

    const highlights: string[] = []
    highlights.push(
      zh
        ? `基于 ${analyzed} 篇库内文献${yearRange ? `（${yearRange}）` : ''}`
        : `Based on ${analyzed} library papers${yearRange ? ` (${yearRange})` : ''}`
    )
    if (profileCategories.length) {
      highlights.push(
        zh
          ? `覆盖 ${profileCategories.length} 个研究方向，核心为 ${profileCategories[0].name}`
          : `${profileCategories.length} research areas, led by ${profileCategories[0].name}`
      )
    }
    if (keywords.length) {
      highlights.push(
        zh
          ? `高频概念：${keywords.slice(0, 6).map((keyword) => keyword.term).join('、')}`
          : `Frequent concepts: ${keywords.slice(0, 6).map((keyword) => keyword.term).join(', ')}`
      )
    }
    if (journals.length) {
      const frequent = frequentJournals.length > 0
      highlights.push(
        zh
          ? `${frequent ? '常读期刊' : '来源期刊'}：${journals.slice(0, 3).map((journal) => journal.name).join('、')}`
          : `${frequent ? 'Top journals' : 'Source journals'}: ${journals.slice(0, 3).map((journal) => journal.name).join(', ')}`
      )
    }

    const profile: InterestProfile = {
      status: 'ready',
      language,
      articleCount: this.articles.list({ scope: 'library', limit: 1 }).total,
      analyzedArticles: analyzed,
      updatedAt: new Date().toISOString(),
      summary,
      highlights,
      themes,
      keywords,
      categories: profileCategories,
      journals,
      provider: 'local',
      model: null,
      warning: null
    }
    return {
      profile,
      vector: {
        articleCount: analyzed,
        analyzedArticles: analyzed,
        language,
        terms,
        categories: categoryWeights,
        categoryNames,
        signature: corpus.signature
      }
    }
  }

  private categoryKeywords(docs: InterestCorpusArticle[], categoryId: string): string[] {
    const counts = new Map<string, number>()
    for (const doc of docs) {
      if (!doc.categories.some((category) => category.categoryId === categoryId)) continue
      for (const keyword of doc.keywords) {
        const key = keyword.trim()
        if (!key) continue
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([keyword]) => keyword)
  }

  private readStored(): { profile: InterestProfile; vector: ProfileVector } | null {
    const row = this.database.db
      .prepare('SELECT profile_json, vector_json, signature, language FROM interest_profiles WHERE id = ?')
      .get('default') as { profile_json: string; vector_json: string | null; signature: string; language: string } | undefined
    if (!row?.vector_json) return null
    try {
      return {
        profile: JSON.parse(row.profile_json) as InterestProfile,
        vector: JSON.parse(row.vector_json) as ProfileVector
      }
    } catch {
      return null
    }
  }

  private save(profile: InterestProfile, vector: ProfileVector): void {
    const now = profile.updatedAt ?? new Date().toISOString()
    this.database.db
      .prepare(
        `INSERT INTO interest_profiles
           (id, language, signature, profile_json, vector_json, article_count, provider, model, created_at, updated_at)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           language = excluded.language,
           signature = excluded.signature,
           profile_json = excluded.profile_json,
           vector_json = excluded.vector_json,
           article_count = excluded.article_count,
           provider = excluded.provider,
           model = excluded.model,
           updated_at = excluded.updated_at`
      )
      .run(
        profile.language,
        vector.signature,
        JSON.stringify(profile),
        JSON.stringify(vector),
        profile.analyzedArticles,
        profile.provider,
        profile.model ?? null,
        now,
        now
      )
  }

  /** Returns the cached profile, rebuilding local statistics when the library changed. */
  getProfile(): InterestProfile {
    const language = this.language()
    const stored = this.readStored()
    const signature = this.articles.interestSignature()
    if (stored && stored.profile.language === language && stored.vector.signature === signature) {
      this.cachedVector = stored.vector
      return stored.profile
    }
    const corpus = this.snapshot()
    const { profile, vector } = this.buildLocalProfile(language, corpus)
    this.save(profile, vector)
    this.cachedVector = vector
    return profile
  }

  /** Rebuilds the profile; optionally replaces the summary/themes with an AI reading. */
  async refresh(options: { useAi?: boolean } = {}): Promise<InterestProfile> {
    const language = this.language()
    const corpus = this.snapshot()
    const { profile, vector } = this.buildLocalProfile(language, corpus)
    if (!options.useAi || !corpus.docs.length) {
      this.save(profile, vector)
      this.cachedVector = vector
      return profile
    }
    const enriched = await this.enrichWithAi(profile, corpus, language)
    const next = enriched.profile ?? { ...profile, warning: enriched.warning ?? null }
    this.save(next, vector)
    this.cachedVector = vector
    return next
  }

  private async enrichWithAi(
    base: InterestProfile,
    corpus: CorpusSnapshot,
    language: Language
  ): Promise<{ profile: InterestProfile | null; warning: string | null }> {
    let provider: AiProvider
    try {
      provider = createProvider(this.settings.providerConfig()).provider
    } catch (error) {
      return { profile: null, warning: error instanceof Error ? error.message : String(error) }
    }
    if (provider instanceof HeuristicProvider) {
      return {
        profile: null,
        warning:
          language === 'zh'
            ? '未配置 AI API，画像由本地统计生成。'
            : 'No AI API is configured; the profile was generated with local statistics.'
      }
    }
    const samples = corpus.docs.slice(0, 24).map((doc) => ({
      title: doc.title,
      journal: doc.journalTitle,
      year: doc.year,
      keywords: doc.keywords.slice(0, 8),
      categories: doc.categories.slice(0, 4).map((category) => category.name)
    }))
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You write a concise personal research-interest profile for a researcher's private literature library.
Return strict JSON only:
{"summary":"2-4 sentence profile in ${language === 'zh' ? 'Simplified Chinese' : 'English'}","highlights":["3-5 short insights"],"themes":[{"label":"short theme name","weight":0.9,"keywords":["..."]}]}
Rules:
- Use only the supplied library statistics; never invent papers, methods, or findings.
- Provide 5 to 7 themes. Weight is relative importance from 0 to 1; the strongest theme is 1.
- Theme labels must be concise (2-5 words) and suitable as radar axes.
- Mention the dominant research directions, recurring concepts, and how subscription items should be prioritized.
- Write all text in ${language === 'zh' ? 'Simplified Chinese' : 'English'}.`
      },
      {
        role: 'user',
        content: JSON.stringify({
          library_size: corpus.docs.length,
          categories: base.categories.slice(0, 12),
          top_keywords: base.keywords.slice(0, 20),
          journals: base.journals,
          samples
        })
      }
    ]
    try {
      const response = await provider.chat(messages, { temperature: 0.2, maxTokens: 1200 })
      const parsed = parseJsonResponse(response) as { summary?: unknown; highlights?: unknown; themes?: unknown }
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 2000) : ''
      if (!summary) {
        return {
          profile: null,
          warning: language === 'zh' ? 'AI 返回的画像为空，已保留本地统计。' : 'The AI returned an empty profile; local statistics were kept.'
        }
      }
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, 240))
            .filter(Boolean)
            .slice(0, 6)
        : base.highlights
      const themesRaw = Array.isArray(parsed.themes) ? parsed.themes : []
      const categoryByName = new Map(base.categories.map((category) => [category.name.toLowerCase(), category]))
      const themes: InterestTheme[] = []
      for (const raw of themesRaw.slice(0, 7)) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as { label?: unknown; weight?: unknown; keywords?: unknown }
        const label = typeof item.label === 'string' ? item.label.trim().slice(0, 60) : ''
        if (!label) continue
        const weight = Math.max(0, Math.min(1, Number(item.weight) || 0))
        const keywords = Array.isArray(item.keywords)
          ? item.keywords
              .filter((keyword): keyword is string => typeof keyword === 'string')
              .map((keyword) => keyword.trim())
              .filter(Boolean)
              .slice(0, 8)
          : []
        const matched = categoryByName.get(label.toLowerCase())
        themes.push({
          id: `ai:${label.toLowerCase().replace(/\s+/g, '-')}`,
          label,
          weight: weight || 0.5,
          articleCount: matched?.count ?? 0,
          keywords,
          categoryIds: matched ? [matched.categoryId] : [],
          color: matched?.color ?? null
        })
      }
      if (themes.length >= 3) {
        const max = Math.max(...themes.map((theme) => theme.weight), 0.01)
        for (const theme of themes) theme.weight = round(Math.max(0.12, theme.weight / max), 3)
      }
      return {
        profile: {
          ...base,
          summary,
          highlights: highlights.length ? highlights : base.highlights,
          themes: themes.length >= 3 ? themes : base.themes,
          provider: 'ai',
          model: provider.model,
          warning: null
        },
        warning: null
      }
    } catch (error) {
      return {
        profile: null,
        warning:
          (language === 'zh' ? 'AI 画像生成失败，已保留本地统计：' : 'AI profile generation failed; local statistics were kept: ') +
          (error instanceof Error ? error.message : String(error))
      }
    }
  }

  vector(): ProfileVector {
    const signature = this.articles.interestSignature()
    if (this.cachedVector && this.cachedVector.signature === signature) return this.cachedVector
    const stored = this.readStored()
    if (stored && stored.vector.signature === signature && stored.profile.language === this.language()) {
      this.cachedVector = stored.vector
      return stored.vector
    }
    this.getProfile()
    if (this.cachedVector) return this.cachedVector
    const built = this.buildLocalProfile(this.language(), this.snapshot())
    this.cachedVector = built.vector
    return built.vector
  }

  scoreArticle(article: Article): InterestScore {
    return this.scoreWithVector(article, this.vector())
  }

  private scoreWithVector(article: Article, vector: ProfileVector): InterestScore {
    const categories = article.categories.filter((category) => category.status !== 'rejected')
    const maxConfidence = categories.reduce((max, category) => Math.max(max, category.confidence), 0)
    if (!vector.articleCount) {
      const score = maxConfidence * 0.75
      return {
        articleId: article.id,
        score: round(score),
        categoryScore: round(score),
        keywordScore: 0,
        matchedCategories: categories.map((category) => category.categoryName),
        matchedKeywords: []
      }
    }
    const counts = this.cachedTermCounts(article)
    let dot = 0
    let candidateNorm = 0
    const matchedTerms: Array<{ term: string; weight: number }> = []
    for (const [term, count] of counts) {
      const weight = 1 + Math.log(count)
      candidateNorm += weight * weight
      const profileWeight = vector.terms[term]
      if (profileWeight) {
        dot += profileWeight * weight
        matchedTerms.push({ term, weight: profileWeight })
      }
    }
    const keywordScore = candidateNorm > 0 ? Math.min(1, dot / Math.sqrt(candidateNorm)) : 0
    const rawKeywordMatches = article.keywords.filter((keyword) => {
      const tokens = normalizeTitle(keyword).split(' ').filter(Boolean)
      return tokens.some((token) => (vector.terms[token] ?? 0) > 0)
    })
    const sortedTerms = matchedTerms
      .sort((a, b) => b.weight - a.weight)
      .map((item) => displayTerm(item.term))
    const matchedKeywords =
      rawKeywordMatches.length >= 3
        ? [...new Set(rawKeywordMatches)].slice(0, 8)
        : [...new Set([...rawKeywordMatches, ...sortedTerms])].slice(0, 8)

    const categoryNames: string[] = []
    let categoryScore = 0
    if (Object.keys(vector.categories).length) {
      for (const category of categories) {
        const weight = vector.categories[category.categoryId]
        if (!weight) continue
        const statusFactor =
          category.status === 'confirmed'
            ? 1
            : category.status === 'auto'
              ? 0.95
              : category.status === 'provisional'
                ? 0.8
                : 0.6
        categoryScore += weight * category.confidence * statusFactor
        categoryNames.push(category.categoryName)
      }
      categoryScore = Math.min(1, categoryScore / 1.15)
    } else {
      categoryScore = maxConfidence * 0.7
      categoryNames.push(...categories.map((category) => category.categoryName))
    }

    let score: number
    if (categoryScore > 0 && keywordScore > 0) score = categoryScore * 0.55 + keywordScore * 0.45
    else if (categoryScore > 0) score = categoryScore * 0.85
    else score = keywordScore * 0.9
    return {
      articleId: article.id,
      score: round(Math.max(0, Math.min(1, score))),
      categoryScore: round(categoryScore),
      keywordScore: round(keywordScore),
      matchedCategories: [...new Set(categoryNames)],
      matchedKeywords
    }
  }

  scoreArticles(articles: Article[]): Record<string, InterestScore> {
    const vector = this.vector()
    const scores: Record<string, InterestScore> = {}
    for (const article of articles) scores[article.id] = this.scoreWithVector(article, vector)
    return scores
  }

  async evaluate(articleId: string, deep = false): Promise<InterestMatchReport> {
    const article = this.articles.get(articleId)
    if (!article) throw new Error('Article not found')
    const language = this.language()
    const profile = this.getProfile()
    const scoreInfo = this.scoreArticle(article)
    const profileScore = scoreInfo.score
    const corpus = this.snapshot()
    const candidateCounts = articleTermCounts({ title: article.title, abstract: article.abstract, keywords: article.keywords })
    const candidateCategories = new Set(article.categories.map((category) => category.categoryId))
    const candidateKeywordMap = new Map(
      article.keywords
        .map((keyword) => [normalizeTitle(keyword), keyword.trim()] as const)
        .filter(([normalized]) => Boolean(normalized))
    )
    const candidateKeywords = new Set(candidateKeywordMap.keys())
    const similar: Array<InterestMatchArticle & { sharedKeywordsRaw: string[] }> = []
    for (const doc of corpus.docs) {
      if (doc.id === articleId) continue
      const docCategories = new Set(doc.categories.map((category) => category.categoryId))
      const docKeywords = new Set(doc.keywords.map((keyword) => normalizeTitle(keyword)).filter(Boolean))
      const categoryScore = jaccard(candidateCategories, docCategories)
      const keywordScore = jaccard(candidateKeywords, docKeywords)
      const docCounts = articleTermCounts(doc)
      let dot = 0
      let leftNorm = 0
      let rightNorm = 0
      for (const [term, count] of candidateCounts) {
        const idf = corpus.idf.get(term) ?? 1
        const weight = (1 + Math.log(count)) * idf
        leftNorm += weight * weight
        if (docCounts.has(term)) dot += weight * (1 + Math.log(docCounts.get(term) ?? 1)) * idf
      }
      for (const [term, count] of docCounts) {
        const idf = corpus.idf.get(term) ?? 1
        const weight = (1 + Math.log(count)) * idf
        rightNorm += weight * weight
      }
      const textScore = leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0
      const score = candidateCategories.size
        ? categoryScore * 0.5 + keywordScore * 0.25 + textScore * 0.25
        : keywordScore * 0.4 + textScore * 0.6
      if (score <= 0.01) continue
      const sharedKeywordsRaw = [...candidateKeywordMap.entries()]
        .filter(([normalized]) => docKeywords.has(normalized))
        .map(([, keyword]) => keyword)
      const sharedCategories = article.categories
        .filter((category) => docCategories.has(category.categoryId))
        .map((category) => category.categoryName)
      similar.push({
        articleId: doc.id,
        title: doc.title,
        journalTitle: doc.journalTitle,
        year: doc.year,
        publicationDate: doc.publicationDate,
        score: round(Math.min(1, score)),
        sharedKeywords: sharedKeywordsRaw.slice(0, 6),
        sharedCategories: [...new Set(sharedCategories)].slice(0, 4),
        sharedKeywordsRaw
      })
    }
    similar.sort((a, b) => b.score - a.score)
    const top = similar.slice(0, 6)
    const topThree = top.slice(0, 3)
    const libraryScore = top.length
      ? top[0].score * 0.65 + (topThree.reduce((sum, item) => sum + item.score, 0) / topThree.length) * 0.35
      : 0
    const overall = Math.max(0, Math.min(1, profileScore * 0.55 + libraryScore * 0.45))
    const band = bandOf(overall)
    const vector = this.vector()
    const matchedCategories: InterestMatchedCategory[] = article.categories
      .filter((category) => category.status !== 'rejected')
      .map((category) => ({
        categoryId: category.categoryId,
        name: category.categoryName,
        color: category.color,
        confidence: category.confidence,
        weight: vector.categories[category.categoryId] ?? 0
      }))
      .sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
      .slice(0, 8)
    const sharedKeywords = [...new Set(top.flatMap((item) => item.sharedKeywords))].slice(0, 10)
    const themes = [...new Set([...scoreInfo.matchedCategories, ...top.flatMap((item) => item.sharedCategories)])].slice(0, 8)
    const zh = language === 'zh'
    const pct = Math.round(overall * 100)
    const best = top[0]
    const summary =
      band === 'high'
        ? zh
          ? `这篇论文与你的研究兴趣高度一致（综合匹配度 ${pct}%）。它命中了你长期关注的主题${
              themes.length ? `（${themes.slice(0, 3).join('、')}）` : ''
            }，并且与库内已有文献${best ? `《${truncate(best.title, 60)}》（${Math.round(best.score * 100)}%）` : ''}在内容上相近，值得优先阅读。`
          : `This paper aligns strongly with your research interests (overall match ${pct}%). It hits themes you follow${
              themes.length ? ` (${themes.slice(0, 3).join(', ')})` : ''
            } and overlaps with ${best ? `"${truncate(best.title, 60)}" (${Math.round(best.score * 100)}%)` : 'your library'} in content, so it is worth prioritizing.`
        : band === 'medium'
          ? zh
            ? `这篇论文与你的研究兴趣有一定重合（综合匹配度 ${pct}%）。${
                themes.length ? `相关方向包括 ${themes.slice(0, 3).join('、')}。` : ''
              }${best ? `库内最接近的文献是《${truncate(best.title, 60)}》（${Math.round(best.score * 100)}%）。` : ''}可作为扩展阅读。`
            : `This paper partially overlaps with your research interests (overall match ${pct}%). ${
                themes.length ? `Related directions include ${themes.slice(0, 3).join(', ')}. ` : ''
              }${best ? `The closest library paper is "${truncate(best.title, 60)}" (${Math.round(best.score * 100)}%).` : ''} Consider it for broader reading.`
          : zh
            ? `这篇论文与你的研究兴趣重合较低（综合匹配度 ${pct}%）。${
                best ? `库内最相似的文献《${truncate(best.title, 60)}》也只有 ${Math.round(best.score * 100)}% 的相似度。` : '库内没有找到明显相似的文献。'
              }可以按需浏览。`
            : `This paper has limited overlap with your research interests (overall match ${pct}%). ${
                best ? `Even the closest library paper, "${truncate(best.title, 60)}", is only ${Math.round(best.score * 100)}% similar.` : 'No clearly similar library paper was found.'
              } Skim it as needed.`
    const highlights: string[] = []
    if (best) {
      highlights.push(
        zh
          ? `最接近的库内文献：《${truncate(best.title, 80)}》· ${Math.round(best.score * 100)}%`
          : `Closest library paper: "${truncate(best.title, 80)}" · ${Math.round(best.score * 100)}%`
      )
    }
    if (scoreInfo.matchedCategories.length) {
      highlights.push(
        zh
          ? `命中研究主题：${scoreInfo.matchedCategories.slice(0, 5).join('、')}`
          : `Matched interests: ${scoreInfo.matchedCategories.slice(0, 5).join(', ')}`
      )
    }
    if (scoreInfo.matchedKeywords.length) {
      highlights.push(
        zh
          ? `共享概念：${scoreInfo.matchedKeywords.slice(0, 6).join('、')}`
          : `Shared concepts: ${scoreInfo.matchedKeywords.slice(0, 6).join(', ')}`
      )
    }
    if (!top.length) highlights.push(zh ? '库内暂无内容相近的文献。' : 'No content-similar papers in the library.')

    const report: InterestMatchReport = {
      articleId,
      title: article.title,
      language,
      overall: round(overall),
      band,
      profileScore: round(profileScore),
      libraryScore: round(libraryScore),
      summary,
      highlights,
      matchedCategories,
      sharedKeywords,
      themes,
      similarArticles: top.map(({ sharedKeywordsRaw: _raw, ...item }) => item),
      comparedWith: corpus.docs.length,
      provider: 'local',
      model: null,
      warning: null,
      generatedAt: new Date().toISOString()
    }
    if (!deep) return report
    return this.deepEvaluate(report, article, profile, top)
  }

  private async deepEvaluate(
    report: InterestMatchReport,
    article: Article,
    profile: InterestProfile,
    similar: InterestMatchArticle[]
  ): Promise<InterestMatchReport> {
    let provider: AiProvider
    try {
      provider = createProvider(this.settings.providerConfig()).provider
    } catch (error) {
      return { ...report, warning: error instanceof Error ? error.message : String(error) }
    }
    if (provider instanceof HeuristicProvider) {
      return {
        ...report,
        warning: report.language === 'zh' ? '未配置 AI API，显示本地匹配分析。' : 'No AI API is configured; showing the local match analysis.'
      }
    }
    try {
      const response = await provider.chat(
        [
          {
            role: 'system',
            content: `You assess whether a candidate paper matches a researcher's library and interests.
You are given the interest profile, the candidate metadata, and the most similar library papers with similarity scores.
Return strict JSON only:
{"summary":"3-5 sentences in ${report.language === 'zh' ? 'Simplified Chinese' : 'English'}","highlights":["3-5 short points"]}
Rules:
- Base every claim on the supplied text. Never invent findings, methods, or citations.
- Explain the degree of content overlap and which library themes it connects to.
- If overlap is weak, say so plainly and suggest why it might still be useful.
- Do not repeat the numeric score mechanically; interpret it.`
          },
          {
            role: 'user',
            content: JSON.stringify({
              profile: { summary: profile.summary, themes: profile.themes, categories: profile.categories.slice(0, 8) },
              candidate: {
                title: article.title,
                journal: article.journalTitle,
                year: article.year,
                abstract: truncate(article.abstract ?? '', 3000),
                keywords: article.keywords,
                categories: article.categories.map((category) => category.categoryName)
              },
              local_scores: { overall: report.overall, profile: report.profileScore, library: report.libraryScore, band: report.band },
              similar_library_papers: similar.map((item) => ({
                title: item.title,
                journal: item.journalTitle,
                year: item.year,
                similarity: item.score,
                shared_categories: item.sharedCategories,
                shared_keywords: item.sharedKeywords
              }))
            })
          }
        ],
        { temperature: 0.2, maxTokens: 900 }
      )
      const parsed = parseJsonResponse(response) as { summary?: unknown; highlights?: unknown }
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 2400) : ''
      if (!summary) {
        return { ...report, warning: report.language === 'zh' ? 'AI 未返回有效评价。' : 'The AI returned no usable assessment.' }
      }
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, 240))
            .filter(Boolean)
            .slice(0, 6)
        : report.highlights
      return {
        ...report,
        summary,
        highlights: highlights.length ? highlights : report.highlights,
        provider: 'ai',
        model: provider.model,
        warning: null
      }
    } catch (error) {
      return {
        ...report,
        warning:
          (report.language === 'zh' ? 'AI 评价失败，显示本地分析：' : 'AI assessment failed; showing the local analysis: ') +
          (error instanceof Error ? error.message : String(error))
      }
    }
  }
}
