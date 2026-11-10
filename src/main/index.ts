import { app, BrowserWindow, Menu, dialog, safeStorage, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppContext } from './context'
import { emitToWindows, registerIpcHandlers } from './ipc'
import type { SecretBox } from './services/settings'

app.setName('LiteratureX')

const dataDirOverride = process.env['LITERATUREX_USER_DATA']
if (dataDirOverride) {
  mkdirSync(dataDirOverride, { recursive: true })
  app.setPath('userData', dataDirOverride)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null

function secretBox(): SecretBox {
  const available = safeStorage.isEncryptionAvailable()
  return {
    available,
    encrypt: (value: string): string => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value: string): string => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'LiteratureX',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'icon.png')
      : path.join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current && !url.startsWith('http://localhost:') && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

async function performRestore(zipPath: string): Promise<void> {
  if (!context) throw new Error('Application is not ready')
  const staged = await context.stageRestore(zipPath)
  await context.safetySnapshot()
  const pdfDir = context.settingsGet().storage.managedDir || path.join(context.dataDir, 'pdfs')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dbBackup = `${context.dbPath}.pre-restore-${stamp}`
  const pdfBackup = `${pdfDir}.pre-restore-${stamp}`
  const dbPath = context.dbPath
  context.close()
  context = null
  try {
    for (const suffix of ['-wal', '-shm']) {
      await fs.rm(`${dbPath}${suffix}`, { force: true }).catch(() => undefined)
    }
    if (existsSync(dbPath)) await fs.rename(dbPath, dbBackup)
    await fs.copyFile(staged.dbPath, dbPath)
    if (existsSync(staged.pdfDir)) {
      await fs.mkdir(path.dirname(pdfDir), { recursive: true })
      if (existsSync(pdfDir)) await fs.rename(pdfDir, pdfBackup)
      await fs.cp(staged.pdfDir, pdfDir, { recursive: true })
    }
    await fs.rm(staged.stagingDir, { recursive: true, force: true }).catch(() => undefined)
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Restore complete',
      message: 'The backup was restored. LiteratureX will restart now.'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      if (existsSync(dbBackup) && !existsSync(dbPath)) await fs.rename(dbBackup, dbPath)
      if (existsSync(pdfBackup) && !existsSync(pdfDir)) await fs.rename(pdfBackup, pdfDir)
    } catch {
      /* best effort rollback */
    }
    dialog.showErrorBox('Restore failed', `${message}\n\nA safety snapshot was created before the restore attempt.`)
  }
  app.relaunch()
  app.exit(0)
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  try {
    context = new AppContext({
      dataDir,
      appVersion: app.getVersion(),
      resourcesRoot: app.isPackaged
        ? path.join(process.resourcesPath, 'resources')
        : path.join(__dirname, '../../resources'),
      secretBox: secretBox(),
      emit: (event) => emitToWindows(event)
    })
  } catch (error) {
    dialog.showErrorBox(
      'LiteratureX could not open its database',
      `${error instanceof Error ? error.message : String(error)}\n\nDatabase: ${path.join(dataDir, 'literaturex.db')}\nYou can restore a backup from the data folder.`
    )
    app.quit()
    return
  }
  registerIpcHandlers(context, {
    getWindow: () => mainWindow,
    onRestore: performRestore
  })
  mainWindow = createWindow()
  void context.initialize().catch((error) => {
    console.error('Initialization error', error)
    dialog.showErrorBox(
      'LiteratureX initialization problem',
      error instanceof Error ? error.message : String(error)
    )
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    context?.close()
  } catch {
    /* ignore close errors during shutdown */
  }
  context = null
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason)
})
