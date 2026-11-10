import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type {
  AddSubscriptionInput,
  ArticlePatch,
  ArticleQuery,
  AssistantRequest,
  AutoOrganizeOptions,
  CategoryMergeInput,
  CreateArticleInput,
  JournalCandidate,
  SettingsPatch
} from '@shared/types'
import type { AppContext } from './context'

const idSchema = z.string().min(1).max(200)
const idsSchema = z.array(idSchema).max(10000)
const stringSchema = z.string().min(1).max(8000)

function windowOf(getWindow: () => BrowserWindow | null): BrowserWindow | null {
  return getWindow() ?? BrowserWindow.getFocusedWindow()
}

async function chooseSavePath(
  getWindow: () => BrowserWindow | null,
  options: { title: string; defaultPath: string; filters: Electron.FileFilter[] }
): Promise<string | null> {
  const win = windowOf(getWindow)
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function chooseOpenPath(
  getWindow: () => BrowserWindow | null,
  options: { title: string; filters?: Electron.FileFilter[]; properties?: Electron.OpenDialogOptions['properties'] }
): Promise<string[]> {
  const win = windowOf(getWindow)
  const result = win
    ? await dialog.showOpenDialog(win, { ...options, properties: options.properties ?? ['openFile'] })
    : await dialog.showOpenDialog({ ...options, properties: options.properties ?? ['openFile'] })
  return result.canceled ? [] : result.filePaths
}

export interface IpcDependencies {
  getWindow: () => BrowserWindow | null
  onRestore: (zipPath: string) => Promise<void>
}

export function registerIpcHandlers(ctx: AppContext, deps: IpcDependencies): void {
  const handle = (channel: string, listener: (...args: never[]) => unknown): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, listener as (...args: unknown[]) => unknown)
  }

  handle('app:info', () => ctx.info())

  handle('app:openExternal', async (_event, url: unknown) => {
    const value = stringSchema.parse(url)
    if (!/^https?:\/\//i.test(value)) throw new Error('Only http(s) URLs can be opened')
    await shell.openExternal(value)
  })

  handle('app:openPath', async (_event, target: unknown) => {
    const value = stringSchema.parse(target)
    const result = await shell.openPath(value)
    if (result) throw new Error(result)
  })

  handle('app:openDataDir', async () => {
    await shell.openPath(ctx.dataDir)
  })

  // ---------- Settings ----------
  handle('settings:get', () => ctx.settingsGet())
  handle('settings:update', (_event, patch: unknown) => ctx.settingsUpdate(patch as SettingsPatch))
  handle('settings:testAi', () => ctx.testAi())
  handle('settings:chooseStorageDir', async () => {
    const folders = await chooseOpenPath(deps.getWindow, {
      title: 'Choose the managed PDF folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!folders.length) return null
    return ctx.settingsUpdate({ storage: { managedDir: folders[0] } })
  })

  // ---------- Office / WPS add-ins ----------
  handle('plugins:status', () => ctx.pluginStatus())
  handle('plugins:installWps', () => ctx.installWpsPlugin())
  handle('plugins:uninstallWps', () => ctx.uninstallWpsPlugin())
  handle('plugins:setupWord', () => ctx.setupWordPlugin())
  handle('plugins:openFolder', async (_event, kind: unknown) => {
    const value = z.enum(['wps', 'word']).parse(kind)
    const status = ctx.pluginStatus()
    const target = value === 'wps' ? status.wpsPath : path.dirname(status.wordManifestPath)
    await fs.mkdir(target, { recursive: true }).catch(() => undefined)
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
  handle('plugins:openGuide', async () => {
    const guide = ctx.pluginGuidePath()
    const error = await shell.openPath(guide)
    if (error) throw new Error(error)
  })

  // ---------- Dashboard ----------
  handle('dashboard:get', () => ctx.dashboard())

  // ---------- Articles ----------
  handle('articles:list', (_event, query: unknown) => ctx.listArticles((query ?? {}) as ArticleQuery))
  handle('articles:get', (_event, id: unknown) => ctx.getArticle(idSchema.parse(id)))
  handle('articles:openInSystem', async (_event, id: unknown) => {
    const article = ctx.getArticle(idSchema.parse(id))
    if (!article) throw new Error('Article not found')
    const pdf = article.pdfFiles[0]
    if (pdf) {
      const error = await shell.openPath(pdf.filePath)
      if (!error) return { kind: 'pdf' as const }
    }
    const target =
      article.url && /^https?:\/\//i.test(article.url)
        ? article.url
        : article.doi
          ? `https://doi.org/${article.doi}`
          : null
    if (target) {
      await shell.openExternal(target)
      return { kind: 'url' as const }
    }
    throw new Error('This article has no attached PDF, publisher URL, or DOI')
  })
  handle('articles:search', (_event, query: unknown) => ctx.search((query ?? {}) as ArticleQuery))
  handle('articles:create', (_event, input: unknown) => {
    const payload = input as CreateArticleInput
    if (!payload?.title || typeof payload.title !== 'string') throw new Error('Title is required')
    return ctx.createArticle(payload)
  })
  handle('articles:update', (_event, id: unknown, patch: unknown) =>
    ctx.updateArticle(idSchema.parse(id), (patch ?? {}) as ArticlePatch)
  )
  handle('articles:setRead', (_event, id: unknown, status: unknown) => {
    const value = z.enum(['unread', 'reading', 'read']).parse(status)
    ctx.setRead(idSchema.parse(id), value)
  })
  handle('articles:setStarred', (_event, id: unknown, starred: unknown) => {
    ctx.setStarred(idSchema.parse(id), Boolean(starred))
  })
  handle('articles:setInLibrary', (_event, id: unknown, inLibrary: unknown) => {
    ctx.setInLibrary(idSchema.parse(id), Boolean(inLibrary))
  })
  handle('articles:trash', (_event, id: unknown) => ctx.trashArticle(idSchema.parse(id)))
  handle('articles:restore', (_event, id: unknown) => ctx.restoreArticle(idSchema.parse(id)))
  handle('articles:delete', (_event, id: unknown) => ctx.deleteArticle(idSchema.parse(id)))
  handle('articles:emptyTrash', () => ctx.emptyTrash())
  handle('articles:addNote', (_event, articleId: unknown, content: unknown) => {
    ctx.addNote(idSchema.parse(articleId), z.string().min(1).max(100000).parse(content))
  })
  handle('articles:updateNote', (_event, noteId: unknown, content: unknown) => {
    ctx.updateNote(idSchema.parse(noteId), z.string().min(1).max(100000).parse(content))
  })
  handle('articles:deleteNote', (_event, noteId: unknown) => ctx.deleteNote(idSchema.parse(noteId)))

  // ---------- Categories ----------
  handle('categories:tree', () => ctx.categoriesTree())
  handle('categories:flat', () => ctx.categoriesFlat())
  handle('categories:create', (_event, input: unknown) => ctx.createCategory(input as never))
  handle('categories:update', (_event, id: unknown, patch: unknown) => ctx.updateCategory(idSchema.parse(id), patch as never))
  handle('categories:delete', (_event, id: unknown) => ctx.deleteCategory(idSchema.parse(id)))
  handle('categories:suggestMerge', (_event, ids: unknown) => ctx.suggestCategoryMerge(idsSchema.parse(ids)))
  handle('categories:merge', (_event, ids: unknown, input: unknown) =>
    ctx.mergeCategories(idsSchema.parse(ids), input as CategoryMergeInput)
  )
  handle('categories:assign', (_event, articleId: unknown, categoryId: unknown) => {
    ctx.assignCategory(idSchema.parse(articleId), idSchema.parse(categoryId))
  })
  handle('categories:remove', (_event, articleId: unknown, categoryId: unknown) => {
    ctx.removeCategory(idSchema.parse(articleId), idSchema.parse(categoryId))
  })
  handle('categories:accept', (_event, articleId: unknown, categoryId: unknown) => {
    ctx.acceptCategory(idSchema.parse(articleId), idSchema.parse(categoryId))
  })
  handle('articles:classify', (_event, id: unknown, force: unknown) => ctx.classifyArticle(idSchema.parse(id), force !== false))
  handle('articles:classificationHistory', (_event, id: unknown) => ctx.classificationHistory(idSchema.parse(id)))
  handle('articles:classifyBatch', (_event, ids: unknown, force: unknown) => ctx.classifyBatch(idsSchema.parse(ids), force !== false))
  handle('articles:autoOrganize', (_event, options: unknown) =>
    ctx.autoOrganizeUnclassified((options ?? {}) as AutoOrganizeOptions)
  )
  handle('articles:dedupe', () => ctx.dedupeArticles())
  handle('articles:classifyPending', () => ctx.classifyPending())
  handle('articles:classifyUnclassifiedDiscover', () => ctx.classifyUnclassifiedDiscover())
  handle('articles:reclassifyAll', () => ctx.reclassifyAll())
  handle('jobs:list', () => ctx.listJobs())
  handle('suggestions:list', () => ctx.listSuggestions())
  handle('suggestions:generate', () => ctx.taxonomySuggestions())
  handle('suggestions:accept', (_event, id: unknown) => ctx.acceptSuggestion(idSchema.parse(id)))
  handle('suggestions:dismiss', (_event, id: unknown) => ctx.dismissSuggestion(idSchema.parse(id)))

  // ---------- Journals / subscriptions ----------
  handle('journals:search', (_event, query: unknown) => ctx.searchJournals(stringSchema.parse(query)))
  handle('journals:discoverFeeds', (_event, journal: unknown) => ctx.discoverFeeds(journal as JournalCandidate))
  handle('journals:validateFeed', (_event, url: unknown) => ctx.validateFeed(stringSchema.parse(url)))

  handle('subscriptions:list', () => ctx.subscriptionsList())
  handle('subscriptions:add', (_event, input: unknown) => {
    const payload = input as AddSubscriptionInput
    if (!payload?.feedUrl) throw new Error('Feed URL is required')
    return ctx.addSubscription(payload)
  })
  handle('subscriptions:update', (_event, id: unknown, patch: unknown) => ctx.updateSubscription(idSchema.parse(id), patch as never))
  handle('subscriptions:delete', (_event, id: unknown) => ctx.deleteSubscription(idSchema.parse(id)))
  handle('subscriptions:sync', (_event, id: unknown, force: unknown) => ctx.syncSubscription(idSchema.parse(id), Boolean(force)))
  handle('subscriptions:syncAll', (_event, force: unknown) => ctx.syncAll(Boolean(force)))
  handle('subscriptions:history', (_event, limit: unknown) => ctx.syncHistory(typeof limit === 'number' ? limit : 50))
  handle('groups:list', () => ctx.groups())
  handle('groups:create', (_event, name: unknown, color: unknown) => ctx.createGroup(stringSchema.parse(name), typeof color === 'string' ? color : null))
  handle('groups:update', (_event, id: unknown, patch: unknown) => ctx.updateGroup(idSchema.parse(id), patch as never))
  handle('groups:delete', (_event, id: unknown) => ctx.deleteGroup(idSchema.parse(id)))

  // ---------- PDF ----------
  handle('pdf:importDialog', async () => {
    const files = await chooseOpenPath(deps.getWindow, {
      title: 'Import PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
    })
    if (!files.length) return { items: [], imported: 0, duplicates: 0, errors: 0 }
    return ctx.importPdfs(files)
  })
  handle('pdf:importFolderDialog', async () => {
    const folders = await chooseOpenPath(deps.getWindow, {
      title: 'Import a folder of PDFs',
      properties: ['openDirectory']
    })
    if (!folders.length) return { items: [], imported: 0, duplicates: 0, errors: 0 }
    return ctx.importPdfs(folders)
  })
  handle('pdf:importPaths', (_event, paths: unknown, mode: unknown) => {
    const list = z.array(z.string().min(1)).min(1).max(5000).parse(paths)
    const storageMode = mode === 'linked' ? 'linked' : mode === 'managed' ? 'managed' : undefined
    return ctx.importPdfs(list, storageMode)
  })
  handle('pdf:importForArticle', async (_event, articleId: unknown) => {
    const id = idSchema.parse(articleId)
    const files = await chooseOpenPath(deps.getWindow, {
      title: 'Attach a PDF to this paper',
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
    })
    if (!files.length) return { items: [], imported: 0, duplicates: 0, errors: 0 }
    return ctx.importPdfs(files, undefined, id)
  })
  handle('pdf:read', (_event, pdfId: unknown) => ctx.readPdfBytes(idSchema.parse(pdfId)))
  handle('pdf:downloadOA', (_event, articleId: unknown) => ctx.downloadOpenAccess(idSchema.parse(articleId)))
  handle('pdf:delete', (_event, pdfId: unknown, deleteFile: unknown) => ctx.deletePdf(idSchema.parse(pdfId), Boolean(deleteFile)))
  handle('pdf:reveal', async (_event, pdfId: unknown) => {
    const pdf = ctx.pdfs.get(idSchema.parse(pdfId))
    if (!pdf) throw new Error('PDF not found')
    shell.showItemInFolder(pdf.filePath)
  })
  handle('pdf:getPath', (_event, pdfId: unknown) => {
    const pdf = ctx.pdfs.get(idSchema.parse(pdfId))
    if (!pdf) throw new Error('PDF not found')
    return pdf.filePath
  })

  // ---------- Assistant ----------
  handle('assistant:threads', () => ctx.listThreads())
  handle('assistant:threadMessages', (_event, threadId: unknown) => ctx.threadMessages(idSchema.parse(threadId)))
  handle('assistant:createThread', (_event, title: unknown) => ctx.createThread(stringSchema.parse(title)))
  handle('assistant:deleteThread', (_event, id: unknown) => ctx.deleteThread(idSchema.parse(id)))
  handle('assistant:ask', (_event, request: unknown) => ctx.askAssistant(request as AssistantRequest))
  handle('assistant:related', (_event, articleId: unknown, limit: unknown) =>
    ctx.assistant.relatedArticles(idSchema.parse(articleId), typeof limit === 'number' ? limit : 8)
  )

  // ---------- Import / export ----------
  handle('io:export', async (_event, format: unknown, ids: unknown) => {
    const value = z.enum(['bibtex', 'ris', 'csv', 'json']).parse(format)
    const idList = ids ? idsSchema.parse(ids) : undefined
    const exported =
      value === 'bibtex'
        ? ctx.exportBibtex(idList)
        : value === 'ris'
          ? ctx.exportRis(idList)
          : value === 'csv'
            ? ctx.exportCsv(idList)
            : ctx.exportJson()
    const filters: Record<string, Electron.FileFilter[]> = {
      bibtex: [{ name: 'BibTeX', extensions: ['bib'] }],
      ris: [{ name: 'RIS', extensions: ['ris'] }],
      csv: [{ name: 'CSV', extensions: ['csv'] }],
      json: [{ name: 'JSON', extensions: ['json'] }]
    }
    const defaultPath = `literaturex-export-${new Date().toISOString().slice(0, 10)}.${
      value === 'bibtex' ? 'bib' : value === 'ris' ? 'ris' : value === 'csv' ? 'csv' : 'json'
    }`
    const target = await chooseSavePath(deps.getWindow, {
      title: `Export ${value.toUpperCase()}`,
      defaultPath,
      filters: filters[value]
    })
    if (!target) return null
    await fs.writeFile(target, exported.content, 'utf8')
    return { path: target, count: exported.count }
  })

  handle('io:import', async (_event, format: unknown) => {
    const value = z.enum(['bibtex', 'ris', 'json']).parse(format)
    const filters: Record<string, Electron.FileFilter[]> = {
      bibtex: [{ name: 'BibTeX', extensions: ['bib', 'bibtex'] }],
      ris: [{ name: 'RIS', extensions: ['ris'] }],
      json: [{ name: 'JSON', extensions: ['json'] }]
    }
    const files = await chooseOpenPath(deps.getWindow, {
      title: `Import ${value.toUpperCase()}`,
      filters: filters[value],
      properties: ['openFile']
    })
    if (!files.length) return null
    const opId = `import-${Date.now()}`
    emitToWindows({ type: 'operation:progress', payload: { opId, kind: 'import', status: 'running' } })
    try {
      const text = await fs.readFile(files[0], 'utf8')
      const result =
        value === 'bibtex' ? ctx.importBibtex(text) : value === 'ris' ? ctx.importRis(text) : ctx.importJson(text)
      emitToWindows({
        type: 'operation:progress',
        payload: { opId, kind: 'import', status: 'done', percent: 1, detail: `${result.imported ?? 0}` }
      })
      return { ...result, path: files[0] }
    } catch (error) {
      emitToWindows({
        type: 'operation:progress',
        payload: {
          opId,
          kind: 'import',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }
      })
      throw error
    }
  })

  handle('io:backup', async () => {
    const defaultPath = `literaturex-backup-${new Date().toISOString().slice(0, 10)}.zip`
    const target = await chooseSavePath(deps.getWindow, {
      title: 'Create a full backup',
      defaultPath,
      filters: [{ name: 'LiteratureX backup', extensions: ['zip'] }]
    })
    if (!target) return null
    return ctx.createBackup(target)
  })

  handle('io:listBackups', () => ctx.listBackups())

  handle('io:restore', async () => {
    const files = await chooseOpenPath(deps.getWindow, {
      title: 'Restore a LiteratureX backup',
      filters: [{ name: 'LiteratureX backup', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (!files.length) return null
    const opId = `restore-${Date.now()}`
    emitToWindows({ type: 'operation:progress', payload: { opId, kind: 'restore', status: 'running' } })
    try {
      await deps.onRestore(files[0])
      emitToWindows({ type: 'operation:progress', payload: { opId, kind: 'restore', status: 'done', percent: 1 } })
    } catch (error) {
      emitToWindows({
        type: 'operation:progress',
        payload: {
          opId,
          kind: 'restore',
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }
      })
      throw error
    }
    return { path: files[0] }
  })

  handle('data:vacuum', () => {
    ctx.db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    return true
  })
}

export function emitToWindows(event: { type: string; payload?: unknown }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:event', event)
  }
}
