const { _electron } = require('playwright')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

async function main() {
  const root = path.join(__dirname, '..')
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'literaturex-packaged-'))
  const executablePath = path.join(root, 'release', 'win-unpacked', 'LiteratureX.exe')
  const app = await _electron.launch({
    executablePath,
    env: {
      ...process.env,
      LITERATUREX_USER_DATA: userDataDir,
      LITERATUREX_WPS_ADDONS_DIR: path.join(userDataDir, 'jsaddons'),
      LITERATUREX_OFFLINE: '1'
    }
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: '研究总览' }).waitFor({ timeout: 30000 })
  const info = await page.evaluate(() => window.api.app.info())
  console.log('info:', info)

  const result = await page.evaluate(async (pdfPath) => {
    await window.api.categories.create({
      name: 'Deep Learning',
      keywords: [{ keyword: 'deep learning' }, { keyword: 'neural network' }]
    })
    const imported = await window.api.pdf.importPaths([pdfPath])
    const articleId = imported.items[0]?.articleId
    if (!articleId) throw new Error('Packaged PDF import failed')
    const classified = await window.api.articles.classify(articleId, true)
    const article = await window.api.articles.get(articleId)
    return {
      imported: imported.imported,
      title: article?.title,
      pages: article?.pdfFiles[0]?.pageCount,
      provider: classified.provider,
      categories: classified.classifications.length
    }
  }, path.join(root, 'tests', 'fixtures', 'sample.pdf'))
  console.log('pipeline:', result)
  const plugin = await page.evaluate(async () => {
    const status = await window.api.plugins.status()
    const installed = await window.api.plugins.installWps()
    const after = await window.api.plugins.status()
    await window.api.plugins.uninstallWps()
    return { httpRunning: status.httpRunning, wpsPath: installed.path, wpsInstalled: after.wpsInstalled }
  })
  console.log('plugin:', plugin)
  await page.getByRole('button', { name: '我的文库', exact: true }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(root, '.tmp', 'packaged.png') })
  console.log('errors:', errors)
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  if (errors.length) process.exit(2)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
