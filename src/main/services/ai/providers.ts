import { z } from 'zod'
import type { Language } from '@shared/types'
import type { ProviderConfig } from '../settings'

export interface TaxonomyNode {
  id: string
  name: string
  path: string
  description?: string | null
  instructions?: string | null
  keywords: string[]
  synonyms: string[]
  priority: number
}

export interface ClassificationRequest {
  title: string
  abstract?: string | null
  journal?: string | null
  year?: number | null
  doi?: string | null
  keywords?: string[]
  fulltext?: string | null
  language: Language
  keywordCount?: number
  allowNewCategories?: boolean
  maxNewCategories?: number
  thinkingDepth?: 'low' | 'medium-low' | 'high'
  requireAssignment?: boolean
  taxonomy: TaxonomyNode[]
}

export interface NewCategoryProposal {
  temp_id: string
  name: string
  description?: string
  keywords?: string[]
}

export interface RawClassificationItem {
  category_id: string
  confidence: number
  evidence: string
  matched_keywords: string[]
  reasoning: string
}

export interface RawClassification {
  classifications: RawClassificationItem[]
  summary: string
  research_topics: string[]
  unmatched_topics: string[]
  needs_human_review: boolean
  new_categories: NewCategoryProposal[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiProvider {
  id: string
  label: string
  model: string
  classify(request: ClassificationRequest): Promise<{ raw: RawClassification; rawText: string; model: string }>
  chat(messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }): Promise<string>
  testConnection(): Promise<string>
}

const classificationSchema = z.object({
  classifications: z
    .array(
      z.object({
        category_id: z.string(),
        confidence: z.coerce.number().catch(0.5).transform((value) => Math.max(0, Math.min(1, value))),
        evidence: z.string().catch(''),
        matched_keywords: z.array(z.string()).catch([]),
        reasoning: z.string().catch('')
      })
    )
    .catch([]),
  summary: z.string().catch(''),
  research_topics: z.array(z.string()).catch([]),
  unmatched_topics: z.array(z.string()).catch([]),
  needs_human_review: z.boolean().catch(false),
  new_categories: z
    .array(
      z.object({
        temp_id: z.string().catch(''),
        name: z.string().catch(''),
        description: z.string().catch(''),
        keywords: z.array(z.string()).catch([])
      })
    )
    .catch([])
})

export function parseClassificationJson(text: string): RawClassification {
  let content = text.trim()
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  const first = content.indexOf('{')
  const last = content.lastIndexOf('}')
  if (first >= 0 && last > first) content = content.slice(first, last + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('The AI response was not valid JSON')
  }
  const result = classificationSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`The AI response did not match the classification schema: ${result.error.issues[0]?.message ?? 'unknown error'}`)
  }
  return result.data
}

function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
}

export function buildClassificationPrompt(request: ClassificationRequest): ChatMessage[] {
  const languageName = request.language === 'zh' ? 'Chinese' : 'English'
  const keywordCount = Math.max(3, Math.min(20, Math.round(request.keywordCount ?? 8)))
  const maxNewCategories = Math.max(0, Math.min(20, Math.round(request.maxNewCategories ?? 2)))
  const depth = request.thinkingDepth ?? 'medium-low'
  const depthInstruction =
    depth === 'low'
      ? 'Keep reasoning very brief (one short clause).'
      : depth === 'high'
        ? 'Reason carefully; use up to three concise sentences in reasoning when the assignment is ambiguous.'
        : 'Reason briefly; use one or two short sentences.'
  const taxonomy = request.taxonomy.map((node) => ({
    category_id: node.id,
    path: node.path,
    description: node.description ?? '',
    keywords: node.keywords,
    synonyms: node.synonyms,
    instructions: node.instructions ?? '',
    priority: node.priority
  }))
  const paper = {
    title: request.title,
    journal: request.journal ?? '',
    year: request.year ?? '',
    doi: request.doi ?? '',
    keywords: request.keywords ?? [],
    abstract: request.abstract ?? '',
    fulltext_excerpt: request.fulltext ? request.fulltext.slice(0, 45000) : ''
  }
  const system = `You are a meticulous scientific literature classifier for a researcher's personal library.
Your job: assign the paper to zero or more categories from the user's taxonomy. The taxonomy is user-defined and authoritative.
${request.allowNewCategories ? 'You may also propose new root categories when the paper genuinely does not fit the existing taxonomy.' : 'New categories are disabled for this run.'}
Thinking depth: ${depth}. ${depthInstruction}

Rules:
1. MULTI-LABEL. A paper can belong to several categories across different branches.
2. ${request.allowNewCategories ? 'Use category_id values that appear in the provided taxonomy, or a temp_id from new_categories that you propose. Never invent any other id.' : 'Use only category_id values that appear in the provided taxonomy. Never return a category that is not listed.'}
3. confidence is a calibrated number from 0 to 1. Use >0.85 only when the paper's core contribution clearly matches the category. Use 0.55-0.85 for plausible but secondary matches. Use <0.55 when uncertain.
4. evidence must quote or closely paraphrase specific text from the title, abstract, keywords, or full text. Never invent evidence.
5. matched_keywords must be terms actually present in the paper and relevant to the category.
6. reasoning is one short sentence explaining the assignment.
7. summary is 1-2 sentences in ${languageName}, describing the paper's topic and contribution.
8. research_topics: exactly ${keywordCount} concise keyword phrases in ${languageName}; prefer terms that would work for literature search.
9. unmatched_topics: topics the paper covers that the taxonomy does not represent well. Empty array if none.
10. needs_human_review is true when the assignment is ambiguous, the paper spans several categories weakly, or an important topic is missing from the taxonomy.
11. ${
    request.requireAssignment
      ? 'Always assign at least one category when the taxonomy is not empty. If nothing fits well, choose the closest category with a low confidence (below 0.55) and flag it for review.'
      : 'If nothing matches, return classifications: [] and explain in summary.'
  }
12. ${
    request.allowNewCategories && maxNewCategories > 0
      ? `NEW CATEGORIES: only if no existing category is a reasonable fit, propose up to ${maxNewCategories} new root categories in new_categories. Each needs a unique temp_id such as "new:1", a concise name, a one-sentence description, and 3-8 keywords. You may reference that temp_id in classifications. Never duplicate an existing category.`
      : 'new_categories must be an empty array.'
  }

Return STRICT JSON only, no markdown, matching exactly:
{
  "classifications": [
    {"category_id": "uuid or new:1", "confidence": 0.91, "evidence": "...", "matched_keywords": ["..."], "reasoning": "..."}
  ],
  "summary": "...",
  "research_topics": ["..."],
  "unmatched_topics": ["..."],
  "needs_human_review": false,
  "new_categories": [
    {"temp_id": "new:1", "name": "...", "description": "...", "keywords": ["..."]}
  ]
}`
  const user = `TAXONOMY:\n${JSON.stringify(taxonomy, null, 1)}\n\nPAPER:\n${JSON.stringify(paper, null, 1)}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

interface OpenAiChoice {
  message?: { content?: string | Array<{ type?: string; text?: string }> }
}

function contentToText(content?: string | Array<{ type?: string; text?: string }>): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.map((part) => part.text ?? '').join('')
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai-compatible'
  readonly label = 'OpenAI-compatible API'
  readonly model: string

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model
  }

  private endpoint(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async post(body: Record<string, unknown>, timeoutMs: number): Promise<string> {
    if (!this.config.apiKey) throw new Error('AI API key is not configured')
    let response: Response | null = null
    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch(this.endpoint('/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        })
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await this.sleep(900)
          continue
        }
        break
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await this.sleep(700)
          continue
        }
      }
    }
    if (!response) {
      throw new Error(`Could not reach the AI endpoint: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const detail = text.slice(0, 500)
      if (response.status === 401) throw new Error('AI authentication failed (401). Check the API key.')
      if (response.status === 404) throw new Error('AI endpoint returned 404. Check the base URL (it should end with /v1 for most providers).')
      if (response.status === 429) throw new Error('AI provider rate limit reached (429). Try again later.')
      throw new Error(`AI request failed (HTTP ${response.status}): ${detail}`)
    }
    const data = (await response.json()) as { choices?: OpenAiChoice[] }
    return contentToText(data.choices?.[0]?.message?.content)
  }

  async classify(request: ClassificationRequest): Promise<{ raw: RawClassification; rawText: string; model: string }> {
    if (!this.config.model) throw new Error('AI model name is not configured')
    const messages = buildClassificationPrompt(request)
    const base = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens
    }
    let text: string
    try {
      text = await this.post({ ...base, response_format: { type: 'json_object' } }, this.config.timeoutMs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/response_format|json|400/i.test(message)) throw error
      text = await this.post(base, this.config.timeoutMs)
    }
    if (!text.trim()) throw new Error('The AI returned an empty response')
    const raw = parseClassificationJson(text)
    return { raw, rawText: text, model: this.config.model }
  }

  async chat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const text = await this.post(
      {
        model: this.config.model,
        messages,
        temperature: options.temperature ?? this.config.temperature,
        max_tokens: options.maxTokens ?? this.config.maxTokens
      },
      this.config.timeoutMs
    )
    return text.trim()
  }

  async testConnection(): Promise<string> {
    if (!this.config.apiKey) throw new Error('API key is not set')
    try {
      const response = await fetch(this.endpoint('/models'), {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) {
        const data = (await response.json()) as { data?: unknown[] }
        return data.data?.length ? `Connected. ${data.data.length} models available.` : 'Connected to the AI endpoint.'
      }
    } catch {
      /* fall through to a small completion */
    }
    const text = await this.post(
      {
        model: this.config.model,
        messages: [
          { role: 'system', content: 'Reply with the single word OK.' },
          { role: 'user', content: 'ping' }
        ],
        max_tokens: 5,
        temperature: 0
      },
      20000
    )
    return text.trim() ? `Connected. Response: ${text.trim().slice(0, 40)}` : 'Connected to the AI endpoint.'
  }
}

export class HeuristicProvider implements AiProvider {
  readonly id = 'local-heuristic'
  readonly label = 'Local keyword classifier'
  readonly model = 'literaturex-heuristic-v1'

  async classify(request: ClassificationRequest): Promise<{ raw: RawClassification; rawText: string; model: string }> {
    const raw = this.classifyHeuristically(request)
    return { raw, rawText: JSON.stringify(raw), model: this.model }
  }

  async chat(): Promise<string> {
    throw new Error(
      'No AI API key is configured. Add an OpenAI-compatible endpoint and key in Settings to use the assistant and AI-generated summaries.'
    )
  }

  async testConnection(): Promise<string> {
    return 'Local heuristic classifier is active. Configure an API key to use a language model.'
  }

  private classifyHeuristically(request: ClassificationRequest): RawClassification {
    const title = request.title.toLowerCase()
    const abstract = (request.abstract ?? '').toLowerCase()
    const fulltext = (request.fulltext ?? '').toLowerCase()
    const keywordText = (request.keywords ?? []).join(' ').toLowerCase()
    const keywordLimit = Math.max(3, Math.min(20, Math.round(request.keywordCount ?? 8)))
    const matches: Array<{
      node: TaxonomyNode
      score: number
      keywords: string[]
      evidence: string
    }> = []

    for (const node of request.taxonomy) {
      const weightedTerms = new Map<string, number>()
      const addTerm = (term: string, weight: number): void => {
        const cleaned = term.trim().toLowerCase()
        if (cleaned.length <= 2) return
        weightedTerms.set(cleaned, Math.max(weightedTerms.get(cleaned) ?? 0, weight))
      }
      addTerm(node.name, 1)
      for (const segment of node.path.split(' / ')) addTerm(segment, 1)
      for (const keyword of node.keywords) addTerm(keyword, 1)
      for (const synonym of node.synonyms) addTerm(synonym, 0.6)
      let score = 0
      const hitKeywords: string[] = []
      const lengthWeight = (term: string): number => Math.min(2.2, 1 + term.split(/\s+/).length * 0.25)
      for (const [term, baseWeight] of weightedTerms) {
        const weight = lengthWeight(term) * baseWeight
        let termScore = 0
        if (title.includes(term)) termScore += 4 * weight
        if (keywordText.includes(term)) termScore += 3 * weight
        if (abstract.includes(term)) termScore += 2 * weight
        if (fulltext.includes(term)) termScore += 0.6 * weight
        if (termScore > 0) {
          score += termScore
          hitKeywords.push(term)
        }
      }
      if (node.priority) score += Math.min(1, node.priority / 10)
      if (score >= 0.9) {
        matches.push({
          node,
          score,
          keywords: [...new Set(hitKeywords)].slice(0, 8),
          evidence: this.findEvidence(request, hitKeywords)
        })
      }
    }

    matches.sort((a, b) => b.score - a.score)
    const top = matches.slice(0, 6)
    const classifications: RawClassificationItem[] = top.map((match) => {
      const confidence = Math.min(0.93, 0.38 + Math.log1p(match.score) / 3.1)
      return {
        category_id: match.node.id,
        confidence: Number(confidence.toFixed(3)),
        evidence: match.evidence,
        matched_keywords: match.keywords,
        reasoning: `Keyword overlap with ${match.node.path} (${match.keywords.slice(0, 3).join(', ')})`
      }
    })
    const summary = this.summarize(request)
    const researchTopics = [...new Set(top.flatMap((match) => match.keywords))].slice(0, keywordLimit)
    return {
      classifications,
      summary,
      research_topics: researchTopics,
      unmatched_topics: [],
      needs_human_review: classifications.length === 0,
      new_categories: []
    }
  }

  private findEvidence(request: ClassificationRequest, keywords: string[]): string {
    const source = request.abstract ?? ''
    const sentences = source.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 30)
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase()
      if (keywords.some((keyword) => lower.includes(keyword))) return sentence.slice(0, 320)
    }
    return request.title.slice(0, 240)
  }

  private summarize(request: ClassificationRequest): string {
    const abstract = (request.abstract ?? '').replace(/\s+/g, ' ').trim()
    if (abstract) {
      const sentences = abstract.split(/(?<=[.!?])\s+/).filter(Boolean)
      return sentences.slice(0, 2).join(' ').slice(0, 420)
    }
    return request.title
  }
}

export function createProvider(config: ProviderConfig): { provider: AiProvider; fallbackReason?: string } {
  if (config.mode === 'heuristic') return { provider: new HeuristicProvider() }
  if (config.apiKey && config.model) return { provider: new OpenAiProvider(config) }
  if (config.mode === 'openai') {
    if (!config.apiKey) throw new Error('OpenAI-compatible mode is selected but no API key is configured.')
    throw new Error('OpenAI-compatible mode is selected but the model name is empty.')
  }
  return {
    provider: new HeuristicProvider(),
    fallbackReason: config.apiKey ? 'AI model name is empty; using the local classifier.' : 'No API key configured; using the local classifier.'
  }
}
