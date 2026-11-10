import type {
  Article,
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantThread,
  Citation,
  Language
} from '@shared/types'
import { normalizeTitle, truncate } from '@shared/normalize'
import type { ArticleRepo } from '../../db/repositories/articles'
import type { AssistantRepo } from '../../db/repositories/assistant'
import type { CategoryRepo } from '../../db/repositories/categories'
import type { SettingsService } from '../settings'
import { HeuristicProvider, createProvider, type ChatMessage } from './providers'

interface ContextEntry {
  index: number
  articleId: string
  title: string
  journal: string | null
  year: number | null
  authors: string[]
  abstract: string | null
  summary: string | null
  keywords: string[]
  categories: string[]
  fulltextExcerpt: string | null
}

const SYSTEM_PROMPT = `You are a research literature assistant working exclusively with the user's local library. Follow these rules:
1. Every substantive claim must cite one of the provided papers using the bracket format [n] (n is the paper index). When you rely on full text, include the page when known, e.g. [2, p.4].
2. Never invent citations, papers, authors, findings, or page numbers. If the provided material does not support an answer, say so.
3. Clearly separate evidence from the papers ("According to [1]...") from your own inference ("This suggests...").
4. Be precise and concise. Prefer structured markdown with short headings or bullets.
5. Answer in the requested language.`

const OFFLINE_NOTICE_ZH = '当前未配置 AI API，以下内容由本地规则/抽取式分析生成。'
const OFFLINE_NOTICE_EN = 'No AI API is configured. The following is generated locally with extractive/rule-based analysis.'

export class AssistantService {
  constructor(
    private readonly articles: ArticleRepo,
    private readonly categories: CategoryRepo,
    private readonly settings: SettingsService,
    private readonly repo: AssistantRepo,
    private readonly emit: (type: 'assistant:changed', payload?: unknown) => void
  ) {}

  async handle(request: AssistantRequest): Promise<AssistantResponse> {
    const settings = this.settings.get()
    const language: Language = request.language ?? settings.appearance.language
    const context = this.buildContext(request, settings.assistant.defaultContextLimit, settings.assistant.sendFullText)
    if (!context.length && (request.mode === 'summarize' || request.mode === 'compare')) {
      throw new Error(language === 'zh' ? '请先选择至少一篇文献。' : 'Select at least one paper first.')
    }
    const thread = request.threadId ? this.requireThread(request.threadId) : this.repo.createThread(this.threadTitle(request, language))
    const userText = this.userMessageText(request, language, context.length)
    this.repo.addMessage(thread.id, 'user', userText, [])

    let content = ''
    let citations: Citation[] = []
    let offline = false
    let providerUsed = false
    let providerError: string | null = null

    try {
      const config = this.settings.providerConfig()
      if (config.mode !== 'heuristic' && config.apiKey && config.model) {
        const { provider } = createProvider(config)
        if (!(provider instanceof HeuristicProvider)) {
          providerUsed = true
          const messages = this.buildMessages(request, context, language)
          content = await provider.chat(messages, { temperature: 0.2, maxTokens: 1800 })
          citations = this.extractCitations(content, context)
        }
      }
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error)
    }

    if (!providerUsed || !content.trim()) {
      offline = true
      const fallback = await this.offlineAnswer(request, context, language)
      content = fallback.content
      citations = fallback.citations
      if (providerError) content = `> AI 请求失败：${providerError}\n\n${content}`
    }

    const assistantMessage = this.repo.addMessage(thread.id, 'assistant', content, citations)
    this.emit('assistant:changed', { threadId: thread.id })
    return {
      thread: this.repo.getThread(thread.id) ?? thread,
      messages: [...this.repo.messages(thread.id)],
      offline
    }
  }

  private requireThread(id: string): AssistantThread {
    const thread = this.repo.getThread(id)
    if (!thread) throw new Error('Assistant thread not found')
    return thread
  }

  private threadTitle(request: AssistantRequest, language: Language): string {
    const action =
      request.mode === 'summarize'
        ? language === 'zh'
          ? '文献摘要'
          : 'Paper summary'
        : request.mode === 'compare'
          ? language === 'zh'
            ? '文献对比'
            : 'Paper comparison'
          : request.mode === 'trends'
            ? language === 'zh'
              ? '研究趋势'
              : 'Research trends'
            : request.mode === 'related'
              ? language === 'zh'
                ? '相关文献'
                : 'Related literature'
              : request.question?.slice(0, 60) || (language === 'zh' ? '新对话' : 'New conversation')
    return action
  }

  private userMessageText(request: AssistantRequest, language: Language, count: number): string {
    if (request.question?.trim()) return request.question.trim()
    const zh = language === 'zh'
    if (request.mode === 'summarize') return zh ? `请总结选中的 ${count} 篇文献。` : `Summarize the ${count} selected papers.`
    if (request.mode === 'compare') return zh ? `请比较选中的 ${count} 篇文献。` : `Compare the ${count} selected papers.`
    if (request.mode === 'trends') return zh ? '请分析相关文献的研究趋势。' : 'Analyze research trends in these papers.'
    if (request.mode === 'related') return zh ? '找出与这些文献相关的库内文献。' : 'Find related papers in my library.'
    return zh ? '请基于我的文献库回答问题。' : 'Answer a question based on my library.'
  }

  private buildContext(request: AssistantRequest, limit: number, includeFullText: boolean): ContextEntry[] {
    const ids: string[] = []
    if (request.articleIds?.length) ids.push(...request.articleIds)
    else if (request.categoryId) {
      const idsInCategory = this.categories.descendantIds(request.categoryId)
      const result = this.articles.list(
        { scope: 'library', categoryId: request.categoryId, limit },
        idsInCategory
      )
      ids.push(...result.items.map((item) => item.id))
    } else if (request.mode === 'related' || request.mode === 'trends' || request.mode === 'chat') {
      if (request.question) {
        const result = this.articles.search({ scope: 'library', search: request.question, limit })
        ids.push(...result.items.map((item) => item.article.id))
      }
      if (!ids.length) {
        const result = this.articles.list({ scope: 'library', sort: 'created_at', limit })
        ids.push(...result.items.map((item) => item.id))
      }
    }
    const unique = [...new Set(ids)].slice(0, Math.max(1, limit))
    return unique
      .map((id, index) => {
        const article = this.articles.get(id)
        if (!article) return null
        let fulltextExcerpt: string | null = null
        if (includeFullText) {
          const fulltext = this.articles.getFulltext(id)
          if (fulltext) {
            if (fulltext.pages.length) {
              const parts: string[] = []
              let chars = 0
              for (let page = 0; page < fulltext.pages.length && chars < 10000; page += 1) {
                const text = fulltext.pages[page]
                parts.push(`[p.${page + 1}] ${text}`)
                chars += text.length
              }
              fulltextExcerpt = parts.join('\n')
            } else {
              fulltextExcerpt = truncate(fulltext.text, 10000)
            }
          }
        }
        return {
          index: index + 1,
          articleId: article.id,
          title: article.title,
          journal: article.journalTitle,
          year: article.year,
          authors: article.authors.map((author) => author.name),
          abstract: article.abstract,
          summary: article.aiSummary,
          keywords: article.keywords,
          categories: article.categories.map((category) => category.categoryPath),
          fulltextExcerpt
        }
      })
      .filter((entry): entry is ContextEntry => Boolean(entry))
  }

  private buildMessages(request: AssistantRequest, context: ContextEntry[], language: Language): ChatMessage[] {
    const modeInstruction =
      request.mode === 'summarize'
        ? 'For each paper, extract: research objective, methods, key results, conclusions, and main contribution. Use a short section per paper.'
        : request.mode === 'compare'
          ? 'Compare the papers: research questions, methods/data, findings, agreements and contradictions, limitations, and open gaps. Use a comparison table plus synthesis.'
          : request.mode === 'trends'
            ? 'Analyze research trends: dominant topics, methods, publication years/venues, emerging directions, and gaps. Base every observation on the papers.'
            : request.mode === 'related'
              ? 'Identify which papers in the provided context are most related and explain the relationships (shared topics, methods, or findings).'
              : 'Answer the user question using only the provided papers. If the evidence is insufficient, say so explicitly.'
    const payload = context.map((entry) => ({
      index: entry.index,
      title: entry.title,
      authors: entry.authors,
      journal: entry.journal,
      year: entry.year,
      keywords: entry.keywords,
      categories: entry.categories,
      abstract: entry.abstract,
      ai_summary: entry.summary,
      fulltext: entry.fulltextExcerpt
    }))
    return [
      { role: 'system', content: `${SYSTEM_PROMPT}\nResponse language: ${language === 'zh' ? 'Chinese' : 'English'}\nTask: ${modeInstruction}` },
      {
        role: 'user',
        content: `PAPERS:\n${JSON.stringify(payload, null, 1)}\n\nREQUEST:\n${request.question?.trim() || modeInstruction}`
      }
    ]
  }

  private extractCitations(text: string, context: ContextEntry[]): Citation[] {
    const byIndex = new Map(context.map((entry) => [entry.index, entry]))
    const citations = new Map<number, Citation>()
    const regex = /\[(\d{1,2})(?:\s*,\s*p\.?\s*(\d{1,4}))?\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text))) {
      const index = Number(match[1])
      const entry = byIndex.get(index)
      if (!entry) continue
      const page = match[2] ? Number(match[2]) : null
      const existing = citations.get(index)
      if (!existing || (!existing.page && page)) {
        citations.set(index, {
          index,
          articleId: entry.articleId,
          title: entry.title,
          page,
          snippet: entry.abstract ? truncate(entry.abstract, 240) : null
        })
      }
    }
    return [...citations.values()].sort((a, b) => a.index - b.index)
  }

  private async offlineAnswer(
    request: AssistantRequest,
    context: ContextEntry[],
    language: Language
  ): Promise<{ content: string; citations: Citation[] }> {
    const zh = language === 'zh'
    const notice = zh ? OFFLINE_NOTICE_ZH : OFFLINE_NOTICE_EN
    const citations: Citation[] = []
    if (request.mode === 'summarize' || request.mode === 'compare') {
      const lines: string[] = [`> ${notice}`, '']
      const list = context.length ? context : []
      for (const entry of list) {
        citations.push({
          index: entry.index,
          articleId: entry.articleId,
          title: entry.title,
          page: null,
          snippet: entry.abstract ? truncate(entry.abstract, 240) : null
        })
        const sentences = this.keySentences(entry.abstract ?? '', zh)
        lines.push(`### [${entry.index}] ${entry.title}`)
        lines.push(
          `*${[entry.authors.slice(0, 3).join(', '), entry.journal, entry.year].filter(Boolean).join(' · ')}*`
        )
        if (request.mode === 'compare') {
          if (entry.categories.length) lines.push(`- ${zh ? '分类' : 'Categories'}: ${entry.categories.join('; ')}`)
          if (entry.keywords.length) lines.push(`- ${zh ? '关键词' : 'Keywords'}: ${entry.keywords.join(', ')}`)
        }
        for (const sentence of sentences) lines.push(`- ${sentence}`)
        lines.push('')
      }
      if (request.mode === 'compare' && context.length > 1) {
        const shared = this.sharedTopics(context)
        if (shared.length) {
          lines.push(`**${zh ? '共同主题' : 'Shared topics'}**: ${shared.join(', ')}`)
        }
      }
      return { content: lines.join('\n').trim(), citations }
    }
    if (request.mode === 'related') {
      const seed = context[0]
      if (!seed) return { content: `> ${notice}\n\n${zh ? '没有足够的文献用于查找相关文献。' : 'Not enough papers to find related work.'}`, citations }
      const related = this.relatedArticles(seed.articleId, 8)
      const lines = [`> ${notice}`, '']
      related.forEach((article, index) => {
        const citationIndex = index + 1
        citations.push({
          index: citationIndex,
          articleId: article.article.id,
          title: article.article.title,
          page: null,
          snippet: article.article.abstract ? truncate(article.article.abstract, 220) : null
        })
        lines.push(
          `- **[${citationIndex}] ${article.article.title}** — ${[article.article.journalTitle, article.article.year].filter(Boolean).join(', ')} (${zh ? '相关度' : 'score'} ${article.score.toFixed(1)})`
        )
      })
      if (!related.length) lines.push(zh ? '库中没有找到明显相关的文献。' : 'No clearly related papers were found in the library.')
      return { content: lines.join('\n'), citations }
    }
    if (request.mode === 'trends') {
      const years = new Map<number, number>()
      const topics = new Map<string, number>()
      for (const entry of context) {
        if (entry.year) years.set(entry.year, (years.get(entry.year) ?? 0) + 1)
        for (const category of entry.categories) topics.set(category, (topics.get(category) ?? 0) + 1)
        for (const keyword of entry.keywords) topics.set(keyword, (topics.get(keyword) ?? 0) + 1)
      }
      const lines = [`> ${notice}`, '', zh ? '## 本地统计分析' : '## Local statistical analysis', '']
      const yearList = [...years.entries()].sort((a, b) => a[0] - b[0])
      if (yearList.length) {
        lines.push(`**${zh ? '年份分布' : 'Year distribution'}**: ${yearList.map(([year, count]) => `${year}: ${count}`).join(', ')}`)
      }
      const topTopics = [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      if (topTopics.length) {
        lines.push('')
        lines.push(`**${zh ? '高频主题' : 'Top topics'}**:`)
        for (const [topic, count] of topTopics) lines.push(`- ${topic} (${count})`)
      }
      return { content: lines.join('\n'), citations }
    }
    const result = this.articles.search({ scope: 'library', search: request.question ?? '', limit: 5 })
    const lines = [`> ${notice}`, '']
    if (!result.items.length) {
      lines.push(zh ? '我的文献库中没有找到与该问题相关的内容。' : 'I could not find relevant material in your library.')
      return { content: lines.join('\n'), citations }
    }
    lines.push(zh ? '以下是库内检索到的相关文献片段（未进行 AI 综合）：' : 'Relevant passages retrieved from your library (no AI synthesis):')
    lines.push('')
    result.items.forEach((item, index) => {
      const citationIndex = index + 1
      citations.push({
        index: citationIndex,
        articleId: item.article.id,
        title: item.article.title,
        page: null,
        snippet: item.snippet.slice(0, 300)
      })
      lines.push(`- **[${citationIndex}] ${item.article.title}** — ${item.snippet.slice(0, 300)}`)
    })
    return { content: lines.join('\n'), citations }
  }

  private keySentences(abstract: string, zh: boolean): string[] {
    if (!abstract) return [zh ? '无摘要，需查看原文。' : 'No abstract available.']
    const sentences = abstract
      .split(/(?<=[.!?。！？])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 30)
    const picked = sentences.slice(0, 3)
    return picked.length ? picked.map((sentence) => truncate(sentence, 360)) : [truncate(abstract, 360)]
  }

  private sharedTopics(context: ContextEntry[]): string[] {
    const counts = new Map<string, number>()
    for (const entry of context) {
      for (const topic of [...entry.categories, ...entry.keywords]) {
        const key = topic.trim()
        if (!key) continue
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([topic]) => topic)
  }

  relatedArticles(articleId: string, limit = 8): Array<{ article: Article; score: number }> {
    const article = this.articles.get(articleId)
    if (!article) return []
    const categoryIds = new Set(article.categories.map((category) => category.categoryId))
    const keywords = new Set(article.keywords.map((keyword) => normalizeTitle(keyword)).filter(Boolean))
    const titleTokens = new Set(normalizeTitle(article.title).split(' ').filter((token) => token.length > 3))
    const candidates = this.articles.list({ scope: 'library', limit: 300 }).items
    const scored: Array<{ article: Article; score: number }> = []
    for (const candidate of candidates) {
      if (candidate.id === articleId) continue
      let score = 0
      for (const category of candidate.categories) if (categoryIds.has(category.categoryId)) score += 4
      for (const keyword of candidate.keywords) if (keywords.has(normalizeTitle(keyword))) score += 2
      const tokens = normalizeTitle(candidate.title).split(' ').filter((token) => token.length > 3)
      for (const token of tokens) if (titleTokens.has(token)) score += 1
      if (candidate.journalTitle && article.journalTitle && candidate.journalTitle === article.journalTitle) score += 1
      if (score > 0) scored.push({ article: candidate, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  listThreads(): AssistantThread[] {
    return this.repo.listThreads()
  }

  threadMessages(threadId: string): AssistantMessage[] {
    return this.repo.messages(threadId)
  }

  createThread(title: string): AssistantThread {
    return this.repo.createThread(title)
  }

  deleteThread(id: string): void {
    this.repo.deleteThread(id)
    this.emit('assistant:changed', { threadId: id })
  }
}
