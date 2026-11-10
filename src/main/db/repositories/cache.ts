import type { DatabaseSync } from 'node:sqlite'
import type { AppDatabase } from '../database'

export class CacheRepo {
  constructor(private readonly database: AppDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  get<T>(key: string, maxAgeMs: number): T | null {
    const row = this.db.prepare('SELECT value_json, fetched_at FROM metadata_cache WHERE key = ?').get(key) as
      | { value_json: string; fetched_at: string }
      | undefined
    if (!row) return null
    const age = Date.now() - new Date(row.fetched_at).getTime()
    if (age > maxAgeMs) return null
    try {
      return JSON.parse(row.value_json) as T
    } catch {
      return null
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO metadata_cache (key, value_json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, fetched_at = excluded.fetched_at'
      )
      .run(key, JSON.stringify(value), new Date().toISOString())
  }

  purgeOlderThan(maxAgeMs: number): void {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
    this.db.prepare('DELETE FROM metadata_cache WHERE fetched_at < ?').run(cutoff)
  }
}
