import { DatabaseSync } from 'node:sqlite'
import extract from 'extract-zip'
import { createWriteStream, promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import type { BackupInfo } from '@shared/types'
import type { AppDatabase } from '../db/database'

interface ArchiverInstance {
  pipe: (destination: NodeJS.WritableStream) => void
  append: (source: string | Buffer, options: { name: string }) => void
  file: (filePath: string, options: { name: string }) => void
  directory: (dirPath: string, destination: string) => void
  finalize: () => Promise<void> | void
  on: (event: string, listener: (payload: unknown) => void) => void
}

type ArchiverConstructor = new (options?: unknown) => ArchiverInstance

async function loadArchiver(): Promise<ArchiverConstructor> {
  const imported = (await import('archiver')) as unknown as { ZipArchive?: ArchiverConstructor; default?: unknown }
  if (imported.ZipArchive) return imported.ZipArchive
  let value: unknown = imported.default
  for (let depth = 0; depth < 4 && typeof value !== 'function'; depth += 1) {
    const next = (value as { default?: unknown })?.default
    if (!next || next === value) break
    value = next
  }
  if (typeof value !== 'function') throw new Error('Unable to load the zip archiver')
  return value as ArchiverConstructor
}

export interface BackupManifest {
  app: 'LiteratureX'
  kind: 'full-backup'
  version: 1
  createdAt: string
  appVersion?: string
  dbFile: 'literaturex.db'
  pdfDir: 'pdfs'
}

export class BackupService {
  constructor(
    private readonly db: AppDatabase,
    private readonly options: {
      dataDir: string
      dbPath: string
      pdfDir: () => string
      appVersion: string
    }
  ) {}

  async createBackup(
    targetPath: string,
    onProgress?: (progress: { current: number; total: number }) => void
  ): Promise<BackupInfo> {
    const tempDir = path.join(this.options.dataDir, '.tmp')
    await fs.mkdir(tempDir, { recursive: true })
    const snapshotPath = path.join(tempDir, `snapshot-${Date.now()}.db`)
    await this.snapshotTo(snapshotPath)
    const manifest: BackupManifest = {
      app: 'LiteratureX',
      kind: 'full-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      appVersion: this.options.appVersion,
      dbFile: 'literaturex.db',
      pdfDir: 'pdfs'
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    const createArchive = await loadArchiver()
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(targetPath)
      const archive = new createArchive({ zlib: { level: 6 } })
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.on('progress', (payload) => {
        const entries = (payload as { entries?: { total?: number; processed?: number } }).entries
        if (entries?.total) onProgress?.({ current: entries.processed ?? 0, total: entries.total })
      })
      archive.pipe(output)
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })
      archive.file(snapshotPath, { name: 'literaturex.db' })
      const pdfDir = this.options.pdfDir()
      if (existsSync(pdfDir)) archive.directory(pdfDir, 'pdfs')
      void archive.finalize()
    })
    await fs.unlink(snapshotPath).catch(() => undefined)
    const stat = await fs.stat(targetPath)
    return {
      path: targetPath,
      fileName: path.basename(targetPath),
      size: stat.size,
      createdAt: stat.mtime.toISOString()
    }
  }

  async snapshotTo(destination: string): Promise<void> {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const escaped = destination.replace(/'/g, "''")
    this.db.db.exec(`VACUUM INTO '${escaped}'`)
    try {
      const snapshot = new DatabaseSync(destination)
      snapshot.prepare('UPDATE ai_model_settings SET api_key_cipher = NULL').run()
      snapshot.close()
    } catch {
      /* the snapshot is still usable if sanitisation fails */
    }
  }

  async autoSnapshot(): Promise<BackupInfo | null> {
    const dir = path.join(this.options.dataDir, 'backups')
    await fs.mkdir(dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(dir, `auto-${day}.db`)
    if (!existsSync(target)) {
      await this.snapshotTo(target)
    }
    const files = (await fs.readdir(dir)).filter((file) => /^auto-.*\.db$/.test(file)).sort()
    for (const file of files.slice(0, Math.max(0, files.length - 7))) {
      await fs.unlink(path.join(dir, file)).catch(() => undefined)
    }
    const stat = await fs.stat(target).catch(() => null)
    return stat
      ? { path: target, fileName: path.basename(target), size: stat.size, createdAt: stat.mtime.toISOString() }
      : null
  }

  async listAutoBackups(): Promise<BackupInfo[]> {
    const dir = path.join(this.options.dataDir, 'backups')
    const files = await fs.readdir(dir).catch(() => [] as string[])
    const items: BackupInfo[] = []
    for (const file of files.filter((name) => name.endsWith('.db'))) {
      const full = path.join(dir, file)
      const stat = await fs.stat(full).catch(() => null)
      if (stat) items.push({ path: full, fileName: file, size: stat.size, createdAt: stat.mtime.toISOString() })
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async stageRestore(zipPath: string): Promise<{ stagingDir: string; dbPath: string; pdfDir: string }> {
    const stagingDir = path.join(this.options.dataDir, `.restore-${Date.now()}`)
    await fs.mkdir(stagingDir, { recursive: true })
    await extract(zipPath, { dir: stagingDir })
    const manifestPath = path.join(stagingDir, 'manifest.json')
    const dbPath = path.join(stagingDir, 'literaturex.db')
    if (!existsSync(manifestPath) || !existsSync(dbPath)) {
      throw new Error('The selected file is not a valid LiteratureX full backup')
    }
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as BackupManifest
    if (manifest.app !== 'LiteratureX' || manifest.kind !== 'full-backup') {
      throw new Error('Unsupported backup format')
    }
    const test = new DatabaseSync(dbPath)
    try {
      const row = test.prepare('PRAGMA user_version').get() as { user_version: number }
      if (!row?.user_version) throw new Error('Backup database is missing schema metadata')
    } finally {
      test.close()
    }
    return { stagingDir, dbPath, pdfDir: path.join(stagingDir, 'pdfs') }
  }

  async copyCurrentForSafety(): Promise<string> {
    const dir = path.join(this.options.dataDir, 'backups')
    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
    await this.snapshotTo(target)
    return target
  }
}
