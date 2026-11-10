/* Quick visual smoke test: launch the built app, screenshot the first window. */
const { _electron } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  fs.mkdirSync(path.join(__dirname, '..', '.tmp'), { recursive: true })
  const app = await _electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForTimeout(2000)
  console.log('title:', await page.title())
  console.log('url:', page.url())
  console.log('body:', (await page.locator('body').innerText()).slice(0, 300))
  await page.screenshot({ path: path.join(__dirname, '..', '.tmp', 'smoke.png') })
  await app.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
