/* Development-only release helper: keep win-unpacked, remove installer/portable artifacts. */
const fs = require('node:fs')
const path = require('node:path')

const releaseDir = path.join(__dirname, '..', 'release')
if (fs.existsSync(releaseDir)) {
  for (const name of fs.readdirSync(releaseDir)) {
    if (/\.(exe|blockmap)$/i.test(name)) {
      fs.rmSync(path.join(releaseDir, name), { force: true, recursive: true })
      console.log(`[release] removed ${name}`)
    }
  }
}
