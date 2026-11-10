import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { JobInfo } from '@shared/types'
import type { AppDatabase } from '../database'

function nowIso(): string {
  return new Date().toISOString()
}

export class JobRepo {
  constructor(private readonly database: AppDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  create(type: string, payload?: unknown): JobInfo {
    const id = randomUUID()
    this.db
      .prepare("INSERT INTO jobs (id, type, status, payload, progress, created_at) VALUES (?, ?, 'queued', ?, 0, ?)")
      .run(id, type, payload ? JSON.stringify(payload) : null, nowIso())
    return this.get(id) as JobInfo
  }

  start(id: string): void {
    this.db.prepare("UPDATE jobs SET status = 'running', started_at = ?, progress = 0 WHERE id = ?").run(nowIso(), id)
  }

  progress(id: string, progress: number, message?: string): void {
    this.db.prepare('UPDATE jobs SET progress = ?, message = ? WHERE id = ?').run(Math.min(1, Math.max(0, progress)), message ?? null, id)
  }

  succeed(id: string, result?: unknown): void {
    this.db
      .prepare("UPDATE jobs SET status = 'success', progress = 1, finished_at = ?, result = ? WHERE id = ?")
      .run(nowIso(), result ? JSON.stringify(result) : null, id)
  }

  fail(id: string, error: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'error', finished_at = ?, error = ? WHERE id = ?")
      .run(nowIso(), error, id)
  }

  get(id: string): JobInfo | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.map(row) : null
  }

  list(limit = 30): JobInfo[] {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.map(row))
  }

  private map(row: Record<string, unknown>): JobInfo {
    return {
      id: row.id as string,
      type: row.type as string,
      status: row.status as JobInfo['status'],
      progress: row.progress as number,
      message: (row.message as string | null) ?? null,
      result: row.result ? JSON.parse(row.result as string) : null,
      error: (row.error as string | null) ?? null,
      createdAt: row.created_at as string,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null
    }
  }
}
