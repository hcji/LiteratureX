export interface Migration {
  version: number
  name: string
  sql: string
}

const initialSchema = `
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  issn TEXT,
  eissn TEXT,
  publisher TEXT,
  homepage_url TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_issn ON journals(issn) WHERE issn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_eissn ON journals(eissn) WHERE eissn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journals_title ON journals(title);

CREATE TABLE IF NOT EXISTS rss_feeds (
  id TEXT PRIMARY KEY,
  journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  site_url TEXT,
  discovered_by TEXT,
  last_fetched_at TEXT,
  etag TEXT,
  last_modified TEXT,
  last_status TEXT,
  last_error TEXT,
  last_item_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_journal ON rss_feeds(journal_id);

CREATE TABLE IF NOT EXISTS subscription_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
  name TEXT,
  group_id TEXT REFERENCES subscription_groups(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(feed_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_group ON subscriptions(group_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON subscriptions(enabled, last_sync_at);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  doi TEXT,
  doi_normalized TEXT,
  journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  journal_title TEXT,
  publisher TEXT,
  publication_date TEXT,
  year INTEGER,
  volume TEXT,
  issue TEXT,
  pages TEXT,
  abstract TEXT,
  url TEXT,
  article_type TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  in_library INTEGER NOT NULL DEFAULT 1,
  read_status TEXT NOT NULL DEFAULT 'unread',
  starred INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dedup_key TEXT,
  ai_summary TEXT,
  keywords TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  metadata_confidence TEXT,
  user_edited_fields TEXT,
  deleted_at TEXT,
  last_classified_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_doi ON articles(doi_normalized) WHERE doi_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_dedup ON articles(dedup_key) WHERE doi_normalized IS NULL AND dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_journal ON articles(journal_id);
CREATE INDEX IF NOT EXISTS idx_articles_pubdate ON articles(publication_date);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_library ON articles(in_library, deleted_at);
CREATE INDEX IF NOT EXISTS idx_articles_read ON articles(read_status);
CREATE INDEX IF NOT EXISTS idx_articles_starred ON articles(starred);
CREATE INDEX IF NOT EXISTS idx_articles_subscription ON articles(subscription_id);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_title ON articles(normalized_title);

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_authors_norm ON authors(normalized_name);

CREATE TABLE IF NOT EXISTS article_authors (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, author_id)
);
CREATE INDEX IF NOT EXISTS idx_article_authors_author ON article_authors(author_id);

CREATE TABLE IF NOT EXISTS pdf_files (
  id TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'managed',
  sha256 TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  text_extracted INTEGER NOT NULL DEFAULT 0,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  source_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdf_files_article ON pdf_files(article_id);

CREATE TABLE IF NOT EXISTS article_fulltexts (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  page_texts TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  extracted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  color TEXT,
  icon TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS category_keywords (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'keyword',
  weight REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_category_keywords_category ON category_keywords(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_keywords_unique ON category_keywords(category_id, lower(keyword), kind);

CREATE TABLE IF NOT EXISTS article_categories (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'ai',
  confidence REAL NOT NULL DEFAULT 0,
  evidence TEXT,
  reasoning TEXT,
  matched_keywords TEXT,
  status TEXT NOT NULL DEFAULT 'auto',
  decided_by TEXT NOT NULL DEFAULT 'ai',
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_article_categories_article ON article_categories(article_id);
CREATE INDEX IF NOT EXISTS idx_article_categories_category ON article_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_article_categories_status ON article_categories(status);

CREATE TABLE IF NOT EXISTS ai_classifications (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  raw_response TEXT,
  parsed_json TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  duration_ms INTEGER,
  thresholds TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_classifications_article ON ai_classifications(article_id, created_at);

CREATE TABLE IF NOT EXISTS classification_history (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  category_id TEXT,
  category_name TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'ai',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classification_history_article ON classification_history(article_id, created_at);

CREATE TABLE IF NOT EXISTS category_suggestions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  payload_json TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_category_suggestions_status ON category_suggestions(status);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_article ON notes(article_id);

CREATE TABLE IF NOT EXISTS reading_status (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unread',
  last_viewed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_history (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_history_subscription ON sync_history(subscription_id, started_at);

CREATE TABLE IF NOT EXISTS ai_model_settings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'default',
  provider_type TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT,
  model TEXT,
  temperature REAL NOT NULL DEFAULT 0.1,
  max_tokens INTEGER NOT NULL DEFAULT 1600,
  api_key_cipher TEXT,
  is_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload TEXT,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS metadata_cache (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metadata_cache_fetched ON metadata_cache(fetched_at);

CREATE TABLE IF NOT EXISTS assistant_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages(thread_id, created_at);
`

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchema
  },
  {
    version: 2,
    name: 'bilingual_category_keywords',
    sql: `
ALTER TABLE category_keywords ADD COLUMN keyword_en TEXT;
ALTER TABLE category_keywords ADD COLUMN keyword_zh TEXT;
`
  },
  {
    version: 3,
    name: 'interest_profile_and_translations',
    sql: `
CREATE TABLE IF NOT EXISTS interest_profiles (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  signature TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  vector_json TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'local',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_translations (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT,
  fields TEXT NOT NULL DEFAULT 'title',
  provider TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, language)
);
CREATE INDEX IF NOT EXISTS idx_article_translations_language ON article_translations(language);
`
  }
]
