import { DatabaseSync } from 'node:sqlite'
import { migrations } from './schema'

export function probeFts5(db: DatabaseSync): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(x)')
    db.exec('DROP TABLE IF EXISTS __fts5_probe')
    return true
  } catch {
    return false
  }
}

function createSearchTable(db: DatabaseSync, fts5: boolean): void {
  if (fts5) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS article_fts USING fts5(
        title,
        abstract,
        authors,
        journal,
        keywords,
        notes,
        ai_summary,
        categories,
        fulltext,
        doi,
        tokenize = 'unicode61 remove_diacritics 2'
      )
    `)
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS article_fts (
        rowid INTEGER PRIMARY KEY,
        title TEXT,
        abstract TEXT,
        authors TEXT,
        journal TEXT,
        keywords TEXT,
        notes TEXT,
        ai_summary TEXT,
        categories TEXT,
        fulltext TEXT,
        doi TEXT
      )
    `)
  }
}

export class AppDatabase {
  readonly db: DatabaseSync
  readonly path: string
  readonly fts5: boolean
  private depth = 0

  constructor(path: string) {
    this.path = path
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
    }
    this.fts5 = probeFts5(this.db)
    this.migrate()
    createSearchTable(this.db, this.fts5)
  }

  migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
    const current = row?.user_version ?? 0
    for (const migration of migrations) {
      if (migration.version <= current) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.db.exec(`PRAGMA user_version = ${migration.version}`)
      })
    }
  }

  transaction<T>(fn: () => T): T {
    const savepoint = `lx_sp_${this.depth}`
    if (this.depth > 0) {
      this.db.exec(`SAVEPOINT ${savepoint}`)
      this.depth += 1
      try {
        const result = fn()
        this.depth -= 1
        this.db.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        this.depth -= 1
        this.db.exec(`ROLLBACK TO ${savepoint}`)
        this.db.exec(`RELEASE ${savepoint}`)
        throw error
      }
    }
    this.db.exec('BEGIN IMMEDIATE')
    this.depth = 1
    try {
      const result = fn()
      this.depth = 0
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.depth = 0
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}
