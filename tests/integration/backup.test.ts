import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../../src/main/db/database'
import { ArticleRepo } from '../../src/main/db/repositories/articles'
import { BackupService } from '../../src/main/services/backup'

describe('backup and restore', () => {
  let dataDir: string
  let dbPath: string
  let database: AppDatabase

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-backup-'))
    dbPath = path.join(dataDir, 'literaturex.db')
    database = new AppDatabase(dbPath)
    const articles = new ArticleRepo(database)
    articles.create({ title: 'Backup Test Paper', authors: ['A. Author'], source: 'manual' })
    const pdfDir = path.join(dataDir, 'pdfs')
    mkdirSync(pdfDir, { recursive: true })
    writeFileSync(path.join(pdfDir, 'dummy.txt'), 'pdf placeholder')
  })

  afterEach(() => {
    database.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('creates a full backup and stages a restore', async () => {
    const service = new BackupService(database, {
      dataDir,
      dbPath,
      pdfDir: () => path.join(dataDir, 'pdfs'),
      appVersion: '0.1.0'
    })
    const zipPath = path.join(dataDir, 'backup.zip')
    const info = await service.createBackup(zipPath)
    expect(existsSync(zipPath)).toBe(true)
    expect(info.size).toBeGreaterThan(0)

    const staged = await service.stageRestore(zipPath)
    expect(existsSync(staged.dbPath)).toBe(true)
    const restored = new DatabaseSync(staged.dbPath)
    try {
      const row = restored.prepare('SELECT COUNT(*) AS c FROM articles').get() as { c: number }
      expect(row.c).toBe(1)
      const key = restored.prepare('SELECT api_key_cipher FROM ai_model_settings LIMIT 1').get() as
        | { api_key_cipher: string | null }
        | undefined
      expect(key?.api_key_cipher ?? null).toBeNull()
    } finally {
      restored.close()
    }
  })

  it('creates automatic snapshots', async () => {
    const service = new BackupService(database, {
      dataDir,
      dbPath,
      pdfDir: () => path.join(dataDir, 'pdfs'),
      appVersion: '0.1.0'
    })
    const snapshot = await service.autoSnapshot()
    expect(snapshot).not.toBeNull()
    const list = await service.listAutoBackups()
    expect(list.length).toBe(1)
    expect(existsSync(list[0].path)).toBe(true)
  })
})
