import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PdfFile } from '@shared/types'
import type { AppDatabase } from '../database'

function nowIso(): string {
  return new Date().toISOString()
}

export interface PdfInsert {
  articleId?: string | null
  filePath: string
  storageMode: 'managed' | 'linked'
  sha256: string
  size: number
  sourceUrl?: string | null
}

export class PdfRepo {
  constructor(private readonly database: AppDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db
  }

  create(input: PdfInsert): PdfFile {
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO pdf_files (id, article_id, file_path, storage_mode, sha256, size, page_count, text_extracted, extraction_status, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)'
      )
      .run(
        id,
        input.articleId ?? null,
        input.filePath,
        input.storageMode,
        input.sha256,
        input.size,
        'pending',
        input.sourceUrl ?? null,
        nowIso()
      )
    return this.get(id) as PdfFile
  }

  findBySha(sha256: string): PdfFile | null {
    const row = this.db.prepare('SELECT id FROM pdf_files WHERE sha256 = ?').get(sha256) as { id: string } | undefined
    return row ? this.get(row.id) : null
  }

  get(id: string): PdfFile | null {
    const row = this.db.prepare('SELECT * FROM pdf_files WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: row.id as string,
      articleId: (row.article_id as string | null) ?? null,
      filePath: row.file_path as string,
      storageMode: row.storage_mode as PdfFile['storageMode'],
      sha256: row.sha256 as string,
      size: row.size as number,
      pageCount: (row.page_count as number | null) ?? null,
      textExtracted: row.text_extracted === 1,
      extractionStatus: row.extraction_status as PdfFile['extractionStatus'],
      sourceUrl: (row.source_url as string | null) ?? null,
      createdAt: row.created_at as string
    }
  }

  listByArticle(articleId: string): PdfFile[] {
    const rows = this.db.prepare('SELECT id FROM pdf_files WHERE article_id = ? ORDER BY created_at DESC').all(articleId) as Array<{
      id: string
    }>
    return rows.map((row) => this.get(row.id)).filter((item): item is PdfFile => Boolean(item))
  }

  updateExtraction(
    id: string,
    patch: {
      pageCount?: number | null
      textExtracted?: boolean
      extractionStatus?: PdfFile['extractionStatus']
    }
  ): void {
    const sets: string[] = []
    const values: Array<string | number | null> = []
    if (patch.pageCount !== undefined) {
      sets.push('page_count = ?')
      values.push(patch.pageCount)
    }
    if (patch.textExtracted !== undefined) {
      sets.push('text_extracted = ?')
      values.push(patch.textExtracted ? 1 : 0)
    }
    if (patch.extractionStatus !== undefined) {
      sets.push('extraction_status = ?')
      values.push(patch.extractionStatus)
    }
    if (!sets.length) return
    values.push(id)
    this.db.prepare(`UPDATE pdf_files SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  attachToArticle(id: string, articleId: string): void {
    this.db.prepare('UPDATE pdf_files SET article_id = ? WHERE id = ?').run(articleId, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM pdf_files WHERE id = ?').run(id)
  }
}
