import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { PreloadApi } from '../../src/preload/index'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

declare global {
  interface Window {
    api: PreloadApi
  }
}

const root = process.cwd()
const pdfFixture = path.join(root, 'tests', 'fixtures', 'sample.pdf')
const screenshots = path.join(root, '.tmp', 'e2e')

let app: ElectronApplication
let page: Page
let userDataDir: string
const pageErrors: string[] = []
const consoleErrors: string[] = []

async function launch(): Promise<void> {
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      LITERATUREX_USER_DATA: userDataDir,
      LITERATUREX_WPS_ADDONS_DIR: path.join(userDataDir, 'jsaddons'),
      LITERATUREX_PLUGIN_HTTP_PORT: '0',
      LITERATUREX_PLUGIN_HTTPS_PORT: '0',
      LITERATUREX_OFFLINE: '1',
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: '研究总览' })).toBeVisible({ timeout: 30_000 })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(screenshots, { recursive: true })
  userDataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-e2e-ui-'))
  await launch()

  await page.evaluate(async () => {
    await window.api.categories.create({
      name: 'Deep Learning',
      keywords: [{ keyword: 'deep learning' }, { keyword: 'neural network' }]
    })
  })
  const articleId = await page.evaluate(async (pdfPath) => {
    const result = await window.api.pdf.importPaths([pdfPath])
    return result.items[0].articleId as string
  }, pdfFixture)
  await page.evaluate(async (id) => {
    await window.api.articles.classify(id, true)
  }, articleId)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(userDataDir, { recursive: true, force: true })
})

test('PDF preview renders in the library', async () => {
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first().click()
  await page.getByRole('tab', { name: 'PDF', exact: true }).click()
  await expect(page.locator('embedpdf-container').first()).toBeVisible({ timeout: 30_000 })
  const renderedPage = page.locator('embedpdf-container img').first()
  await expect(renderedPage).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(800)
  const size = await renderedPage.evaluate((element) => {
    const image = element as HTMLImageElement
    return { width: image.width || image.clientWidth, height: image.height || image.clientHeight }
  })
  expect(size.width).toBeGreaterThan(100)
  expect(size.height).toBeGreaterThan(100)
  await page.screenshot({ path: path.join(screenshots, '07-pdf-viewer.png') })
})

test('library table headers sort and double-click uses the system opener', async () => {
  const articleId = await page.evaluate(async () => {
    const article = await window.api.articles.create({
      title: 'No Attachment Test Paper',
      authors: ['System Tester'],
      journalTitle: 'Test Journal',
      year: 2026,
      source: 'manual',
      inLibrary: true
    })
    return article.id
  })
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByRole('button', { name: '标题' })).toBeVisible()
  await expect(page.getByRole('button', { name: '作者' })).toBeVisible()
  await expect(page.getByRole('button', { name: '期刊' })).toBeVisible()
  await expect(page.getByRole('button', { name: '年份' })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加日期' })).toBeVisible()
  await page.getByRole('button', { name: '标题' }).click()
  await page.getByText('No Attachment Test Paper', { exact: false }).first().dblclick()
  await expect(page.getByText(/no attached PDF/i).first()).toBeVisible({ timeout: 15_000 })
  await page.evaluate(async (id) => {
    await window.api.articles.delete(id)
  }, articleId)
})

test('assistant produces a cited offline summary', async () => {
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI 文献助手' })).toBeVisible()
  await page.getByRole('button', { name: '添加文献', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  await dialog.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first().click()
  await dialog.getByRole('button', { name: /添加文献 \(1\)/ }).click()
  await page.getByRole('button', { name: '总结', exact: true }).last().click()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('当前未配置 AI API', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('引用来源').first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshots, '08-assistant.png') })
})

test('settings, AI test, theme and language switching', async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('No API key configured. The local heuristic classifier is active.').first()).toBeVisible({
    timeout: 20_000
  })
  await page.screenshot({ path: path.join(screenshots, '09-settings-ai.png') })

  await page.getByRole('button', { name: '外观与语言', exact: true }).click()
  const selects = page.getByRole('combobox')
  await selects.nth(1).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Appearance and language', exact: true }).click()
  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: '中文' }).click()
  await expect(page.getByRole('button', { name: '总览', exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '外观与语言', exact: true }).click()
  await page.getByRole('combobox').nth(0).click()
  await page.getByRole('option', { name: '深色' }).click()
  await page.waitForTimeout(350)
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)
  await page.screenshot({ path: path.join(screenshots, '10-settings-dark.png') })

  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '压缩数据库' }).click()
  await expect(page.getByText('数据库已压缩').first()).toBeVisible({ timeout: 20_000 })

  expect(pageErrors, `Renderer errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors.filter((message) => !/Autofill|DevTools/.test(message)), `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})

test('settings exposes the local plugin service and installs the WPS add-in', async () => {
  await page.getByRole('navigation').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '文献插件', exact: true }).click()
  await expect(page.getByText('本地插件服务').first()).toBeVisible()
  const status = await page.evaluate(() => window.api.plugins.status())
  expect(status.httpRunning).toBe(true)
  expect(status.httpPort).toBeGreaterThan(0)
  await page.screenshot({ path: path.join(screenshots, '11-plugins.png') })

  const result = await page.evaluate(() => window.api.plugins.installWps())
  expect(result.path).toContain('jsaddons')
  const installed = await page.evaluate(() => window.api.plugins.status())
  expect(installed.wpsInstalled).toBe(true)

  await page.evaluate(() => window.api.plugins.uninstallWps())
  const removed = await page.evaluate(() => window.api.plugins.status())
  expect(removed.wpsInstalled).toBe(false)
})
