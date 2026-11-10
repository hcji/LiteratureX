import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AddSubscriptionInput,
  AppEvent,
  AppInfo,
  AppSettings,
  Article,
  ArticleListResult,
  ArticlePatch,
  ArticleQuery,
  ArticleTranslation,
  ArticleTranslationResult,
  AssistantMessage,
  AssistantRequest,
  AssistantResponse,
  AssistantThread,
  AutoOrganizeOptions,
  AutoOrganizeResult,
  BackupInfo,
  Category,
  CategoryInput,
  CategoryMergeInput,
  CategoryMergeSuggestion,
  CategoryPatch,
  ClassificationHistoryEntry,
  ClassifyOutcome,
  CreateArticleInput,
  DashboardStats,
  DedupeResult,
  DiscoverFeedsResult,
  FeedCandidate,
  InterestMatchReport,
  InterestProfile,
  IoResult,
  JobInfo,
  JournalCandidate,
  Language,
  PdfImportResult,
  PluginStatus,
  SearchResponse,
  SettingsPatch,
  Subscription,
  SubscriptionGroup,
  SyncHistoryEntry,
  SyncOutcome,
  TaxonomySuggestion,
  WordSetupResult,
  WpsInstallResult
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const api = {
  app: {
    info: (): Promise<AppInfo> => invoke('app:info'),
    openExternal: (url: string): Promise<void> => invoke('app:openExternal', url),
    openPath: (target: string): Promise<void> => invoke('app:openPath', target),
    openDataDir: (): Promise<void> => invoke('app:openDataDir'),
    getPathForFile: (file: unknown): string => webUtils.getPathForFile(file as never),
    onEvent: (callback: (event: AppEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: AppEvent): void => callback(payload)
      ipcRenderer.on('app:event', listener)
      return () => ipcRenderer.removeListener('app:event', listener)
    }
  },
  settings: {
    get: (): Promise<AppSettings> => invoke('settings:get'),
    update: (patch: SettingsPatch): Promise<AppSettings> => invoke('settings:update', patch),
    testAi: (): Promise<string> => invoke('settings:testAi'),
    chooseStorageDir: (): Promise<AppSettings | null> => invoke('settings:chooseStorageDir')
  },
  plugins: {
    status: (): Promise<PluginStatus> => invoke('plugins:status'),
    installWps: (): Promise<WpsInstallResult> => invoke('plugins:installWps'),
    uninstallWps: (): Promise<void> => invoke('plugins:uninstallWps'),
    setupWord: (): Promise<WordSetupResult> => invoke('plugins:setupWord'),
    openFolder: (kind: 'wps' | 'word'): Promise<void> => invoke('plugins:openFolder', kind),
    openGuide: (): Promise<void> => invoke('plugins:openGuide')
  },
  dashboard: {
    get: (): Promise<DashboardStats> => invoke('dashboard:get')
  },
  interest: {
    get: (): Promise<InterestProfile> => invoke('interest:get'),
    rebuild: (options: { useAi?: boolean } = {}): Promise<InterestProfile> =>
      invoke('interest:rebuild', options),
    evaluate: (articleId: string, deep = false): Promise<InterestMatchReport> =>
      invoke('interest:evaluate', articleId, deep)
  },
  articles: {
    list: (query: ArticleQuery): Promise<ArticleListResult> => invoke('articles:list', query),
    get: (id: string): Promise<Article | null> => invoke('articles:get', id),
    openInSystem: (id: string): Promise<{ kind: 'pdf' | 'url' }> => invoke('articles:openInSystem', id),
    search: (query: ArticleQuery): Promise<SearchResponse> => invoke('articles:search', query),
    categoryCounts: (
      scope: 'library' | 'discover' = 'discover',
      subscriptionId?: string | null
    ): Promise<Array<{ categoryId: string; name: string; color: string | null; count: number }>> =>
      invoke('articles:categoryCounts', scope, subscriptionId),
    translations: (ids: string[], language: Language): Promise<ArticleTranslation[]> =>
      invoke('articles:translations', ids, language),
    translate: (ids: string[], language: Language, includeAbstract = true): Promise<ArticleTranslationResult> =>
      invoke('articles:translate', ids, language, includeAbstract),
    create: (input: CreateArticleInput): Promise<Article> => invoke('articles:create', input),
    update: (id: string, patch: ArticlePatch): Promise<Article | null> => invoke('articles:update', id, patch),
    setRead: (id: string, status: Article['readStatus']): Promise<void> => invoke('articles:setRead', id, status),
    setStarred: (id: string, starred: boolean): Promise<void> => invoke('articles:setStarred', id, starred),
    setInLibrary: (id: string, inLibrary: boolean): Promise<void> => invoke('articles:setInLibrary', id, inLibrary),
    trash: (id: string): Promise<void> => invoke('articles:trash', id),
    restore: (id: string): Promise<void> => invoke('articles:restore', id),
    delete: (id: string): Promise<void> => invoke('articles:delete', id),
    emptyTrash: (): Promise<number> => invoke('articles:emptyTrash'),
    addNote: (articleId: string, content: string): Promise<void> => invoke('articles:addNote', articleId, content),
    updateNote: (noteId: string, content: string): Promise<void> => invoke('articles:updateNote', noteId, content),
    deleteNote: (noteId: string): Promise<void> => invoke('articles:deleteNote', noteId),
    classify: (id: string, force = true): Promise<ClassifyOutcome> => invoke('articles:classify', id, force),
    classificationHistory: (id: string): Promise<ClassificationHistoryEntry[]> =>
      invoke('articles:classificationHistory', id),
    classifyBatch: (ids: string[], force = true): Promise<string | null> => invoke('articles:classifyBatch', ids, force),
    autoOrganize: (options: AutoOrganizeOptions): Promise<AutoOrganizeResult> =>
      invoke('articles:autoOrganize', options),
    dedupe: (): Promise<DedupeResult> => invoke('articles:dedupe'),
    classifyPending: (): Promise<string | null> => invoke('articles:classifyPending'),
    classifyUnclassifiedDiscover: (): Promise<{
      count: number
      jobId: string | null
      reason?: 'no-categories'
    }> => invoke('articles:classifyUnclassifiedDiscover'),
    reclassifyAll: (): Promise<string | null> => invoke('articles:reclassifyAll')
  },
  categories: {
    tree: (): Promise<Category[]> => invoke('categories:tree'),
    flat: (): Promise<Category[]> => invoke('categories:flat'),
    create: (input: CategoryInput): Promise<Category> => invoke('categories:create', input),
    update: (id: string, patch: CategoryPatch): Promise<Category> => invoke('categories:update', id, patch),
    delete: (id: string): Promise<void> => invoke('categories:delete', id),
    suggestMerge: (ids: string[]): Promise<CategoryMergeSuggestion> => invoke('categories:suggestMerge', ids),
    merge: (ids: string[], input: CategoryMergeInput): Promise<Category> => invoke('categories:merge', ids, input),
    assign: (articleId: string, categoryId: string): Promise<void> => invoke('categories:assign', articleId, categoryId),
    remove: (articleId: string, categoryId: string): Promise<void> => invoke('categories:remove', articleId, categoryId),
    accept: (articleId: string, categoryId: string): Promise<void> => invoke('categories:accept', articleId, categoryId)
  },
  jobs: {
    list: (): Promise<JobInfo[]> => invoke('jobs:list')
  },
  suggestions: {
    list: (): Promise<TaxonomySuggestion[]> => invoke('suggestions:list'),
    generate: (): Promise<TaxonomySuggestion[]> => invoke('suggestions:generate'),
    accept: (id: string): Promise<TaxonomySuggestion | null> => invoke('suggestions:accept', id),
    dismiss: (id: string): Promise<void> => invoke('suggestions:dismiss', id)
  },
  journals: {
    search: (query: string): Promise<JournalCandidate[]> => invoke('journals:search', query),
    discoverFeeds: (journal: JournalCandidate): Promise<DiscoverFeedsResult> => invoke('journals:discoverFeeds', journal),
    validateFeed: (url: string): Promise<FeedCandidate> => invoke('journals:validateFeed', url)
  },
  subscriptions: {
    list: (): Promise<Subscription[]> => invoke('subscriptions:list'),
    add: (input: AddSubscriptionInput): Promise<{ subscription: Subscription; sync?: SyncOutcome }> =>
      invoke('subscriptions:add', input),
    update: (
      id: string,
      patch: { name?: string | null; groupId?: string | null; enabled?: boolean; intervalMinutes?: number }
    ): Promise<Subscription | null> => invoke('subscriptions:update', id, patch),
    delete: (id: string): Promise<void> => invoke('subscriptions:delete', id),
    sync: (id: string, force = false): Promise<SyncOutcome> => invoke('subscriptions:sync', id, force),
    syncAll: (force = false): Promise<SyncOutcome[]> => invoke('subscriptions:syncAll', force),
    history: (limit = 50): Promise<SyncHistoryEntry[]> => invoke('subscriptions:history', limit)
  },
  groups: {
    list: (): Promise<SubscriptionGroup[]> => invoke('groups:list'),
    create: (name: string, color?: string | null): Promise<SubscriptionGroup> => invoke('groups:create', name, color),
    update: (id: string, patch: { name?: string; color?: string | null; sortOrder?: number }): Promise<void> =>
      invoke('groups:update', id, patch),
    delete: (id: string): Promise<void> => invoke('groups:delete', id)
  },
  pdf: {
    importDialog: (): Promise<PdfImportResult> => invoke('pdf:importDialog'),
    importFolderDialog: (): Promise<PdfImportResult> => invoke('pdf:importFolderDialog'),
    importForArticle: (articleId: string): Promise<PdfImportResult> => invoke('pdf:importForArticle', articleId),
    importPaths: (paths: string[], mode?: 'managed' | 'linked'): Promise<PdfImportResult> =>
      invoke('pdf:importPaths', paths, mode),
    read: (pdfId: string): Promise<Uint8Array> => invoke('pdf:read', pdfId),
    downloadOA: (articleId: string): Promise<{ pdf?: unknown; error?: string }> => invoke('pdf:downloadOA', articleId),
    delete: (pdfId: string, deleteFile = false): Promise<void> => invoke('pdf:delete', pdfId, deleteFile),
    reveal: (pdfId: string): Promise<void> => invoke('pdf:reveal', pdfId),
    getPath: (pdfId: string): Promise<string> => invoke('pdf:getPath', pdfId)
  },
  assistant: {
    threads: (): Promise<AssistantThread[]> => invoke('assistant:threads'),
    threadMessages: (threadId: string): Promise<AssistantMessage[]> => invoke('assistant:threadMessages', threadId),
    createThread: (title: string): Promise<AssistantThread> => invoke('assistant:createThread', title),
    deleteThread: (id: string): Promise<void> => invoke('assistant:deleteThread', id),
    ask: (request: AssistantRequest): Promise<AssistantResponse> => invoke('assistant:ask', request),
    related: (articleId: string, limit = 8): Promise<Array<{ article: Article; score: number }>> =>
      invoke('assistant:related', articleId, limit)
  },
  io: {
    export: (format: 'bibtex' | 'ris' | 'csv' | 'json', ids?: string[]): Promise<{ path: string; count: number } | null> =>
      invoke('io:export', format, ids),
    import: (format: 'bibtex' | 'ris' | 'json'): Promise<(IoResult & { path: string }) | null> =>
      invoke('io:import', format),
    backup: (): Promise<BackupInfo | null> => invoke('io:backup'),
    listBackups: (): Promise<BackupInfo[]> => invoke('io:listBackups'),
    restore: (): Promise<{ path: string } | null> => invoke('io:restore'),
    vacuum: (): Promise<boolean> => invoke('data:vacuum')
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('api', api)
