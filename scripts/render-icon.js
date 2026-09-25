// Render resources/icon.svg to PNGs via headless Chromium. Node 24 strips
// quotes in `node -e` heredocs, so this lives as a file.
const { chromium } = require('playwright-core')
const fs = require('fs')

;(async () => {
  const svg = fs.readFileSync('resources/icon.svg', 'utf8')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
  await page.setContent('<html><body style="margin:0;background:transparent">' + svg + '</body></html>')
  await page.locator('svg').screenshot({ path: 'resources/icon.png', omitBackground: true })
  await browser.close()
  console.log('rendered resources/icon.png')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
