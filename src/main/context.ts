import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  AddSubscriptionInput,
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
  Category,
  CategoryInput,
  CategoryMergeInput,
  CategoryMergeSuggestion,
  CategoryPatch,
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
  OperationProgress,
  PdfImportResult,
  SearchResponse,
  SettingsPatch,
  Subscription,
  SubscriptionGroup,
  SyncHistoryEntry,
  SyncOutcome,
  TaxonomySuggestion
} from '@shared/types'
import { AppDatabase } from './db/database'
import { ArticleRepo } from './db/repositories/articles'
import { AssistantRepo } from './db/repositories/assistant'
import { CacheRepo } from './db/repositories/cache'
import { CategoryRepo } from './db/repositories/categories'
import { JobRepo } from './db/repositories/jobs'
import { PdfRepo } from './db/repositories/pdfs'
import { SettingsRepo } from './db/repositories/settings'
import { SubscriptionRepo } from './db/repositories/subscriptions'
import { AssistantService } from './services/ai/assistant'
import { ClassifierService } from './services/ai/classifier'
import { ClassificationQueue } from './services/ai/queue'
import { createProvider } from './services/ai/providers'
import { BackupService } from './services/backup'
import { DiscoveryService } from './services/discovery'
import { HttpService } from './services/http'
import { ImportExportService } from './services/importExport'
import { InterestService } from './services/interest'
import { MetadataService } from './services/metadata'
import { PdfService } from './services/pdf'
import { PluginService } from './services/pluginService'

function envPort(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : undefined
}
import { RssSyncService } from './services/rss'
import { SettingsService, type SecretBox } from './services/settings'
import { TranslationService } from './services/translation'

export interface AppContextOptions {
  dataDir: string
  dbPath?: string
  appVersion: string
  resourcesRoot: string
  secretBox: SecretBox
  fetchImpl?: typeof fetch
  emit?: (event: { type: string; payload?: unknown }) => void
}

export class AppContext {
  readonly db: AppDatabase
  readonly articles: ArticleRepo
  readonly categories: CategoryRepo
  readonly subscriptions: SubscriptionRepo
  readonly pdfs: PdfRepo
  readonly settingsRepo: SettingsRepo
  readonly jobs: JobRepo
  readonly cache: CacheRepo
  readonly assistantRepo: AssistantRepo
  readonly settings: SettingsService
  readonly http: HttpService
  readonly metadata: MetadataService
  readonly discovery: DiscoveryService
  readonly classifier: ClassifierService
  readonly interest: InterestService
  readonly translation: TranslationService
  readonly queue: ClassificationQueue
  readonly rss: RssSyncService
  readonly pdf: PdfService
  readonly assistant: AssistantService
  readonly importExport: ImportExportService
  readonly backup: BackupService
  readonly plugin: PluginService
  readonly dataDir: string
  readonly dbPath: string
  private readonly appVersion: string
  private readonly emitEvent: (event: { type: string; payload?: unknown }) => void
  private closed = false

  private emitOperation(operation: OperationProgress): void {
    this.emitEvent({ type: 'operation:progress', payload: operation })
  }

  private operationId(prefix: string): string {
    return `${prefix}-${Date.now()}-${randomBytes(3).toString('hex')}`
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  constructor(options: AppContextOptions) {
    this.dataDir = options.dataDir
    this.dbPath = options.dbPath ?? path.join(options.dataDir, 'literaturex.db')
    this.appVersion = options.appVersion
    this.emitEvent = options.emit ?? (() => undefined)
    this.db = new AppDatabase(this.dbPath)
    const emit = this.emitEvent
    this.articles = new ArticleRepo(this.db, (type, payload) => emit({ type, payload }))
    this.categories = new CategoryRepo(this.db, (articleIds) => {
      for (const id of articleIds) this.articles.refreshSearchIndex(id)
    })
    this.subscriptions = new SubscriptionRepo(this.db, (type, payload) => emit({ type, payload }))
    this.pdfs = new PdfRepo(this.db)
    this.settingsRepo = new SettingsRepo(this.db)
    this.jobs = new JobRepo(this.db)
    this.cache = new CacheRepo(this.db)
    this.assistantRepo = new AssistantRepo(this.db)
    this.settings = new SettingsService(this.settingsRepo, options.secretBox, {
      managedDir: path.join(options.dataDir, 'pdfs')
    })
    this.http = new HttpService(options.fetchImpl ?? fetch)
    this.metadata = new MetadataService(this.http, this.cache, this.settings)
    this.discovery = new DiscoveryService(this.http, this.settings)
    this.classifier = new ClassifierService(this.articles, this.categories, this.settings, (type, payload) =>
      emit({ type, payload })
    )
    this.interest = new InterestService(this.db, this.articles, this.settings)
    this.translation = new TranslationService(this.articles, this.settings)
    this.queue = new ClassificationQueue(this.classifier, this.jobs, (type, payload) => emit({ type, payload }))
    const enqueueClassification = (ids: string[]): void => {
      if (this.activeCategoryCount() > 0) this.queue.enqueue(ids)
    }
    this.rss = new RssSyncService(this.http, this.discovery, this.articles, this.subscriptions, this.settings, {
      emit: (type, payload) => emit({ type, payload }),
      onNewArticles: enqueueClassification
    })
    this.pdf = new PdfService({
      articles: this.articles,
      pdfs: this.pdfs,
      metadata: this.metadata,
      settings: this.settings,
      http: this.http,
      dataDir: this.dataDir,
      extractMetadata: (input) => this.classifier.extractPdfMetadata(input.text, input.fileName),
      onNewArticles: enqueueClassification,
      onPdfChanged: () => emit({ type: 'articles:changed', payload: { reason: 'pdf' } })
    })
    this.assistant = new AssistantService(this.articles, this.categories, this.settings, this.assistantRepo, (type, payload) =>
      emit({ type, payload })
    )
    this.importExport = new ImportExportService(this.articles, this.categories)
    this.backup = new BackupService(this.db, {
      dataDir: this.dataDir,
      dbPath: this.dbPath,
      pdfDir: () => this.pdf.managedDir(),
      appVersion: options.appVersion
    })
    this.plugin = new PluginService({
      dataDir: this.dataDir,
      resourcesRoot: options.resourcesRoot,
      version: options.appVersion,
      token: this.loadPluginToken(),
      articles: this.articles,
      httpPort: envPort('LITERATUREX_PLUGIN_HTTP_PORT'),
      httpsPort: envPort('LITERATUREX_PLUGIN_HTTPS_PORT'),
      analyzeCitationFormat: (example, language) => this.classifier.analyzeCitationFormat(example, language)
    })
  }

  private loadPluginToken(): string {
    const existing = this.settingsRepo.getRaw<string>('plugin_token')
    if (existing) return existing
    const token = randomBytes(32).toString('hex')
    this.settingsRepo.setRaw('plugin_token', token)
    return token
  }

  async initialize(): Promise<void> {
    await this.plugin.start().catch((error) => {
      console.error('Plugin server failed to start', error)
    })
    const staleTime = new Date().toISOString()
    this.db.db
      .prepare(
        "UPDATE jobs SET status = 'error', error = 'Interrupted by app restart', finished_at = ? WHERE status IN ('queued','running')"
      )
      .run(staleTime)
    this.db.db
      .prepare(
        "UPDATE sync_history SET status = 'error', error = 'Interrupted by app restart', finished_at = ? WHERE status = 'running'"
      )
      .run(staleTime)
    const articleCount = (this.db.db.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }).c
    const ftsCount = (this.db.db.prepare('SELECT COUNT(*) AS c FROM article_fts').get() as { c: number }).c
    if (articleCount !== ftsCount) this.articles.rebuildSearchIndex()
    this.cache.purgeOlderThan(90 * 24 * 60 * 60 * 1000)
    await this.backup.autoSnapshot().catch(() => null)
    if (this.settings.get().rss.autoSync) this.rss.startScheduler()
  }

  info(): AppInfo {
    const provider = this.settings.providerConfig()
    return {
      version: this.appVersion,
      name: 'LiteratureX',
      platform: process.platform,
      userDataPath: this.dataDir,
      dbPath: this.dbPath,
      pdfDir: this.pdf.managedDir(),
      fts5: this.db.fts5,
      aiConfigured: provider.apiKeySet && Boolean(provider.model)
    }
  }

  // ---------- Articles ----------
  private categoryFilterIds(query: ArticleQuery): string[] | undefined {
    const requested = query.categoryIds?.length
      ? query.categoryIds
      : query.categoryId
        ? [query.categoryId]
        : []
    if (!requested.length) return undefined
    const ids = new Set<string>()
    for (const id of requested) {
      for (const descendant of this.categories.descendantIds(id)) ids.add(descendant)
    }
    return [...ids]
  }

  private compareByDateDesc(a: Article, b: Article): number {
    const left = a.publicationDate ? Date.parse(a.publicationDate) : 0
    const right = b.publicationDate ? Date.parse(b.publicationDate) : 0
    if (left === right) return b.createdAt.localeCompare(a.createdAt)
    return right - left
  }

  listArticles(query: ArticleQuery): ArticleListResult {
    const categoryIds = this.categoryFilterIds(query)
    if (query.sort === 'interest') {
      const base = this.articles.list(
        { ...query, sort: 'publication_date', order: 'desc', limit: 100000, offset: 0 },
        categoryIds
      )
      const scoreMap = this.interest.scoreArticles(base.items)
      const scored = base.items.map((article) => ({
        article,
        score: scoreMap[article.id]
      }))
      scored.sort((left, right) => right.score.score - left.score.score || this.compareByDateDesc(left.article, right.article))
      const offset = Math.max(0, query.offset ?? 0)
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 100000)
      const items = scored.slice(offset, offset + limit)
      return {
        items: items.map((item) => item.article),
        total: base.total,
        interestScores: Object.fromEntries(items.map((item) => [item.article.id, item.score]))
      }
    }
    const result = this.articles.list(query, categoryIds)
    if (query.scope === 'discover' || (query.categoryIds?.length ?? 0) > 0) {
      result.interestScores = this.interest.scoreArticles(result.items)
    }
    return result
  }

  getArticle(id: string): Article | null {
    return this.articles.get(id)
  }

  createArticle(input: CreateArticleInput): Article {
    const article = this.articles.create(input)
    if (this.settings.get().ai.autoClassify && this.categories.count() > 0) this.queue.enqueue([article.id])
    return article
  }

  updateArticle(id: string, patch: ArticlePatch): Article | null {
    return this.articles.update(id, patch)
  }

  setRead(id: string, status: Article['readStatus']): void {
    this.articles.setRead(id, status)
  }

  setStarred(id: string, starred: boolean): void {
    this.articles.setStarred(id, starred)
  }

  setInLibrary(id: string, inLibrary: boolean): void {
    this.articles.setInLibrary(id, inLibrary)
    if (inLibrary && this.settings.get().ai.autoClassify && this.categories.count() > 0) {
      const article = this.articles.get(id)
      if (article && !article.lastClassifiedAt) this.queue.enqueue([id])
    }
  }

  trashArticle(id: string): void {
    this.articles.trash(id)
  }

  restoreArticle(id: string): void {
    this.articles.restore(id)
  }

  deleteArticle(id: string): void {
    this.articles.deletePermanently(id)
  }

  emptyTrash(): number {
    return this.articles.emptyTrash()
  }

  addNote(articleId: string, content: string): void {
    this.articles.addNote(articleId, content)
  }

  updateNote(noteId: string, content: string): void {
    this.articles.updateNote(noteId, content)
  }

  deleteNote(noteId: string): void {
    this.articles.deleteNote(noteId)
  }

  search(query: ArticleQuery): SearchResponse {
    const categoryIds = this.categoryFilterIds(query)
    const result = this.articles.search(query, categoryIds)
    if (query.scope === 'discover' || query.sort === 'interest' || (query.categoryIds?.length ?? 0) > 0) {
      const scores = this.interest.scoreArticles(result.items.map((item) => item.article))
      let items = result.items.map((item) => ({ ...item, score: scores[item.article.id]?.score ?? item.score }))
      if (query.sort === 'interest') {
        items = [...items].sort((a, b) => b.score - a.score)
      }
      return { items, total: result.total, tookMs: result.tookMs, interestScores: scores }
    }
    return { items: result.items, total: result.total, tookMs: result.tookMs }
  }

  dashboard(): DashboardStats {
    return this.articles.stats()
  }

  // ---------- Interest profile ----------
  interestProfile(): InterestProfile {
    return this.interest.getProfile()
  }

  async rebuildInterestProfile(options: { useAi?: boolean } = {}): Promise<InterestProfile> {
    return this.interest.refresh({ useAi: options.useAi === true })
  }

  async evaluateArticleMatch(articleId: string, deep = false): Promise<InterestMatchReport> {
    return this.interest.evaluate(articleId, deep)
  }

  categoryCounts(scope: 'library' | 'discover' = 'discover', subscriptionId?: string | null) {
    return this.articles.categoryCounts(scope, subscriptionId)
  }

  // ---------- Article text translation ----------
  cachedTranslations(ids: string[], language: Language): ArticleTranslation[] {
    return this.translation.cached(ids, language)
  }

  async translateArticles(ids: string[], language: Language, includeAbstract = true): Promise<ArticleTranslationResult> {
    return this.translation.translate(ids, language, includeAbstract)
  }

  // ---------- Categories ----------
  categoriesTree(): Category[] {
    return this.categories.tree()
  }

  categoriesFlat(): Category[] {
    return this.categories.listFlat()
  }

  createCategory(input: CategoryInput): Category {
    const category = this.categories.create(input)
    this.emitEvent({ type: 'categories:changed', payload: { id: category.id } })
    return category
  }

  updateCategory(id: string, patch: CategoryPatch): Category {
    const category = this.categories.update(id, patch)
    this.emitEvent({ type: 'categories:changed', payload: { id } })
    return category
  }

  deleteCategory(id: string): void {
    this.categories.delete(id)
    this.emitEvent({ type: 'categories:changed', payload: { id } })
  }

  async suggestCategoryMerge(ids: string[]): Promise<CategoryMergeSuggestion> {
    const flat = this.categories.listFlat()
    const selected = ids
      .map((id) => flat.find((category) => category.id === id))
      .filter((category): category is Category => Boolean(category))
    if (selected.length < 2) throw new Error('Select at least two categories to merge')
    const opId = this.operationId('merge-suggest')
    this.emitOperation({ opId, kind: 'assistant', status: 'running' })
    try {
      const language = this.settings.get().appearance.language
      const suggestion = await this.classifier.suggestMergedCategory(
        selected.map((category) => ({
          name: category.path ?? category.name,
          description: category.description,
          keywords: category.keywords
            .map((keyword) => (language === 'zh' ? keyword.keywordZh : keyword.keywordEn))
            .filter((keyword): keyword is string => Boolean(keyword))
        })),
        language
      )
      this.emitOperation({ opId, kind: 'assistant', status: 'done', percent: 1 })
      return suggestion
    } catch (error) {
      this.emitOperation({ opId, kind: 'assistant', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  mergeCategories(ids: string[], input: CategoryMergeInput): Category {
    const category = this.categories.merge(ids, input)
    this.emitEvent({ type: 'categories:changed', payload: { id: category.id, merged: ids } })
    this.emitEvent({ type: 'articles:changed', payload: { reason: 'category-merge' } })
    return category
  }

  assignCategory(articleId: string, categoryId: string): void {
    this.articles.addManualCategory(articleId, categoryId)
  }

  removeCategory(articleId: string, categoryId: string): void {
    this.articles.rejectCategory(articleId, categoryId)
  }

  acceptCategory(articleId: string, categoryId: string): void {
    this.articles.acceptCategory(articleId, categoryId)
  }

  categoriesForArticle(articleId: string) {
    return this.articles.listArticleCategories(articleId)
  }

  classificationHistory(articleId: string) {
    return this.articles.classificationHistory(articleId)
  }

  async classifyArticle(id: string, force = true): Promise<ClassifyOutcome> {
    const article = this.articles.get(id)
    const opId = this.operationId('classification')
    this.emitOperation({ opId, kind: 'classification', status: 'running', detail: article?.title })
    try {
      const outcome = await this.classifier.classifyArticle(id, { force })
      this.emitOperation({ opId, kind: 'classification', status: 'done', percent: 1, detail: article?.title })
      return outcome
    } catch (error) {
      this.emitOperation({ opId, kind: 'classification', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  classifyBatch(ids: string[], force = true): string | null {
    return this.queue.enqueue(ids, { force })
  }

  autoOrganizeUnclassified(options: AutoOrganizeOptions = {}): AutoOrganizeResult {
    const activeCategories = this.activeCategoryCount()
    const keywordCount = Math.max(3, Math.min(20, Math.round(options.keywordCount ?? 8)))
    const maxNewCategories = Math.max(0, Math.min(20, Math.round(options.maxNewCategories ?? 2)))
    const discoverySampleSize = Math.max(0, Math.min(1000, Math.round(options.discoverySampleSize ?? 20)))
    if (!activeCategories && maxNewCategories === 0) {
      throw new Error('No active categories exist. Create or enable a category before auto-organizing.')
    }
    const ids = this.articles.listIdsUnclassified(100000)
    const jobId = this.queue.enqueue(ids, {
      force: true,
      keywordCount,
      allowNewCategories: maxNewCategories > 0,
      maxNewCategories,
      discoverySampleSize,
      includeFullText: options.includeFullText === true,
      thinkingDepth: options.thinkingDepth ?? 'medium-low',
      requireAssignment: true
    })
    return { jobId, count: ids.length }
  }

  classifyPending(): string | null {
    const ids = this.articles.listIdsForClassification(100)
    return this.queue.enqueue(ids, { force: false })
  }

  classifyUnclassifiedDiscover(): { count: number; jobId: string | null; reason?: 'no-categories' } {
    if (this.activeCategoryCount() === 0) {
      return { count: 0, jobId: null, reason: 'no-categories' }
    }
    const ids = this.articles.listIdsUnclassifiedDiscover(200)
    const jobId = this.queue.enqueue(ids)
    return { count: jobId ? ids.length : 0, jobId }
  }

  reclassifyAll(): string | null {
    const ids = this.articles.all().map((article) => article.id)
    return this.queue.enqueue(ids, { force: true })
  }

  dedupeArticles(): DedupeResult {
    const result = this.articles.dedupe()
    if (result.removed) {
      this.emitEvent({ type: 'articles:changed', payload: { reason: 'dedupe' } })
    }
    return result
  }

  listJobs(): JobInfo[] {
    return this.jobs.list()
  }

  async taxonomySuggestions(): Promise<TaxonomySuggestion[]> {
    const opId = this.operationId('taxonomy')
    this.emitOperation({ opId, kind: 'taxonomy', status: 'running' })
    try {
      const suggestions = await this.classifier.suggestTaxonomy()
      this.emitOperation({ opId, kind: 'taxonomy', status: 'done', percent: 1 })
      return suggestions
    } catch (error) {
      this.emitOperation({ opId, kind: 'taxonomy', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  listSuggestions(): TaxonomySuggestion[] {
    return this.categories.listSuggestions()
  }

  acceptSuggestion(id: string): TaxonomySuggestion | null {
    return this.classifier.acceptSuggestion(id)
  }

  dismissSuggestion(id: string): void {
    this.classifier.dismissSuggestion(id)
  }

  // ---------- Discovery / subscriptions ----------
  async searchJournals(query: string): Promise<JournalCandidate[]> {
    return this.discovery.searchJournals(query)
  }

  async discoverFeeds(journal: JournalCandidate): Promise<DiscoverFeedsResult> {
    return this.discovery.discoverFeeds(journal)
  }

  async validateFeed(url: string): Promise<FeedCandidate> {
    return this.discovery.validateFeedUrl(url)
  }

  subscriptionsList(): Subscription[] {
    return this.subscriptions.list()
  }

  private async syncWithProgress(subscription: Subscription, force: boolean): Promise<SyncOutcome> {
    const opId = this.operationId('sync')
    const label = subscription.journal?.title || subscription.name || subscription.feed?.title || subscription.feedId
    this.emitOperation({ opId, kind: 'sync', status: 'running', detail: label })
    try {
      const outcome = await this.rss.syncSubscription(subscription, { force })
      if (outcome.status === 'error') {
        this.emitOperation({ opId, kind: 'sync', status: 'error', detail: label, error: outcome.error ?? undefined })
      } else {
        this.emitOperation({ opId, kind: 'sync', status: 'done', percent: 1, detail: `${label} · +${outcome.added}` })
        this.enqueueDiscoverBackfill()
      }
      return outcome
    } catch (error) {
      this.emitOperation({ opId, kind: 'sync', status: 'error', detail: label, error: this.errorMessage(error) })
      throw error
    }
  }

  private enqueueDiscoverBackfill(): void {
    if (this.activeCategoryCount() === 0) return
    const ids = this.articles.listIdsUnclassifiedDiscover(200)
    if (ids.length) this.queue.enqueue(ids)
  }

  private activeCategoryCount(): number {
    return this.categories.listFlat().filter((category) => category.isActive).length
  }

  async addSubscription(input: AddSubscriptionInput): Promise<{ subscription: Subscription; sync?: SyncOutcome }> {
    const subscription = this.subscriptions.create(input)
    if (input.syncNow !== false) {
      const existing = this.articles.list({ scope: 'discover', subscriptionId: subscription.id, limit: 1 })
      if (existing.total === 0) {
        const sync = await this.syncWithProgress(subscription, false)
        return { subscription: this.subscriptions.get(subscription.id) ?? subscription, sync }
      }
    }
    return { subscription }
  }

  updateSubscription(
    id: string,
    patch: { name?: string | null; groupId?: string | null; enabled?: boolean; intervalMinutes?: number }
  ): Subscription | null {
    return this.subscriptions.update(id, patch)
  }

  deleteSubscription(id: string): void {
    this.subscriptions.delete(id)
  }

  async syncSubscription(id: string, force = false): Promise<SyncOutcome> {
    const subscription = this.subscriptions.get(id)
    if (!subscription) throw new Error('Subscription not found')
    return this.syncWithProgress(subscription, force)
  }

  async syncAll(force = false): Promise<SyncOutcome[]> {
    const subscriptions = this.subscriptions.list().filter((subscription) => subscription.enabled)
    if (!subscriptions.length) return []
    const opId = this.operationId('sync-all')
    const total = subscriptions.length
    this.emitOperation({ opId, kind: 'sync', status: 'running', current: 0, total })
    const outcomes: SyncOutcome[] = []
    try {
      for (const [index, subscription] of subscriptions.entries()) {
        const label =
          subscription.journal?.title || subscription.name || subscription.feed?.title || subscription.feedId
        this.emitOperation({
          opId,
          kind: 'sync',
          status: 'running',
          current: index,
          total,
          percent: index / total,
          detail: label
        })
        outcomes.push(await this.rss.syncSubscription(subscription, { force }))
        this.emitOperation({
          opId,
          kind: 'sync',
          status: 'running',
          current: index + 1,
          total,
          percent: (index + 1) / total,
          detail: label
        })
      }
      const failed = outcomes.filter((outcome) => outcome.status === 'error').length
      this.emitOperation({
        opId,
        kind: 'sync',
        status: 'done',
        current: total,
        total,
        percent: 1,
        detail: failed ? `${total - failed}/${total}` : undefined
      })
      this.enqueueDiscoverBackfill()
      return outcomes
    } catch (error) {
      this.emitOperation({ opId, kind: 'sync', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  syncHistory(limit = 50): SyncHistoryEntry[] {
    return this.subscriptions.syncHistory(limit)
  }

  groups(): SubscriptionGroup[] {
    return this.subscriptions.groups()
  }

  createGroup(name: string, color?: string | null): SubscriptionGroup {
    return this.subscriptions.createGroup(name, color)
  }

  updateGroup(id: string, patch: { name?: string; color?: string | null; sortOrder?: number }): void {
    this.subscriptions.updateGroup(id, patch)
  }

  deleteGroup(id: string): void {
    this.subscriptions.deleteGroup(id)
  }

  // ---------- PDF ----------
  async importPdfs(paths: string[], mode?: 'managed' | 'linked', articleId?: string): Promise<PdfImportResult> {
    const opId = this.operationId('pdf-import')
    this.emitOperation({ opId, kind: 'pdf-import', status: 'running', current: 0, total: 0 })
    try {
      const result = await this.pdf.importPaths(paths, { mode, articleId }, (progress) => {
        this.emitOperation({
          opId,
          kind: 'pdf-import',
          status: 'running',
          detail: progress.detail,
          current: progress.current,
          total: progress.total,
          percent: progress.total ? Math.min(1, progress.current / progress.total) : undefined
        })
      })
      this.emitOperation({
        opId,
        kind: 'pdf-import',
        status: 'done',
        current: result.items.length,
        total: result.items.length,
        percent: 1,
        detail: `${result.imported} / ${result.items.length}`
      })
      return result
    } catch (error) {
      this.emitOperation({ opId, kind: 'pdf-import', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  readPdfBytes(pdfId: string): Promise<Uint8Array> {
    return this.pdf.readBytes(pdfId)
  }

  async downloadOpenAccess(articleId: string) {
    const article = this.articles.get(articleId)
    const opId = this.operationId('download')
    this.emitOperation({ opId, kind: 'download', status: 'running', detail: article?.title })
    try {
      const result = await this.pdf.downloadOpenAccess(articleId)
      if (result.error) {
        this.emitOperation({ opId, kind: 'download', status: 'error', error: result.error })
      } else {
        this.emitOperation({ opId, kind: 'download', status: 'done', percent: 1, detail: article?.title })
      }
      return result
    } catch (error) {
      this.emitOperation({ opId, kind: 'download', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  async deletePdf(pdfId: string, deleteManagedFile = false): Promise<void> {
    return this.pdf.deletePdf(pdfId, deleteManagedFile)
  }

  // ---------- Settings ----------
  settingsGet(): AppSettings {
    return this.settings.get()
  }

  settingsUpdate(patch: SettingsPatch): AppSettings {
    const next = this.settings.update(patch)
    if (next.rss.autoSync) this.rss.startScheduler()
    else this.rss.stopScheduler()
    this.emitEvent({ type: 'settings:changed', payload: next })
    return next
  }

  async testAi(): Promise<string> {
    const config = this.settings.providerConfig()
    if (!config.apiKey) return 'No API key configured. The local heuristic classifier is active.'
    const { provider } = createProvider(config)
    return provider.testConnection()
  }

  // ---------- Assistant ----------
  listThreads(): AssistantThread[] {
    return this.assistant.listThreads()
  }

  threadMessages(threadId: string): AssistantMessage[] {
    return this.assistant.threadMessages(threadId)
  }

  createThread(title: string): AssistantThread {
    return this.assistant.createThread(title)
  }

  deleteThread(id: string): void {
    this.assistant.deleteThread(id)
  }

  async askAssistant(request: AssistantRequest): Promise<AssistantResponse> {
    const opId = this.operationId('assistant')
    this.emitOperation({
      opId,
      kind: 'assistant',
      status: 'running',
      detail: request.question?.slice(0, 80)
    })
    try {
      const response = await this.assistant.handle(request)
      this.emitOperation({ opId, kind: 'assistant', status: 'done', percent: 1 })
      return response
    } catch (error) {
      this.emitOperation({ opId, kind: 'assistant', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  // ---------- Import / export ----------
  exportBibtex(ids?: string[]): { content: string; count: number } {
    return this.importExport.exportBibtex(ids)
  }

  importBibtex(text: string): IoResult {
    return this.importExport.importBibtex(text)
  }

  exportRis(ids?: string[]): { content: string; count: number } {
    return this.importExport.exportRis(ids)
  }

  importRis(text: string): IoResult {
    return this.importExport.importRis(text)
  }

  exportCsv(ids?: string[]): { content: string; count: number } {
    return this.importExport.exportCsv(ids)
  }

  exportJson(): { content: string; count: number } {
    return this.importExport.exportJson()
  }

  importJson(text: string): IoResult {
    return this.importExport.importJson(text)
  }

  // ---------- Backup ----------
  async createBackup(targetPath: string) {
    const opId = this.operationId('backup')
    this.emitOperation({ opId, kind: 'backup', status: 'running', current: 0, total: 0 })
    try {
      const info = await this.backup.createBackup(targetPath, (progress) => {
        this.emitOperation({
          opId,
          kind: 'backup',
          status: 'running',
          current: progress.current,
          total: progress.total,
          percent: progress.total ? Math.min(1, progress.current / progress.total) : undefined
        })
      })
      this.emitOperation({ opId, kind: 'backup', status: 'done', percent: 1 })
      return info
    } catch (error) {
      this.emitOperation({ opId, kind: 'backup', status: 'error', error: this.errorMessage(error) })
      throw error
    }
  }

  async listBackups() {
    return this.backup.listAutoBackups()
  }

  async stageRestore(zipPath: string) {
    return this.backup.stageRestore(zipPath)
  }

  async safetySnapshot(): Promise<string> {
    return this.backup.copyCurrentForSafety()
  }

  pluginStatus() {
    return this.plugin.status()
  }

  installWpsPlugin() {
    return this.plugin.installWps()
  }

  async uninstallWpsPlugin(): Promise<void> {
    await this.plugin.uninstallWps()
  }

  setupWordPlugin() {
    return this.plugin.setupWord()
  }

  pluginGuidePath(): string {
    return this.plugin.guidePath()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.rss.stopScheduler()
    void this.plugin.stop().catch(() => undefined)
    this.db.close()
  }
}
