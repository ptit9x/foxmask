// Renders the real Foxmask renderer bundle with mock bridge data and
// screenshots the UI for the README. Run: node scripts/screenshot-ui.mjs
// (serves out/renderer over localhost — file:// blocks module scripts)
import { createRequire } from 'node:module'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire('/home/vmo/vibe-coding/foxmask/package.json')
const { chromium } = require('playwright-core')

const root = path.dirname(fileURLToPath(import.meta.url))
const rendererDir = path.join(root, '..', 'out', 'renderer')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(rendererDir, req.url === '/' ? 'index.html' : req.url)
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/`

const now = '2026-09-25T10:00:00.000Z'
const fp = (os, ua, platform, gpu, tz) => ({
  os, userAgent: ua, platform,
  screen: { width: 1920, height: 1080, availHeight: 1040, devicePixelRatio: 1 },
  hardwareConcurrency: 8, deviceMemory: 8, languages: ['en-US', 'en'],
  timezone: tz, geoip: null, canvas: 'noise',
  webgl: { mode: 'noise', vendor: 'Google Inc. (NVIDIA)', renderer: gpu },
  audio: 'noise', webRtc: { mode: 'based-on-ip', publicIp: null },
  fonts: ['Segoe UI', 'Calibri'], doNotTrack: null, touchPoints: 0
})

const profiles = [
  {
    id: 'a1', name: 'Shop Alpha', group_id: 'ecom', tags: ['shop', 'vip'],
    note: '', startup_urls: ['https://shop.example.com'],
    raw_proxy: 'socks5://acc1:secret@45.61.98.20:1080',
    fingerprint: fp('windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'Win32', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0)', 'America/New_York'),
    created_at: now, updated_at: now
  },
  {
    id: 'b2', name: 'Ad Account BM7', group_id: 'ads', tags: ['fb'],
    note: 'primary spender', startup_urls: [],
    raw_proxy: 'http://u:p@103.75.11.5:8080',
    fingerprint: fp('macos', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36', 'MacIntel', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Europe/Berlin'),
    created_at: now, updated_at: now
  },
  {
    id: 'c3', name: 'Scraper Farm 03', group_id: 'scraping', tags: ['worker', 'nightly'],
    note: '', startup_urls: [],
    raw_proxy: '',
    fingerprint: fp('linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'Linux x86_64', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2))', 'Asia/Ho_Chi_Minh'),
    created_at: now, updated_at: now
  }
]

const running = { running: true, wsEndpoint: 'ws://127.0.0.1:41837/devtools/browser/9f2c', debugPort: 41837, startedAt: now }
const stopped = { running: false, wsEndpoint: null, debugPort: null, startedAt: null }

const mockInit = (profileRows, runningStatus, stoppedStatus, fpWin) => {
  window.foxmask = {
    profiles: {
      list: async () => ({ rows: profileRows, total: profileRows.length, last_page: 1 }),
      get: async (id) => profileRows.find((p) => p.id === id) ?? null,
      create: async () => profileRows[0],
      update: async () => null,
      delete: async () => ({ deleted: true }),
      duplicate: async () => profileRows[0],
      start: async (id) => ({ profileId: id, wsEndpoint: 'ws://127.0.0.1:41837/devtools/browser/9f2c', debugPort: 41837, startedAt: new Date().toISOString() }),
      stop: async () => ({ stopped: true }),
      status: async (id) => (id === 'a1' ? runningStatus : stoppedStatus),
      export: async () => ({}),
      import: async () => ({ imported: [], skipped: [] })
    },
    proxies: {
      check: async () => ({ ok: true, ip: '45.61.98.20', latencyMs: 142, geo: { city: 'New York', country: 'United States', countryCode: 'US', timezone: 'America/New_York', lat: 40.71, lon: -74.01 } })
    },
    fingerprintPreview: async () => fpWin,
    settings: { get: async () => ({ apiPort: 35000, dataDir: '', chromiumPath: '', launchAtLogin: false }), set: async (p) => p },
    appInfo: async () => ({ version: '0.1.0', apiPort: 35000, dataDir: '/home/vmo/.foxmask' })
  }
}

const fpWin = fp('windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'Win32', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0)', 'America/New_York')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await page.addInitScript(mockInit, profiles, running, stopped, fpWin)
await page.goto(base)
await page.waitForTimeout(1500)

// 1 — Profiles list
await page.screenshot({ path: 'docs/screenshots/profiles.png' })

// 2 — Create wizard (Basics filled)
await page.getByRole('button', { name: 'Create profile' }).click()
await page.getByLabel('Profile name').fill('Shop Delta')
await page.waitForTimeout(600)

// 3 — Fingerprint step with live preview
await page.getByRole('dialog').getByRole('button', { name: /Next/ }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/screenshots/wizard.png' })

// 4 — Proxy step with tested feedback
await page.getByRole('dialog').getByRole('button', { name: /Next/ }).click()
await page.waitForTimeout(400)
await page.getByLabel('Proxy URL').fill('socks5://acc1:secret@45.61.98.20:1080')
await page.getByRole('button', { name: /Test/ }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'docs/screenshots/wizard-proxy.png' })

await browser.close()
server.close()
console.log('screenshots done')
