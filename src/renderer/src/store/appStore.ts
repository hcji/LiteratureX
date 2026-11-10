import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  AppEvent,
  AppInfo,
  AppSettings,
  JobInfo,
  OperationKind,
  OperationProgress,
  SettingsPatch,
  ThemeMode
} from '@shared/types'
import { errorMessage } from '../lib/utils'

export type Route = 'dashboard' | 'discover' | 'library' | 'collections' | 'assistant' | 'settings'
export type LibraryViewIntent = 'all' | 'favorites' | 'unclassified' | 'review'
export type DiscoverViewIntent = 'all' | 'unread' | 'starred' | 'recent'

export interface OperationState {
  id: string
  kind: OperationKind
  status: 'running' | 'done' | 'error'
  detail?: string
  current?: number
  total?: number
  percent?: number
  error?: string
  startedAt: number
  finishedAt?: number
}

const operationTimers = new Map<string, ReturnType<typeof setTimeout>>()

export interface PdfReaderState {
  articleId: string
  pdfId: string
  title: string
}

interface JobProgress {
  progress: number
  message?: string
  status?: 'running' | 'done' | 'error'
  type?: string
}

interface AppState {
  initialized: boolean
  info: AppInfo | null
  settings: AppSettings | null
  route: Route
  dataVersion: number
  assistantVersion: number
  focusArticleId: string | null
  pendingLibraryView: LibraryViewIntent | null
  pendingDiscoverView: DiscoverViewIntent | null
  operations: Record<string, OperationState>
  pdfReader: PdfReaderState | null
  jobs: JobInfo[]
  jobProgress: Record<string, JobProgress>
  init: () => Promise<void>
  refreshSettings: () => Promise<void>
  refreshInfo: () => Promise<void>
  refreshJobs: () => Promise<void>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  setRoute: (route: Route) => void
  openArticle: (id: string) => void
  openLibraryView: (view: LibraryViewIntent) => void
  openDiscoverView: (view: DiscoverViewIntent) => void
  consumePendingLibraryView: () => LibraryViewIntent | null
  consumePendingDiscoverView: () => DiscoverViewIntent | null
  upsertOperation: (operation: OperationProgress) => void
  startOperation: (kind: OperationKind, detail?: string) => string
  finishOperation: (id: string, status: 'done' | 'error', detail?: string, error?: string) => void
  dismissOperation: (id: string) => void
  openPdfReader: (reader: PdfReaderState) => void
  closePdfReader: () => void
  consumeFocusArticle: () => string | null
  bumpData: () => void
  handleEvent: (event: AppEvent) => void
}

export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: ThemeMode): void {
  const resolved = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.dataset.theme = resolved
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  info: null,
  settings: null,
  route: 'dashboard',
  dataVersion: 0,
  assistantVersion: 0,
  focusArticleId: null,
  pendingLibraryView: null,
  pendingDiscoverView: null,
  operations: {},
  pdfReader: null,
  jobs: [],
  jobProgress: {},

  init: async () => {
    const [info, settings, jobs] = await Promise.all([
      window.api.app.info(),
      window.api.settings.get(),
      window.api.jobs.list().catch(() => [])
    ])
    applyTheme(settings.appearance.theme)
    document.documentElement.lang = settings.appearance.language === 'zh' ? 'zh-CN' : 'en'
    set({ initialized: true, info, settings, jobs })
  },

  refreshSettings: async () => {
    const settings = await window.api.settings.get()
    applyTheme(settings.appearance.theme)
    document.documentElement.lang = settings.appearance.language === 'zh' ? 'zh-CN' : 'en'
    set({ settings })
  },

  refreshInfo: async () => {
    const info = await window.api.app.info()
    set({ info })
  },

  refreshJobs: async () => {
    const jobs = await window.api.jobs.list().catch(() => [])
    set({ jobs })
  },

  updateSettings: async (patch) => {
    const settings = await window.api.settings.update(patch)
    applyTheme(settings.appearance.theme)
    document.documentElement.lang = settings.appearance.language === 'zh' ? 'zh-CN' : 'en'
    set({ settings, dataVersion: get().dataVersion + 1 })
    return settings
  },

  setRoute: (route) =>
    set({ route, focusArticleId: null, pdfReader: null, pendingLibraryView: null, pendingDiscoverView: null }),

  openArticle: (id) =>
    set({
      route: 'library',
      focusArticleId: id,
      pdfReader: null,
      pendingLibraryView: null,
      pendingDiscoverView: null
    }),

  openLibraryView: (view) =>
    set({
      route: 'library',
      focusArticleId: null,
      pdfReader: null,
      pendingDiscoverView: null,
      pendingLibraryView: view
    }),

  openDiscoverView: (view) =>
    set({
      route: 'discover',
      focusArticleId: null,
      pdfReader: null,
      pendingLibraryView: null,
      pendingDiscoverView: view
    }),

  consumePendingLibraryView: () => {
    const view = get().pendingLibraryView
    if (view) set({ pendingLibraryView: null })
    return view
  },

  consumePendingDiscoverView: () => {
    const view = get().pendingDiscoverView
    if (view) set({ pendingDiscoverView: null })
    return view
  },

  upsertOperation: (operation) => {
    const existing = get().operations[operation.opId]
    const now = Date.now()
    const next: OperationState = {
      id: operation.opId,
      kind: operation.kind,
      status: operation.status,
      detail: operation.detail ?? existing?.detail,
      current: operation.current ?? existing?.current,
      total: operation.total ?? existing?.total,
      percent: operation.percent ?? existing?.percent,
      error: operation.error ?? existing?.error,
      startedAt: existing?.startedAt ?? now,
      ...(operation.status === 'running' ? {} : { finishedAt: now })
    }
    set({ operations: { ...get().operations, [next.id]: next } })
    if (next.status !== 'running') {
      const previous = operationTimers.get(next.id)
      if (previous) clearTimeout(previous)
      operationTimers.set(
        next.id,
        setTimeout(
          () => {
            operationTimers.delete(next.id)
            get().dismissOperation(next.id)
          },
          next.status === 'error' ? 9000 : 7000
        )
      )
    }
  },

  startOperation: (kind, detail) => {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    get().upsertOperation({ opId: id, kind, status: 'running', detail })
    return id
  },

  finishOperation: (id, status, detail, error) => {
    const existing = get().operations[id]
    if (!existing) return
    get().upsertOperation({
      opId: id,
      kind: existing.kind,
      status,
      detail: detail ?? existing.detail,
      percent: status === 'done' ? 1 : existing.percent,
      error
    })
  },

  dismissOperation: (id) => {
    const operations = { ...get().operations }
    delete operations[id]
    set({ operations })
  },

  openPdfReader: (reader) => {
    if (get().route === 'library') {
      set({ pdfReader: reader })
      return
    }
    set({
      route: 'library',
      focusArticleId: reader.articleId,
      pdfReader: reader,
      pendingLibraryView: null,
      pendingDiscoverView: null
    })
  },

  closePdfReader: () => set({ pdfReader: null }),

  consumeFocusArticle: () => {
    const id = get().focusArticleId
    if (id) set({ focusArticleId: null })
    return id
  },

  bumpData: () => set({ dataVersion: get().dataVersion + 1 }),

  handleEvent: (event) => {
    if (
      event.type === 'articles:changed' ||
      event.type === 'categories:changed' ||
      event.type === 'subscriptions:changed' ||
      event.type === 'data:changed'
    ) {
      set({ dataVersion: get().dataVersion + 1 })
    }
    if (event.type === 'assistant:changed') {
      set({ assistantVersion: get().assistantVersion + 1 })
    }
    if (event.type === 'settings:changed') {
      void get().refreshSettings()
    }
    if (event.type === 'operation:progress') {
      const payload = event.payload as OperationProgress | undefined
      if (payload?.opId && payload.kind) get().upsertOperation(payload)
    }
    if (event.type === 'job:progress') {
      const payload = event.payload as
        | {
            jobId?: string
            type?: string
            progress?: number
            message?: string
            error?: string
            result?: { succeeded?: number; failed?: number }
          }
        | undefined
      if (payload?.jobId) {
        const progress = payload.progress ?? 0
        set({
          jobProgress: {
            ...get().jobProgress,
            [payload.jobId]: {
              progress,
              message: payload.message,
              status: payload.error ? 'error' : progress >= 1 ? 'done' : 'running',
              type: payload.type
            }
          }
        })
        get().upsertOperation({
          opId: `job:${payload.jobId}`,
          kind: 'classification',
          status: payload.error ? 'error' : progress >= 1 ? 'done' : 'running',
          percent: progress,
          detail: payload.message,
          error: payload.error
        })
      }
      if ((payload?.progress ?? 0) >= 1 && payload?.message) {
        const language = get().settings?.appearance.language ?? 'zh'
        if (payload.error) {
          toast.error(payload.error)
        } else if (payload.type === 'classification' && payload.result) {
          const succeeded = payload.result.succeeded ?? 0
          const failed = payload.result.failed ?? 0
          toast.success(
            language === 'zh'
              ? `分类完成：${succeeded} 成功，${failed} 失败`
              : `Classification finished: ${succeeded} succeeded, ${failed} failed`
          )
        } else {
          toast.success(payload.message)
        }
        void get().refreshJobs()
      }
    }
    if (event.type === 'sync:progress') {
      const payload = event.payload as
        | { phase?: string; feedTitle?: string; added?: number; updated?: number; error?: string }
        | undefined
      if (payload?.phase === 'error' && payload.error) {
        toast.error(`${payload.feedTitle ?? 'RSS'}: ${payload.error}`)
      }
    }
  }
}))

export async function safeCall<T>(action: () => Promise<T>, onError?: (message: string) => void): Promise<T | null> {
  try {
    return await action()
  } catch (error) {
    const message = errorMessage(error)
    if (onError) onError(message)
    else toast.error(message)
    return null
  }
}
