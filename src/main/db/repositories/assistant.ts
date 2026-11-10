import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AssistantMessage, AssistantThread, Citation } from '@shared/types'
import type { AppDatabase } from '../database'

function nowIso(): string {
  return new Date().toISOString()
}

export class AssistantRepo {
  constructor(private readonly database: AppDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  listThreads(): AssistantThread[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM assistant_messages m WHERE m.thread_id = t.id) AS message_count
         FROM assistant_threads t ORDER BY t.updated_at DESC LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      messageCount: row.message_count as number
    }))
  }

  createThread(title: string): AssistantThread {
    const id = randomUUID()
    const timestamp = nowIso()
    this.db
      .prepare('INSERT INTO assistant_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, title, timestamp, timestamp)
    return { id, title, createdAt: timestamp, updatedAt: timestamp, messageCount: 0 }
  }

  renameThread(id: string, title: string): void {
    this.db.prepare('UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id)
  }

  touchThread(id: string): void {
    this.db.prepare('UPDATE assistant_threads SET updated_at = ? WHERE id = ?').run(nowIso(), id)
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM assistant_threads WHERE id = ?').run(id)
  }

  getThread(id: string): AssistantThread | null {
    return this.listThreads().find((thread) => thread.id === id) ?? null
  }

  messages(threadId: string): AssistantMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM assistant_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(threadId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      threadId: row.thread_id as string,
      role: row.role as AssistantMessage['role'],
      content: row.content as string,
      citations: row.citations ? (JSON.parse(row.citations as string) as Citation[]) : [],
      createdAt: row.created_at as string
    }))
  }

  addMessage(threadId: string, role: AssistantMessage['role'], content: string, citations: Citation[] = []): AssistantMessage {
    const id = randomUUID()
    const timestamp = nowIso()
    this.db
      .prepare('INSERT INTO assistant_messages (id, thread_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, threadId, role, content, JSON.stringify(citations), timestamp)
    this.touchThread(threadId)
    return { id, threadId, role, content, citations, createdAt: timestamp }
  }
}
