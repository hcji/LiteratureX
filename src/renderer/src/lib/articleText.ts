import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type { Article, ArticleTextLanguage, Language } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { useT } from '../i18n'
import { errorMessage } from './utils'

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g

export interface ArticleTranslationEntry {
  title: string
  abstract: string | null
  fields: 'title' | 'all'
  model?: string | null
  sourceSignature: string
}

interface ArticleTextState {
  translations: Record<string, Record<string, ArticleTranslationEntry>>
  limits: Record<string, number>
  started: Record<string, number>
  failures: Record<string, string>
  apply: (
    language: Language,
    entries: Array<{
      articleId: string
      title: string
      abstract?: string | null
      fields: 'title' | 'all'
      model?: string | null
      sourceSignature: string
    }>
  ) => void
  addStarted: (language: Language, count: number) => void
  setFailure: (language: Language, message: string) => void
  clearFailure: (language: Language) => void
  raiseLimit: (language: Language, amount: number) => void
  drop: (language: Language, articleId: string) => void
}

const DEFAULT_AUTO_LIMIT = 80

export const useArticleTextStore = create<ArticleTextState>((set, get) => ({
  translations: {},
  limits: {},
  started: {},
  failures: {},
  apply: (language, entries) => {
    if (!entries.length) return
    const current = get().translations[language] ?? {}
    const next = { ...current }
    for (const entry of entries) {
      if (!entry.title) continue
      next[entry.articleId] = {
        title: entry.title,
        abstract: entry.abstract ?? null,
        fields: entry.fields,
        model: entry.model ?? null,
        sourceSignature: entry.sourceSignature
      }
    }
    set({
      translations: { ...get().translations, [language]: next },
      failures: { ...get().failures, [language]: '' }
    })
  },
  addStarted: (language, count) => set({ started: { ...get().started, [language]: (get().started[language] ?? 0) + count } }),
  setFailure: (language, message) => set({ failures: { ...get().failures, [language]: message } }),
  clearFailure: (language) =>
    set({ failures: { ...get().failures, [language]: '' } }),
  raiseLimit: (language, amount) =>
    set({ limits: { ...get().limits, [language]: (get().limits[language] ?? DEFAULT_AUTO_LIMIT) + amount } }),
  drop: (language, articleId) => {
    const current = get().translations[language]
    if (!current?.[articleId]) return
    const next = { ...current }
    delete next[articleId]
    set({ translations: { ...get().translations, [language]: next } })
  }
}))

export function resolveArticleTextLanguage(
  preference: ArticleTextLanguage | undefined,
  uiLanguage: Language
): Language | 'original' {
  if (!preference || preference === 'system') return uiLanguage
  if (preference === 'original') return 'original'
  return preference
}

export function textIsCjk(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const cjk = trimmed.match(CJK_RE)?.length ?? 0
  const letters = trimmed.match(/[A-Za-z]/g)?.length ?? 0
  return cjk > 0 && cjk >= letters * 0.15
}

export function articleNeedsTranslation(article: Pick<Article, 'title' | 'abstract'>, target: Language): boolean {
  const sample = `${article.title} ${article.abstract ?? ''}`.trim()
  if (!sample) return false
  const hasCjk = textIsCjk(sample)
  return target === 'zh' ? !hasCjk : hasCjk
}

function sourceSignature(article: Pick<Article, 'title' | 'abstract'>): string {
  return `${article.title}\u0000${article.abstract ?? ''}`
}

interface WantedEntry {
  article: Pick<Article, 'id' | 'title' | 'abstract'>
  detail: boolean
  includeAbstract: boolean
  language: Language
}

const wanted = new Map<string, WantedEntry>()
const pending = new Map<Language, Set<string>>()
const priority = new Map<Language, Set<string>>()
const requested = new Set<string>()
const running = { value: false }
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryAfter = 0
const lastToast = new Map<string, number>()

function keyOf(language: Language, id: string): string {
  return `${language}:${id}`
}

function aiConfigured(): boolean {
  const settings = useAppStore.getState().settings
  return Boolean(settings?.ai.apiKeySet && settings.ai.model)
}

function scheduleFlush(delay = 260): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, delay)
}

function queueFor(language: Language): Set<string> {
  let set = pending.get(language)
  if (!set) {
    set = new Set()
    pending.set(language, set)
  }
  return set
}

function priorityFor(language: Language): Set<string> {
  let set = priority.get(language)
  if (!set) {
    set = new Set()
    priority.set(language, set)
  }
  return set
}

export function ensureArticleTranslation(
  article: Pick<Article, 'id' | 'title' | 'abstract'>,
  target: Language,
  options: { detail?: boolean; includeAbstract?: boolean } = {}
): void {
  if (!articleNeedsTranslation(article, target)) return
  const state = useArticleTextStore.getState()
  const cached = state.translations[target]?.[article.id]
  const detail = options.detail === true
  const includeAbstract = options.includeAbstract === true && Boolean(article.abstract)
  const signature = sourceSignature(article)
  if (cached && cached.sourceSignature !== signature) {
    state.drop(target, article.id)
  } else if (
    cached &&
    cached.sourceSignature === signature &&
    (!includeAbstract || cached.fields === 'all' || !article.abstract)
  ) {
    return
  }
  if (!aiConfigured()) return
  if (Date.now() < retryAfter) return
  const key = keyOf(target, article.id)
  const existing = wanted.get(key)
  if (existing) {
    if (sourceSignature(existing.article) !== signature) {
      requested.delete(key)
      wanted.delete(key)
    } else {
      let changed = false
      if (detail && !existing.detail) {
        existing.detail = true
        priorityFor(target).add(article.id)
        changed = true
      }
      if (includeAbstract && !existing.includeAbstract) {
        existing.includeAbstract = true
        changed = true
      }
      if (changed) scheduleFlush(30)
      return
    }
  }
  const started = state.started[target] ?? 0
  const limit = state.limits[target] ?? DEFAULT_AUTO_LIMIT
  if (!detail && started >= limit) return
  requested.add(key)
  wanted.set(key, { article, detail, includeAbstract, language: target })
  if (detail) priorityFor(target).add(article.id)
  queueFor(target).add(article.id)
  scheduleFlush()
}

export function retryArticleTranslation(
  article: Pick<Article, 'id' | 'title' | 'abstract'>,
  target: Language,
  detail = true
): void {
  retryAfter = 0
  const key = keyOf(target, article.id)
  requested.delete(key)
  wanted.delete(key)
  useArticleTextStore.getState().clearFailure(target)
  ensureArticleTranslation(article, target, { detail, includeAbstract: detail })
}

export function translateMoreArticles(language: Language): void {
  useArticleTextStore.getState().raiseLimit(language, DEFAULT_AUTO_LIMIT)
}

async function flush(): Promise<void> {
  if (running.value) return
  if (!aiConfigured()) return
  running.value = true
  try {
    for (;;) {
      const language = (['zh', 'en'] as Language[]).find(
        (candidate) => (priority.get(candidate)?.size ?? 0) > 0 || (pending.get(candidate)?.size ?? 0) > 0
      )
      if (!language) break
      const detailIds = [...(priority.get(language) ?? [])]
      const regularIds = [...(pending.get(language) ?? [])].filter((id) => !detailIds.includes(id))
      const batch = [...detailIds.slice(0, 8), ...regularIds.slice(0, 20)].slice(0, 24)
      if (!batch.length) break
      const batchSignatures = new Map(
        batch.map((id) => {
          const wantedEntry = wanted.get(keyOf(language, id))
          return [keyOf(language, id), wantedEntry ? sourceSignature(wantedEntry.article) : ''] as const
        })
      )
      for (const id of batch) {
        priority.get(language)?.delete(id)
        pending.get(language)?.delete(id)
      }
      const includeAbstract = batch.some((id) => {
        const entry = wanted.get(keyOf(language, id))
        return entry?.includeAbstract === true || entry?.detail === true
      })
      try {
        const result = await window.api.articles.translate(batch, language, includeAbstract)
        useArticleTextStore.getState().apply(
          language,
          result.translations.map((translation) => ({
            ...translation,
            sourceSignature: batchSignatures.get(keyOf(language, translation.articleId)) ?? ''
          }))
        )
        useArticleTextStore.getState().addStarted(language, batch.length)
        for (const entry of result.translations) {
          const key = keyOf(language, entry.articleId)
          const current = wanted.get(key)
          if (!current || batchSignatures.get(key) === sourceSignature(current.article)) {
            requested.delete(key)
            wanted.delete(key)
          }
        }
      } catch (error) {
        const message = errorMessage(error)
        useArticleTextStore.getState().setFailure(language, message)
        retryAfter = Date.now() + 30000
        const last = lastToast.get(language) ?? 0
        if (Date.now() - last > 30000) {
          lastToast.set(language, Date.now())
          toast.error(message)
        }
        for (const id of batch) requested.delete(keyOf(language, id))
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 140))
    }
  } finally {
    running.value = false
    if (['zh', 'en'].some((language) => (pending.get(language as Language)?.size ?? 0) > 0)) scheduleFlush(400)
  }
}

export function useArticleDisplay(
  article: Pick<Article, 'id' | 'title' | 'abstract'>,
  options: { detail?: boolean; includeAbstract?: boolean } = {}
): {
  title: string
  abstract: string | null
  target: Language | 'original'
  translatedTitle: boolean
  translatedAbstract: boolean
  needsTranslation: boolean
  aiAvailable: boolean
  failure: string | null
} {
  const { language } = useT()
  const preference = useAppStore((state) => state.settings?.appearance.articleTextLanguage)
  const aiAvailable = useAppStore((state) => Boolean(state.settings?.ai.apiKeySet && state.settings.ai.model))
  const target = resolveArticleTextLanguage(preference, language)
  const activeTarget = target === 'original' ? null : target
  const entry = useArticleTextStore((state) =>
    activeTarget ? state.translations[activeTarget]?.[article.id] : undefined
  )
  const limit = useArticleTextStore((state) => (activeTarget ? state.limits[activeTarget] ?? DEFAULT_AUTO_LIMIT : 0))
  const failure = useArticleTextStore((state) => (activeTarget ? state.failures[activeTarget] ?? null : null))
  const needs = activeTarget ? articleNeedsTranslation(article, activeTarget) : false

  useEffect(() => {
    if (!activeTarget || !needs) return
    ensureArticleTranslation(article, activeTarget, {
      detail: options.detail,
      includeAbstract: options.includeAbstract
    })
    // The auto-translation limit is a dependency so "translate more" wakes items that were skipped.
  }, [activeTarget, article, needs, options.detail, options.includeAbstract, limit, aiAvailable])

  return {
    title: entry?.title || article.title,
    abstract: entry?.abstract || article.abstract || null,
    target,
    translatedTitle: Boolean(entry?.title && entry.title !== article.title),
    translatedAbstract: entry?.fields === 'all' && Boolean(entry?.abstract),
    needsTranslation: needs,
    aiAvailable,
    failure: failure || null
  }
}
