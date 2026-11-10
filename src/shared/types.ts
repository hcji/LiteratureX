export type ID = string
export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'zh' | 'en'
export type ArticleSort = 'publication_date' | 'created_at' | 'title' | 'journal' | 'author' | 'smart'
export type SortOrder = 'asc' | 'desc'
export type ReadStatus = 'unread' | 'reading' | 'read'
export type ArticleSource = 'rss' | 'pdf' | 'manual' | 'doi' | 'import'
export type ClassificationStatus = 'auto' | 'provisional' | 'needs_review' | 'confirmed' | 'rejected'
export type ClassificationSource = 'ai' | 'manual'

export interface Author {
  id: string
  name: string
  position: number
}

export interface Journal {
  id: string
  title: string
  issn?: string | null
  eissn?: string | null
  publisher?: string | null
  homepageUrl?: string | null
  createdAt: string
}

export interface RssFeed {
  id: string
  journalId?: string | null
  url: string
  title?: string | null
  siteUrl?: string | null
  discoveredBy?: string | null
  lastFetchedAt?: string | null
  etag?: string | null
  lastModified?: string | null
  lastStatus?: string | null
  lastError?: string | null
  lastItemCount?: number | null
  createdAt: string
}

export interface SubscriptionGroup {
  id: string
  name: string
  color?: string | null
  sortOrder: number
  createdAt: string
}

export interface Subscription {
  id: string
  feedId: string
  journalId?: string | null
  groupId?: string | null
  name?: string | null
  enabled: boolean
  intervalMinutes: number
  lastSyncAt?: string | null
  createdAt: string
  journal?: Journal | null
  feed?: RssFeed | null
  group?: SubscriptionGroup | null
  unreadCount?: number
}

export interface PdfFile {
  id: string
  articleId?: string | null
  filePath: string
  storageMode: 'managed' | 'linked'
  sha256: string
  size: number
  pageCount?: number | null
  textExtracted: boolean
  extractionStatus: 'pending' | 'ok' | 'error' | 'unavailable'
  sourceUrl?: string | null
  createdAt: string
}

export interface CategoryKeyword {
  id: string
  categoryId: string
  keyword: string
  keywordEn?: string | null
  keywordZh?: string | null
  kind: 'keyword' | 'synonym'
  weight: number
}

export interface CategoryKeywordInput {
  keyword: string
  keywordEn?: string | null
  keywordZh?: string | null
  kind?: 'keyword' | 'synonym'
  weight?: number
}

export interface CategoryInput {
  name: string
  parentId?: string | null
  description?: string | null
  instructions?: string | null
  color?: string | null
  icon?: string | null
  priority?: number
  isActive?: boolean
  sortOrder?: number
  keywords?: CategoryKeywordInput[]
}

export type CategoryPatch = Partial<CategoryInput>

export interface CategoryMergeInput {
  name: string
  description?: string | null
  keywords?: string[]
}

export interface CategoryMergeSuggestion {
  name: string
  description: string
  keywords: string[]
  provider: 'ai' | 'local'
}

export interface Category {
  id: string
  parentId?: string | null
  name: string
  description?: string | null
  instructions?: string | null
  color?: string | null
  icon?: string | null
  priority: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  keywords: CategoryKeyword[]
  articleCount?: number
  children?: Category[]
  path?: string
}

export interface ArticleCategory {
  id: string
  articleId: string
  categoryId: string
  categoryName: string
  categoryPath: string
  color?: string | null
  source: ClassificationSource
  confidence: number
  evidence?: string | null
  reasoning?: string | null
  matchedKeywords: string[]
  status: ClassificationStatus
  decidedBy: 'ai' | 'user'
  model?: string | null
  promptVersion?: string | null
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  articleId: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface Article {
  id: string
  title: string
  doi?: string | null
  journalId?: string | null
  journalTitle?: string | null
  publisher?: string | null
  publicationDate?: string | null
  year?: number | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  abstract?: string | null
  url?: string | null
  articleType?: string | null
  source: ArticleSource
  subscriptionId?: string | null
  inLibrary: boolean
  readStatus: ReadStatus
  starred: boolean
  savedAt?: string | null
  createdAt: string
  updatedAt: string
  dedupKey?: string | null
  aiSummary?: string | null
  keywords: string[]
  needsReview: boolean
  metadataConfidence?: Record<string, number> | null
  userEditedFields?: string[]
  deletedAt?: string | null
  lastClassifiedAt?: string | null
  authors: Author[]
  pdfFiles: PdfFile[]
  categories: ArticleCategory[]
  notes?: Note[]
}

export interface ArticleQuery {
  scope?: 'library' | 'discover' | 'trash' | 'all'
  subscriptionId?: string
  journalId?: string
  categoryId?: string
  includeDescendants?: boolean
  unreadOnly?: boolean
  starredOnly?: boolean
  hasPdf?: boolean
  inLibraryOnly?: boolean
  search?: string
  yearFrom?: number
  yearTo?: number
  source?: ArticleSource
  author?: string
  journalTitle?: string
  unclassifiedOnly?: boolean
  needsReviewOnly?: boolean
  sort?: ArticleSort
  order?: SortOrder
  limit?: number
  offset?: number
  ids?: string[]
}

export interface ArticleListResult {
  items: Article[]
  total: number
}

export interface ArticlePatch {
  title?: string
  doi?: string | null
  journalTitle?: string | null
  publisher?: string | null
  publicationDate?: string | null
  year?: number | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  abstract?: string | null
  url?: string | null
  articleType?: string | null
  keywords?: string[]
  authors?: string[]
  readStatus?: ReadStatus
  starred?: boolean
  inLibrary?: boolean
  needsReview?: boolean
  aiSummary?: string | null
  metadataConfidence?: Record<string, number>
}

export interface CreateArticleInput {
  title: string
  doi?: string | null
  journalTitle?: string | null
  journalId?: string | null
  publisher?: string | null
  publicationDate?: string | null
  year?: number | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  abstract?: string | null
  url?: string | null
  articleType?: string | null
  authors?: string[]
  keywords?: string[]
  source?: ArticleSource
  inLibrary?: boolean
  subscriptionId?: string | null
  needsReview?: boolean
}

export interface ArticleCategoryInput {
  categoryId: string
  confidence?: number
  evidence?: string | null
  reasoning?: string | null
  matchedKeywords?: string[]
  status?: ClassificationStatus
  model?: string | null
  promptVersion?: string | null
}

export interface ClassificationHistoryEntry {
  id: string
  articleId: string
  categoryId?: string | null
  categoryName?: string | null
  action: string
  actor: 'ai' | 'user'
  before?: unknown
  after?: unknown
  createdAt: string
}

export interface AiSettings {
  provider: 'auto' | 'openai' | 'heuristic'
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  autoClassify: boolean
  sendFullText: boolean
  thresholds: { high: number; medium: number }
  apiKeySet: boolean
}

export interface RssSettings {
  autoSync: boolean
  defaultIntervalMinutes: number
  itemsPerSync: number
  contactEmail: string
}

export interface StorageSettings {
  mode: 'managed' | 'linked'
  managedDir: string
}

export interface AppearanceSettings {
  theme: ThemeMode
  language: Language
}

export interface AssistantSettings {
  sendFullText: boolean
  defaultContextLimit: number
}

export interface AppSettings {
  ai: AiSettings
  rss: RssSettings
  storage: StorageSettings
  appearance: AppearanceSettings
  assistant: AssistantSettings
}

export interface SettingsPatch {
  ai?: Partial<Omit<AiSettings, 'apiKeySet' | 'thresholds'>> & {
    thresholds?: Partial<AiSettings['thresholds']>
    apiKey?: string | null
  }
  rss?: Partial<RssSettings>
  storage?: Partial<StorageSettings>
  appearance?: Partial<AppearanceSettings>
  assistant?: Partial<AssistantSettings>
}

export interface JournalCandidate {
  title: string
  issn?: string | null
  eissn?: string | null
  publisher?: string | null
  homepageUrl?: string | null
  source: string
  score: number
}

export interface FeedCandidate {
  url: string
  feedTitle: string
  type: 'rss' | 'atom' | 'crossref' | 'unknown'
  source: string
  itemCount: number
  latestDate?: string | null
  sampleTitles: string[]
  score: number
  error?: string | null
}

export interface DiscoverFeedsResult {
  journal?: JournalCandidate | null
  candidates: FeedCandidate[]
  notes: string[]
}

export interface AddSubscriptionInput {
  feedUrl: string
  feedTitle?: string
  journalTitle?: string
  issn?: string | null
  eissn?: string | null
  publisher?: string | null
  homepageUrl?: string | null
  name?: string
  groupId?: string | null
  intervalMinutes?: number
  discoveredBy?: string
  syncNow?: boolean
}

export interface SyncOutcome {
  subscriptionId: string
  feedTitle: string
  status: 'success' | 'error' | 'not_modified'
  found: number
  added: number
  updated: number
  error?: string | null
  durationMs: number
}

export interface SyncHistoryEntry {
  id: string
  subscriptionId: string
  feedId: string
  feedTitle?: string | null
  startedAt: string
  finishedAt?: string | null
  status: 'running' | 'success' | 'error' | 'not_modified'
  itemsFound: number
  itemsNew: number
  itemsUpdated: number
  error?: string | null
}

export interface ClassificationItem {
  categoryId: string
  categoryName?: string
  confidence: number
  evidence: string
  matchedKeywords: string[]
  reasoning: string
  status: ClassificationStatus
}

export interface ClassificationOutput {
  classifications: ClassificationItem[]
  summary: string
  researchTopics: string[]
  unmatchedTopics: string[]
  needsHumanReview: boolean
}

export interface ClassifyOutcome {
  articleId: string
  provider: string
  model: string
  classifications: ArticleCategory[]
  summary: string
  researchTopics: string[]
  unmatchedTopics: string[]
  needsReview: boolean
  preservedManual: number
  createdCategories?: number
  error?: string | null
}

export type ThinkingDepth = 'low' | 'medium-low' | 'high'

export interface AutoOrganizeOptions {
  keywordCount?: number
  maxNewCategories?: number
  discoverySampleSize?: number
  includeFullText?: boolean
  thinkingDepth?: ThinkingDepth
}

export interface AutoOrganizeResult {
  jobId: string | null
  count: number
}

export interface DedupeResult {
  groups: number
  removed: number
}

export interface TaxonomySuggestion {
  id: string
  type: 'new_keyword' | 'new_subcategory' | 'missing_topic' | 'merge'
  title: string
  rationale: string
  payload: {
    parentId?: string | null
    keywords?: string[]
    categoryIds?: string[]
    name?: string
    description?: string
  }
  evidence: string
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: string
}

export interface SearchResponseItem {
  article: Article
  snippet: string
  score: number
}

export interface SearchResponse {
  items: SearchResponseItem[]
  total: number
  tookMs: number
}

export interface DashboardStats {
  totalPapers: number
  newThisWeek: number
  unread: number
  starred: number
  journals: number
  categories: number
  reviewCount: number
  unclassified: number
  pdfCount: number
  classificationByCategory: Array<{ categoryId: string; name: string; color?: string | null; count: number }>
  recentArticles: Article[]
  recentPublications: Article[]
  lastSyncAt?: string | null
  pendingJobs: number
  sourceCounts: Record<string, number>
}

export interface JobInfo {
  id: string
  type: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  progress: number
  message?: string | null
  result?: unknown
  error?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
}

export interface PdfImportResultItem {
  fileName: string
  status: 'imported' | 'duplicate' | 'error'
  articleId?: string
  pdfId?: string
  title?: string
  error?: string
  warnings?: string[]
}

export interface PdfImportResult {
  items: PdfImportResultItem[]
  imported: number
  duplicates: number
  errors: number
}

export interface PdfMetadataDraft {
  title?: string | null
  authors?: string[]
  abstract?: string | null
  journalTitle?: string | null
  year?: number | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  doi?: string | null
  keywords?: string[]
  articleType?: string | null
}

export interface AssistantThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number
}

export interface Citation {
  index: number
  articleId: string
  title: string
  page?: number | null
  snippet?: string | null
}

export interface AssistantMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: Citation[]
  createdAt: string
}

export interface AssistantThreadDetail {
  thread: AssistantThread
  messages: AssistantMessage[]
}

export type AssistantMode = 'chat' | 'summarize' | 'compare' | 'related' | 'trends'

export interface AssistantRequest {
  threadId?: string | null
  mode: AssistantMode
  question?: string
  articleIds?: string[]
  categoryId?: string | null
  language?: Language
}

export interface AssistantResponse {
  thread: AssistantThread
  messages: AssistantMessage[]
  offline: boolean
}

export interface IoResult {
  path?: string
  count?: number
  imported?: number
  skipped?: number
  errors?: string[]
}

export interface BackupInfo {
  path: string
  fileName: string
  size: number
  createdAt: string
}

export interface AppInfo {
  version: string
  name: string
  platform: string
  userDataPath: string
  dbPath: string
  pdfDir: string
  fts5: boolean
  aiConfigured: boolean
}

export type AppEventType =
  | 'articles:changed'
  | 'subscriptions:changed'
  | 'categories:changed'
  | 'settings:changed'
  | 'sync:progress'
  | 'job:progress'
  | 'operation:progress'
  | 'assistant:changed'
  | 'data:changed'

export type OperationKind =
  | 'pdf-import'
  | 'classification'
  | 'taxonomy'
  | 'sync'
  | 'assistant'
  | 'download'
  | 'backup'
  | 'restore'
  | 'import'

export interface OperationProgress {
  opId: string
  kind: OperationKind
  status: 'running' | 'done' | 'error'
  /** Optional context, e.g. the feed or file name currently being processed. */
  detail?: string
  current?: number
  total?: number
  /** 0–1; when omitted the UI renders an indeterminate bar. */
  percent?: number
  error?: string
}

export interface AppEvent {
  type: AppEventType
  payload?: unknown
}

export interface PluginReference {
  id: string
  title: string
  authors: string[]
  journalTitle: string | null
  year: number | null
  volume: string | null
  issue: string | null
  pages: string | null
  doi: string | null
  url: string | null
}

export interface CitationFormatTemplate {
  id: string
  name: string
  description?: string | null
  bibliography: string
  inText: string
  numbered?: boolean
  source: 'builtin' | 'custom' | 'public'
  createdAt?: string | null
}

export interface PluginStatus {
  version: string
  httpRunning: boolean
  httpsRunning: boolean
  httpPort: number
  httpsPort: number
  httpError: string | null
  httpsError: string | null
  wpsInstalled: boolean
  wpsPath: string
  wpsPublishPath: string
  wordManifestExists: boolean
  wordManifestPath: string
  certExists: boolean
  wordTrusted: boolean
}

export interface WpsInstallResult {
  path: string
  publishXml: string
}

export interface WordSetupResult {
  manifestPath: string
  certPath: string
  trusted: boolean
  trustError: string | null
  httpsRunning: boolean
  httpsError: string | null
}
