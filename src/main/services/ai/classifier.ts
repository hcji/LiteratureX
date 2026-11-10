import { CLASSIFIER_PROMPT_VERSION } from '@shared/constants'
import type {
  Article,
  ArticleCategory,
  Category,
  CategoryMergeSuggestion,
  CitationFormatTemplate,
  ClassificationItem,
  ClassificationOutput,
  ClassifyOutcome,
  Language,
  PdfMetadataDraft,
  TaxonomySuggestion
} from '@shared/types'
import { isCjk, normalizeDoi, normalizeTitle, truncate } from '@shared/normalize'
import type { ArticleRepo } from '../../db/repositories/articles'
import type { CategoryRepo } from '../../db/repositories/categories'
import type { SettingsService } from '../settings'
import { createProvider, HeuristicProvider, type AiProvider, type TaxonomyNode } from './providers'

export class ClassifierService {
  constructor(
    private readonly articles: ArticleRepo,
    private readonly categories: CategoryRepo,
    private readonly settings: SettingsService,
    private readonly emit: (type: 'articles:changed' | 'categories:changed', payload?: unknown) => void
  ) {}

  private taxonomy(language: Language = 'en'): TaxonomyNode[] {
    const localizedTerms = (keyword: Category['keywords'][number]): string[] => {
      const primary =
        language === 'zh' ? keyword.keywordZh ?? keyword.keyword : keyword.keywordEn ?? keyword.keyword
      const secondary = language === 'zh' ? keyword.keywordEn : keyword.keywordZh
      return [...new Set([primary, secondary].filter((value): value is string => Boolean(value && value.trim())))]
    }
    return this.categories
      .listFlat()
      .filter((category) => category.isActive)
      .map((category) => ({
        id: category.id,
        name: category.name,
        path: category.path ?? category.name,
        description: category.description,
        instructions: category.instructions,
        priority: category.priority,
        keywords: category.keywords.filter((keyword) => keyword.kind === 'keyword').flatMap(localizedTerms),
        synonyms: category.keywords.filter((keyword) => keyword.kind === 'synonym').flatMap(localizedTerms)
      }))
  }

  private articleContext(
    article: Article,
    language: Language,
    includeFullText = this.settings.get().ai.sendFullText
  ): {
    title: string
    abstract: string | null
    journal: string | null
    year: number | null
    doi: string | null
    keywords: string[]
    fulltext: string | null
    language: Language
  } {
    let fulltext: string | null = null
    if (includeFullText) {
      fulltext = this.articles.getFulltext(article.id)?.text ?? null
    }
    return {
      title: article.title,
      abstract: article.abstract ?? null,
      journal: article.journalTitle ?? null,
      year: article.year ?? null,
      doi: article.doi ?? null,
      keywords: article.keywords,
      fulltext: fulltext ? truncate(fulltext, 60000) : null,
      language
    }
  }

  private resolveProvider(): { provider: AiProvider; fallbackReason?: string } {
    return createProvider(this.settings.providerConfig())
  }

  async classifyArticle(
    articleId: string,
    options: {
      force?: boolean
      keywordCount?: number
      allowNewCategories?: boolean
      maxNewCategories?: number
      includeFullText?: boolean
      thinkingDepth?: 'low' | 'medium-low' | 'high'
      requireAssignment?: boolean
    } = {}
  ): Promise<ClassifyOutcome> {
    const article = this.articles.get(articleId)
    if (!article) throw new Error('Article not found')
    if (!options.force && article.lastClassifiedAt) {
      return {
        articleId,
        provider: 'skipped',
        model: '',
        classifications: article.categories,
        summary: article.aiSummary ?? '',
        researchTopics: article.keywords,
        unmatchedTopics: [],
        needsReview: article.needsReview,
        preservedManual: article.categories.filter((item) => item.decidedBy === 'user').length,
        createdCategories: 0
      }
    }
    const settings = this.settings.get()
    const taxonomy = this.taxonomy(settings.appearance.language)
    const newCategoryBudget = Math.max(0, Math.min(20, Math.round(options.maxNewCategories ?? 2)))
    const allowNewCategories = options.allowNewCategories === true && newCategoryBudget > 0
    if (!taxonomy.length && !allowNewCategories) {
      throw new Error('No active categories exist. Create your research taxonomy first, then classify.')
    }
    const { provider, fallbackReason } = this.resolveProvider()
    const request = {
      ...this.articleContext(
        article,
        settings.appearance.language,
        options.includeFullText ?? settings.ai.sendFullText
      ),
      keywordCount: Math.max(3, Math.min(20, Math.round(options.keywordCount ?? 8))),
      allowNewCategories,
      maxNewCategories: newCategoryBudget,
      thinkingDepth: options.thinkingDepth ?? 'medium-low',
      requireAssignment: options.requireAssignment === true,
      taxonomy
    }
    const started = Date.now()
    let raw
    let rawText = ''
    let model = provider.model
    try {
      const result = await provider.classify(request)
      raw = result.raw
      rawText = result.rawText
      model = result.model
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.articles.saveClassificationRecord({
        articleId,
        provider: provider.id,
        model,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        rawResponse: rawText,
        parsed: null,
        status: 'error',
        error: message,
        durationMs: Date.now() - started,
        thresholds: settings.ai.thresholds
      })
      throw new Error(message)
    }

    const taxonomyById = new Map(taxonomy.map((node) => [node.id, node]))
    const createdByTempId = new Map<string, TaxonomyNode>()
    let createdCount = 0
    if (allowNewCategories && raw.new_categories.length) {
      const referenced = new Set(raw.classifications.map((item) => item.category_id))
      const existingCategories = this.categories.listFlat().filter((category) => category.isActive)
      const budget = newCategoryBudget
      for (const proposal of raw.new_categories.slice(0, budget)) {
        if (!proposal.temp_id || !referenced.has(proposal.temp_id)) continue
        const name = proposal.name.trim().slice(0, 120)
        if (!name) continue
        const duplicate = existingCategories.find((category) => normalizeTitle(category.name) === normalizeTitle(name))
        if (duplicate) {
          createdByTempId.set(proposal.temp_id, {
            id: duplicate.id,
            name: duplicate.name,
            path: duplicate.path ?? duplicate.name,
            description: duplicate.description,
            instructions: duplicate.instructions,
            priority: duplicate.priority,
            keywords: duplicate.keywords.filter((keyword) => keyword.kind === 'keyword').map((keyword) => keyword.keyword),
            synonyms: duplicate.keywords.filter((keyword) => keyword.kind === 'synonym').map((keyword) => keyword.keyword)
          })
          continue
        }
        try {
          const category = this.categories.create({
            name,
            description:
              proposal.description?.trim().slice(0, 500) ||
              'Automatically created by the LLM while organizing unclassified articles.',
            keywords: (proposal.keywords ?? [])
              .map((keyword) => keyword.trim())
              .filter(Boolean)
              .slice(0, 12)
              .map((keyword) => ({
                keyword,
                ...(isCjk(keyword) ? { keywordZh: keyword } : { keywordEn: keyword })
              }))
          })
          existingCategories.push(category)
          createdCount += 1
          createdByTempId.set(proposal.temp_id, {
            id: category.id,
            name: category.name,
            path: category.path ?? category.name,
            description: category.description,
            instructions: category.instructions,
            priority: category.priority,
            keywords: category.keywords.filter((keyword) => keyword.kind === 'keyword').map((keyword) => keyword.keyword),
            synonyms: category.keywords.filter((keyword) => keyword.kind === 'synonym').map((keyword) => keyword.keyword)
          })
        } catch {
          /* skip invalid proposal */
        }
      }
      if (createdCount) this.emit('categories:changed', { reason: 'auto-created', count: createdCount })
    }
    const seen = new Map<string, ClassificationItem>()
    for (const item of raw.classifications) {
      const node = taxonomyById.get(item.category_id) ?? createdByTempId.get(item.category_id)
      if (!node) continue
      const confidence = Math.max(0, Math.min(1, item.confidence))
      const status: ClassificationItem['status'] =
        confidence >= settings.ai.thresholds.high
          ? 'auto'
          : confidence >= settings.ai.thresholds.medium
            ? 'provisional'
            : 'needs_review'
      const existing = seen.get(node.id)
      if (existing && existing.confidence >= confidence) continue
      seen.set(node.id, {
        categoryId: node.id,
        categoryName: node.path,
        confidence,
        evidence: item.evidence?.slice(0, 1200) ?? '',
        matchedKeywords: [...new Set(item.matched_keywords ?? [])].slice(0, 15),
        reasoning: item.reasoning?.slice(0, 800) ?? '',
        status
      })
    }
    const classifications = [...seen.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 12)
    const needsReview =
      raw.needs_human_review ||
      classifications.some((item) => item.status === 'provisional' || item.status === 'needs_review')

    const output: ClassificationOutput = {
      classifications,
      summary: raw.summary?.slice(0, 1500) ?? '',
      researchTopics: [...new Set(raw.research_topics ?? [])].slice(0, request.keywordCount),
      unmatchedTopics: [...new Set(raw.unmatched_topics ?? [])].slice(0, 15),
      needsHumanReview: needsReview
    }

    this.articles.saveClassificationRecord({
      articleId,
      provider: provider.id,
      model,
      promptVersion: CLASSIFIER_PROMPT_VERSION,
      rawResponse: rawText,
      parsed: raw,
      status: 'success',
      error: null,
      durationMs: Date.now() - started,
      thresholds: settings.ai.thresholds
    })
    const applied = this.articles.applyAiClassification(articleId, output, {
      provider: provider.id,
      model,
      promptVersion: CLASSIFIER_PROMPT_VERSION
    })
    this.emit('articles:changed', { id: articleId, reason: 'classified' })
    if (fallbackReason) {
      // The fallback reason is informational; the provider id makes it explicit in the UI.
    }
    return {
      articleId,
      provider: provider.id,
      model,
      classifications: applied.applied,
      summary: output.summary,
      researchTopics: output.researchTopics,
      unmatchedTopics: output.unmatchedTopics,
      needsReview,
      preservedManual: applied.preservedManual,
      createdCategories: createdCount
    }
  }

  async classifyMany(
    articleIds: string[],
    options: {
      force?: boolean
      keywordCount?: number
      allowNewCategories?: boolean
      maxNewCategories?: number
      includeFullText?: boolean
      thinkingDepth?: 'low' | 'medium-low' | 'high'
      requireAssignment?: boolean
    } = {},
    onProgress?: (done: number, total: number, currentId: string) => void
  ): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    let succeeded = 0
    let failed = 0
    const errors: string[] = []
    const total = articleIds.length
    let remainingNew = Math.max(0, Math.min(20, Math.round(options.maxNewCategories ?? 2)))
    for (let index = 0; index < articleIds.length; index += 1) {
      const id = articleIds[index]
      onProgress?.(index, total, id)
      try {
        const outcome = await this.classifyArticle(id, {
          force: options.force ?? false,
          keywordCount: options.keywordCount,
          allowNewCategories: options.allowNewCategories && remainingNew > 0,
          maxNewCategories: options.allowNewCategories ? remainingNew : 0,
          includeFullText: options.includeFullText,
          thinkingDepth: options.thinkingDepth,
          requireAssignment: options.requireAssignment
        })
        remainingNew = Math.max(0, remainingNew - (outcome.createdCategories ?? 0))
        if (outcome.provider !== 'skipped') succeeded += 1
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${id}: ${message}`)
      }
      onProgress?.(index + 1, total, id)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return { succeeded, failed, errors }
  }

  async suggestMergedCategory(
    categories: Array<{ name: string; description?: string | null; keywords: string[] }>,
    language: Language
  ): Promise<CategoryMergeSuggestion> {
    const fallbackKeywords = [...new Set(categories.flatMap((category) => category.keywords))].slice(0, 12)
    const names = categories.map((category) => category.name).filter(Boolean)
    const fallbackName = (names.slice(0, 2).join(' & ') || 'Merged category').slice(0, 60)
    const fallbackDescription = categories
      .map((category) => category.description?.trim())
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .slice(0, 240)
    const fallback: CategoryMergeSuggestion = {
      name: fallbackName,
      description: fallbackDescription,
      keywords: fallbackKeywords,
      provider: 'local'
    }
    const { provider } = this.resolveProvider()
    if (provider instanceof HeuristicProvider) return fallback
    try {
      const response = await provider.chat(
        [
          {
            role: 'system',
            content: `You merge several research categories into one clear category for a personal literature library.
Return strict JSON only:
{"name":"short merged category name","description":"one sentence describing the merged scope","keywords":["keyword1","keyword2"]}
Rules:
- Keep the name under 60 characters; avoid generic words like "Misc" or "Other".
- Cover the shared theme without inventing a field that none of the inputs belongs to.
- Write name and description in ${language === 'zh' ? 'Chinese' : 'English'}.
- Provide 3 to 12 concise keywords, including important terms from the inputs.`
          },
          {
            role: 'user',
            content: JSON.stringify({
              categories: categories.map((category) => ({
                name: category.name,
                description: category.description ?? null,
                keywords: category.keywords
              }))
            })
          }
        ],
        { temperature: 0.2, maxTokens: 500 }
      )
      const cleaned = response.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
      const first = cleaned.indexOf('{')
      const last = cleaned.lastIndexOf('}')
      const parsed = JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned) as {
        name?: unknown
        description?: unknown
        keywords?: unknown
      }
      const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 80) : ''
      const description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 400) : ''
      const keywords = Array.isArray(parsed.keywords)
        ? [
            ...new Set(
              parsed.keywords
                .filter((keyword): keyword is string => typeof keyword === 'string')
                .map((keyword) => keyword.trim())
                .filter(Boolean)
            )
          ].slice(0, 15)
        : []
      return {
        name: name || fallbackName,
        description: description || fallbackDescription,
        keywords: keywords.length ? keywords : fallbackKeywords,
        provider: 'ai'
      }
    } catch {
      return fallback
    }
  }

  async analyzeCitationFormat(
    example: string,
    language: Language
  ): Promise<Omit<CitationFormatTemplate, 'id' | 'source' | 'createdAt'>> {
    const trimmed = example.trim()
    if (!trimmed) throw new Error('Paste a citation example first')
    const { provider } = this.resolveProvider()
    if (provider instanceof HeuristicProvider) {
      throw new Error('Configure an AI API key in LiteratureX before analyzing a citation example.')
    }
    const response = await provider.chat(
      [
        {
          role: 'system',
          content: `You convert bibliographic citation examples into reusable plain-text templates.
Return strict JSON only:
{"name":"short style name","description":"one sentence","inText":"template for an in-text citation","bibliography":"template for one bibliography entry","numbered":true}
Use these placeholders and keep the example's punctuation/order:
{authors}, {author}, {year}, {title}, {journal}, {volume}, {issue}, {pages}, {doi}, {url}, {index}.
{authors} is the full author list; {author} is the first author's family name; {index} is the citation number.
Do not invent values from the example; replace every real value with the matching placeholder.
If the bibliography example is numbered, set numbered to true and put {index} at the start with the same numbering format (for example "[{index}] " or "{index}. ").
If it is not numbered, set numbered to false and do not include {index} in the bibliography.
If the example has both an in-text and a bibliography form, encode both. Otherwise infer a sensible in-text form.
Write name and description in ${language === 'zh' ? 'Chinese' : 'English'}.`
        },
        {
          role: 'user',
          content: JSON.stringify({ language, example: trimmed })
        }
      ],
      { temperature: 0.1, maxTokens: 900 }
    )
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    let parsed: {
      name?: unknown
      description?: unknown
      inText?: unknown
      bibliography?: unknown
      numbered?: unknown
    }
    try {
      parsed = JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned) as typeof parsed
    } catch {
      throw new Error('The AI response was not valid JSON')
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 120) : ''
    const inText = typeof parsed.inText === 'string' ? parsed.inText.trim().slice(0, 400) : ''
    const bibliography = typeof parsed.bibliography === 'string' ? parsed.bibliography.trim().slice(0, 2000) : ''
    if (!name || !inText || !bibliography) {
      throw new Error('The AI response did not contain a usable citation template')
    }
    return {
      name,
      description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 500) : '',
      inText,
      bibliography,
      numbered:
        typeof parsed.numbered === 'boolean' ? parsed.numbered : bibliography.indexOf('{index}') >= 0
    }
  }

  async extractPdfMetadata(text: string, fileName?: string | null): Promise<PdfMetadataDraft | null> {
    const sample = text.trim().slice(0, 24000)
    if (sample.length < 200) return null
    const { provider } = this.resolveProvider()
    if (provider instanceof HeuristicProvider) return null
    const response = await provider.chat(
      [
        {
          role: 'system',
          content: `You extract bibliographic metadata from the first pages of an academic PDF.
Return strict JSON only:
{"title":"...","authors":["..."],"abstract":"...","journalTitle":"...","year":2024,"volume":"...","issue":"...","pages":"...","doi":"...","keywords":["..."],"articleType":"..."}
Rules:
- Use only facts explicitly present in the supplied text. Never invent or guess missing values.
- Use null for a missing scalar and [] for missing lists.
- Preserve the original language and author order.
- title is the paper title, not the journal name or section heading.
- abstract is the paper abstract, not the first paragraph of the body.
- doi must be a bare DOI such as 10.1234/abc, or null.
- keywords and articleType are optional; use []/null when absent.`
        },
        {
          role: 'user',
          content: `FILE: ${fileName ?? ''}\n\nPDF TEXT:\n${sample}`
        }
      ],
      { temperature: 0, maxTokens: 1400 }
    )
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned) as Record<string, unknown>
    } catch {
      throw new Error('The AI response was not valid JSON')
    }
    const stringValue = (value: unknown, max: number): string | null => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed ? trimmed.slice(0, max) : null
    }
    const stringList = (value: unknown, max: number): string[] => {
      if (!Array.isArray(value)) return []
      return [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0 && item.length < 160)
        )
      ].slice(0, max)
    }
    const yearValue = Number(parsed.year)
    const draft: PdfMetadataDraft = {
      title: stringValue(parsed.title, 500),
      authors: stringList(parsed.authors, 50),
      abstract: stringValue(parsed.abstract, 6000),
      journalTitle: stringValue(parsed.journalTitle, 300),
      year: Number.isFinite(yearValue) && yearValue >= 1800 && yearValue <= 2100 ? Math.trunc(yearValue) : null,
      volume: stringValue(parsed.volume, 100),
      issue: stringValue(parsed.issue, 100),
      pages: stringValue(parsed.pages, 100),
      doi: normalizeDoi(stringValue(parsed.doi, 300)),
      keywords: stringList(parsed.keywords, 30),
      articleType: stringValue(parsed.articleType, 100)
    }
    const useful =
      draft.title ||
      draft.doi ||
      (draft.authors?.length ?? 0) > 0 ||
      draft.abstract ||
      draft.journalTitle ||
      draft.year
    return useful ? draft : null
  }

  async pendingArticleIds(limit = 50): Promise<string[]> {
    return this.articles.listIdsForClassification(limit)
  }

  taxonomySignature(): string {
    return this.taxonomy(this.settings.get().appearance.language)
      .map((node) => `${node.id}:${node.path}:${node.keywords.length}`)
      .join('|')
  }

  async suggestTaxonomy(): Promise<TaxonomySuggestion[]> {
    const unmatched = new Map<string, number>()
    const recorded = this.articles.recentUnmatchedTopics(400)
    for (const topic of recorded) {
      const key = topic.trim()
      if (!key || key.length < 3) continue
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1)
    }
    if (!unmatched.size) {
      const rows = this.articles.listIdsNeedingReview(200)
      for (const id of rows) {
        const article = this.articles.get(id)
        if (!article) continue
        for (const topic of article.keywords) {
          const key = topic.trim()
          if (!key || key.length < 3) continue
          unmatched.set(key, (unmatched.get(key) ?? 0) + 1)
        }
      }
    }
    const topTopics = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    const taxonomy = this.taxonomy(this.settings.get().appearance.language)
    const existingTitles = new Set(this.categories.listSuggestions('pending').map((item) => item.title.toLowerCase()))
    const created: TaxonomySuggestion[] = []

    if (!taxonomy.length || topTopics.length < 2) {
      return []
    }

    let suggestions: Array<{
      type: TaxonomySuggestion['type']
      title: string
      rationale: string
      parent_id?: string | null
      name?: string
      keywords?: string[]
      category_ids?: string[]
      evidence?: string
    }> = []

    const { provider } = this.resolveProvider()
    if (!(provider instanceof HeuristicProvider)) {
      try {
        const response = await provider.chat(
          [
            {
              role: 'system',
              content: `You help a researcher improve a personal literature taxonomy. Given the current taxonomy and frequently encountered uncategorized topics, propose at most 5 high-value improvements. Return strict JSON:
{"suggestions":[{"type":"new_subcategory"|"new_keyword"|"missing_topic"|"merge","title":"short UI title","rationale":"why","parent_id":"existing category uuid or null","name":"new category name if applicable","keywords":["..."],"category_ids":["..."],"evidence":"supporting topics"}]}
Never propose changes that duplicate existing categories. Use parent_id only from the provided taxonomy.`
            },
            {
              role: 'user',
              content: JSON.stringify({
                taxonomy: taxonomy.map((node) => ({ id: node.id, path: node.path, keywords: node.keywords })),
                uncategorized_topics: topTopics.map(([topic, count]) => ({ topic, count }))
              })
            }
          ],
          { temperature: 0.2, maxTokens: 1200 }
        )
        const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
        const first = cleaned.indexOf('{')
        const last = cleaned.lastIndexOf('}')
        const parsed = JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned) as {
          suggestions?: typeof suggestions
        }
        suggestions = parsed.suggestions ?? []
      } catch {
        suggestions = []
      }
    }

    if (!suggestions.length) {
      suggestions = topTopics
        .filter(([, count]) => count >= 2)
        .slice(0, 5)
        .map(([topic, count]) => ({
          type: 'missing_topic' as const,
          title: `New topic: ${topic}`,
          rationale: `“${topic}” appeared in ${count} classified papers but is not represented in the taxonomy.`,
          parent_id: null,
          name: topic,
          keywords: [topic],
          evidence: `${count} papers`
        }))
    }

    const taxonomyIds = new Set(taxonomy.map((node) => node.id))
    for (const suggestion of suggestions) {
      if (!suggestion.title || existingTitles.has(suggestion.title.toLowerCase())) continue
      if (suggestion.parent_id && !taxonomyIds.has(suggestion.parent_id)) suggestion.parent_id = null
      const record = this.categories.createSuggestion({
        type: suggestion.type,
        title: suggestion.title,
        rationale: suggestion.rationale ?? '',
        payload: {
          parentId: suggestion.parent_id ?? null,
          name: suggestion.name ?? suggestion.title,
          keywords: suggestion.keywords ?? [],
          categoryIds: suggestion.category_ids ?? []
        },
        evidence: suggestion.evidence ?? ''
      })
      existingTitles.add(record.title.toLowerCase())
      created.push(record)
    }
    if (created.length) this.emit('categories:changed', { suggestions: created.length })
    return created
  }

  acceptSuggestion(id: string): TaxonomySuggestion | null {
    const suggestion = this.categories.listSuggestions().find((item) => item.id === id)
    if (!suggestion) return null
    if (suggestion.type === 'new_keyword') {
      const parentId = suggestion.payload.parentId
      if (parentId) {
        const parent = this.categories.get(parentId)
        if (parent) {
          this.categories.update(parentId, {
            keywords: [
              ...parent.keywords.map((keyword) => ({ keyword: keyword.keyword, kind: keyword.kind, weight: keyword.weight })),
              ...(suggestion.payload.keywords ?? []).map((keyword) => ({ keyword, kind: 'keyword' as const, weight: 1 }))
            ]
          })
        }
      }
    } else if (suggestion.type === 'new_subcategory' || suggestion.type === 'missing_topic') {
      if (suggestion.payload.parentId && !this.categories.get(suggestion.payload.parentId)) {
        suggestion.payload.parentId = null
      }
      this.categories.create({
        name: suggestion.payload.name || suggestion.title,
        parentId: suggestion.payload.parentId ?? null,
        description: suggestion.rationale,
        keywords: (suggestion.payload.keywords ?? []).map((keyword) => ({ keyword, kind: 'keyword' as const, weight: 1 }))
      })
    }
    this.categories.setSuggestionStatus(id, 'accepted')
    this.emit('categories:changed', { id })
    return this.categories.listSuggestions().find((item) => item.id === id) ?? null
  }

  dismissSuggestion(id: string): void {
    this.categories.setSuggestionStatus(id, 'dismissed')
    this.emit('categories:changed', { id })
  }

  /** Returns the current classification of an article with evidence, for the review UI. */
  reviewInfo(articleId: string): ArticleCategory[] {
    return this.articles.listArticleCategories(articleId)
  }
}
