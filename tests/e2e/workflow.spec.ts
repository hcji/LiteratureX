import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { PreloadApi } from '../../src/preload/index'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

declare global {
  interface Window {
    api: PreloadApi
  }
}

const root = process.cwd()
const pdfFixture = path.join(root, 'tests', 'fixtures', 'sample.pdf')
const pdfBytes = readFileSync(pdfFixture)
const feedXml = readFileSync(path.join(root, 'tests', 'fixtures', 'feed.xml'), 'utf8')
const screenshots = path.join(root, '.tmp', 'e2e')

let app: ElectronApplication
let page: Page
let userDataDir: string
let server: http.Server
let feedUrl: string
const consoleErrors: string[] = []
const pageErrors: string[] = []

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
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: '研究总览' })).toBeVisible({ timeout: 30_000 })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mkdirSync(screenshots, { recursive: true })
  userDataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-e2e-'))
  server = http.createServer((request, response) => {
    if (request.url?.startsWith('/feed.xml')) {
      response.writeHead(200, {
        'content-type': 'application/rss+xml; charset=utf-8',
        etag: '"e2e-feed-v1"'
      })
      response.end(feedXml)
      return
    }
    if (request.url?.startsWith('/paper.pdf')) {
      response.writeHead(200, { 'content-type': 'application/pdf' })
      response.end(pdfBytes)
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  feedUrl = `http://127.0.0.1:${port}/feed.xml`
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  rmSync(userDataDir, { recursive: true, force: true })
})

test('complete workflow: taxonomy, PDF, classification, search, RSS, persistence', async () => {
  await page.screenshot({ path: path.join(screenshots, '01-dashboard.png') })

  // --- Create a user-defined hierarchical category through the UI ---
  await page.getByRole('button', { name: '分类合集', exact: true }).click()
  await expect(page.getByRole('heading', { name: '分类合集' })).toBeVisible()
  await page.getByRole('button', { name: '新建分类', exact: true }).first().click()
  const categoryDialog = page.getByRole('dialog')
  await expect(categoryDialog).toBeVisible()
  await categoryDialog.locator('input').first().fill('Deep Learning')
  await categoryDialog.locator('textarea').nth(2).fill('深度学习, 神经网络, 图神经网络')
  await categoryDialog.locator('textarea').nth(3).fill('deep learning, neural network, graph neural network')
  await categoryDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('Deep Learning', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

  // --- Category right-click menu ---
  await page.locator('aside').getByText('Deep Learning', { exact: true }).first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '编辑' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '新建子分类' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '删除' })).toBeVisible()
  await page.keyboard.press('Escape')

  // A second category through the same IPC surface (UI already verified above)
  await page.evaluate(async () => {
    await window.api.categories.create({
      name: 'Mass Spectrometry',
      keywords: [
        { keyword: 'MS/MS' },
        { keyword: 'mass spectra' },
        { keyword: 'mass spectrometry' }
      ]
    })
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(screenshots, '02-collections.png') })

  // --- Import a real PDF ---
  const articleId = await page.evaluate(async (pdfPath) => {
    const result = await window.api.pdf.importPaths([pdfPath])
    if (result.imported !== 1) throw new Error(`Expected 1 imported PDF, got ${result.imported}`)
    return result.items[0].articleId as string
  }, pdfFixture)

  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.screenshot({ path: path.join(screenshots, '03-library.png') })

  // --- Open the paper and run AI classification ---
  await page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first().click()
  await expect(page.getByRole('heading', { name: /Deep Learning for Predicting Tandem Mass Spectra/ })).toBeVisible()
  await page.getByRole('button', { name: '立即分类' }).first().click()
  await page.getByRole('tab', { name: /AI 分类/ }).click()
  const aiPanel = page.getByRole('tabpanel')
  await expect(aiPanel.getByText('Deep Learning', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshots, '04-classification.png') })

  // --- Manual correction is preserved across reclassification ---
  const resurrected = await page.evaluate(async (id) => {
    const categories = await window.api.categories.flat()
    const target = categories.find((category) => category.name === 'Deep Learning')
    if (!target) throw new Error('Deep Learning category missing')
    await window.api.categories.remove(id, target.id)
    const outcome = await window.api.articles.classify(id, true)
    return outcome.classifications.some((category) => category.categoryId === target.id)
  }, articleId)
  expect(resurrected).toBe(false)

  // --- LLM keyword generation and auto-categorization for unclassified items ---
  await page.evaluate(async () => {
    await window.api.settings.update({ ai: { autoClassify: false } })
  })
  const autoId = await page.evaluate(async () => {
    const article = await window.api.articles.create({
      title: 'Deep Learning Auto Organize Test',
      abstract: 'We apply deep learning and neural networks to mass spectrometry data.',
      source: 'manual',
      inLibrary: true
    })
    return article.id
  })
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await page.getByRole('button', { name: /未分类/ }).first().click()
  await expect(page.getByText('Deep Learning Auto Organize Test', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'LLM 整理未分类' }).click()
  const organizeDialog = page.getByRole('dialog')
  await organizeDialog.locator('input').first().fill('5')
  await organizeDialog.getByRole('button', { name: '开始整理' }).click()
  await expect
    .poll(
      async () => {
        const value = await page.evaluate(async (id) => {
          const article = await window.api.articles.get(id)
          return { keywords: article?.keywords.length ?? 0, categories: article?.categories.length ?? 0 }
        }, autoId)
        return value.keywords > 0 && value.categories > 0
      },
      { timeout: 45_000 }
    )
    .toBe(true)
  await page.evaluate(async () => {
    await window.api.settings.update({ ai: { autoClassify: true } })
  })
  await page.getByRole('button', { name: /全部文献/ }).first().click()

  // --- Search across title, abstract and extracted full text ---
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  const search = page.getByPlaceholder('搜索标题、摘要、作者、全文、笔记…')
  await search.fill('molecular networking')
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  await expect(page.locator('mark').first()).toBeVisible({ timeout: 20_000 })
  await search.fill('')
  await page.waitForTimeout(400)

  // --- Advanced filters (author + applied-state) ---
  await page.getByRole('button', { name: '高级筛选' }).click()
  const filterPopover = page.locator('[data-radix-popper-content-wrapper]').last()
  await filterPopover.locator('input').first().fill('Hongchao')
  await page.getByRole('button', { name: '应用筛选' }).click()
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  await page.getByRole('button', { name: /已应用 1 项/ }).click()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible()

  // --- Per-item right-click menu ---
  await page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first().click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  const menuBox = await page.getByRole('menu').boundingBox()
  expect(menuBox?.x ?? 0).toBeGreaterThan(30)
  expect(menuBox?.y ?? 0).toBeGreaterThan(30)
  await expect(page.getByRole('menuitem', { name: '详情' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '下载开放获取 PDF' })).toBeVisible()
  await page.getByRole('menuitem', { name: '星标' }).click()
  expect(await page.evaluate(async (id) => (await window.api.articles.get(id))?.starred, articleId)).toBe(true)
  await page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first().click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // --- Download an open-access PDF from an explicit PDF URL ---
  const pdfUrl = feedUrl.replace(/\/feed\.xml$/, '/paper.pdf')
  await page.evaluate(async (url) => {
    await window.api.articles.create({
      title: 'Open Access Download Test',
      url,
      source: 'manual',
      inLibrary: true
    })
  }, pdfUrl)
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Open Access Download Test', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
  await page.getByText('Open Access Download Test', { exact: false }).first().click()
  await page.getByRole('button', { name: '下载开放获取 PDF' }).click()
  await expect(page.getByText('开放获取 PDF 已下载').first()).toBeVisible({ timeout: 30_000 })

  // --- Discover and subscribe through the manual RSS flow ---
  await page.getByRole('button', { name: '发现', exact: true }).click()
  await page.getByRole('button', { name: '添加期刊', exact: true }).first().click()
  const journalDialog = page.getByRole('dialog')
  await journalDialog.getByPlaceholder('https://journal.example.org/rss').fill(feedUrl)
  await journalDialog.getByRole('button', { name: '验证地址' }).click()
  await expect(journalDialog.getByText('该源有效，包含 2 条内容。')).toBeVisible({ timeout: 30_000 })
  await journalDialog.getByRole('button', { name: '下一步' }).click()
  await expect(journalDialog.getByRole('button', { name: '确认订阅' })).toBeVisible()
  await journalDialog.getByRole('button', { name: '确认订阅' }).click()
  await expect(page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first()).toBeVisible({
    timeout: 45_000
  })
  await page.screenshot({ path: path.join(screenshots, '05-discover.png') })

  // --- Subscription right-click menu ---
  await page.locator('aside').getByText('Journal of Natural Products', { exact: true }).first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '同步此订阅' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '编辑订阅' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '取消订阅' })).toBeVisible()
  await page.keyboard.press('Escape')

  // --- Only explicitly added Discover items enter My Library ---
  await expect(page.getByRole('button', { name: '加入文库' }).first()).toBeVisible()
  await page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '加入文库' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: '发现', exact: true }).click()
  await expect(page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  await page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first().click()
  await expect(page.getByRole('heading', { name: /Spatial Metabolomics of Medicinal Plants/ })).toBeVisible()
  const readFeedTitle = page.locator('h3').filter({ hasText: 'Spatial Metabolomics of Medicinal Plants' }).first()
  await expect(readFeedTitle).toBeVisible()
  await expect(readFeedTitle).toHaveClass(/text-foreground\/75/)
  const detailPanel = page.locator('aside').filter({ hasText: 'Spatial Metabolomics of Medicinal Plants' }).last()
  await detailPanel.getByRole('button', { name: '加入文库' }).click()
  await expect(page.getByText('已加入文库').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  await page.getByRole('button', { name: '发现', exact: true }).click()
  await page.getByText('Spatial Metabolomics of Medicinal Plants', { exact: false }).first().click()
  await expect(page.getByRole('heading', { name: /Spatial Metabolomics of Medicinal Plants/ })).toBeVisible()

  // --- Restart and verify persistence ---
  await app.close()
  await launch()
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await expect(page.getByText('Deep Learning for Predicting Tandem Mass Spectra', { exact: false }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.getByRole('button', { name: '分类合集', exact: true }).click()
  await expect(page.getByText('Deep Learning', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshots, '06-after-restart.png') })

  expect(pageErrors, `Renderer errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors.filter((message) => !/Autofill|DevTools/.test(message)), `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})
