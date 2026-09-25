# Foxmask Browser

An antidetect browser for managing isolated profiles with unique, seeded
fingerprints, per-profile proxies, and a local REST API for Selenium /
Playwright automation. Desktop app built with Electron + React + TypeScript.

![Profiles](docs/screenshots/profiles.png)

![Create wizard — fingerprint preview](docs/screenshots/wizard.png)

![Create wizard — proxy test](docs/screenshots/wizard-proxy.png)

> [!WARNING]
> Antidetect browsers violate the terms of service of most platforms. You are
> responsible for complying with the laws and terms that apply to your use.
> This project is provided for authorized testing and research purposes.

## Features

- **Isolated profiles** — each profile gets its own Chromium user-data dir
  (cookies, localStorage, cache) and a frozen, seed-deterministic fingerprint.
- **Realistic fingerprints** — OS-consistent UA / platform / GPU / fonts /
  screen / timezone, generated from a seed and stable across relaunches.
- **JS-level spoofing** — Canvas noise, WebGL vendor/renderer, AudioContext,
  WebRTC IP control (incl. SDP + worker scopes), `Intl` timezone, and more,
  injected at document start in every frame.
- **Per-profile proxy** — HTTP/HTTPS/SOCKS4/SOCKS5 with auth, live proxy
  tester with IP / latency / geo, timezone auto-follows the proxy IP geo.
- **Local REST API** (GPM-style) for automation — profile CRUD, start/stop,
  CDP ws-endpoint handoff for Playwright `connectOverCDP` / Selenium.
- **Desktop UI** — dark-themed profile manager: search, group filter, tags,
  start/stop, create wizard with live fingerprint preview, bulk create,
  JSON import/export.

## Install

Prebuilt packages (Linux AppImage/deb, macOS dmg, Windows nsis) are attached
to each [release](../../releases). Linux: make the AppImage executable
(`chmod +x Foxmask-*.AppImage`) and run it.

From source (Node 22+):

```bash
npm install
npm run dev        # opens the app with hot reload
```

Chromium is read from the Playwright cache (`~/.cache/ms-playwright`) on
first launch; install it with `npx playwright-core install chromium`.

## Using Foxmask

### First steps (UI)

1. **Launch the app** → the *Profiles* screen lists all profiles (empty at first).
2. **Create a profile** → *Create profile* opens a 4-step wizard:
   - **Basics** — name, group, tags, note, startup URLs.
   - **Fingerprint** — pick the OS; a live preview shows the UA / screen /
     GPU / timezone that will be frozen into this profile. *Regenerate*
     until you like it (each click = a new seed).
   - **Proxy** — paste `socks5://user:pass@host:port` (or http/https/socks4,
     or leave empty for direct). *Test* shows the exit IP, latency and geo;
     on launch the timezone/locale automatically follow the proxy IP's geo.
   - **Review** → *Create profile*. The fingerprint is frozen at creation
     and never changes for that profile.
3. **Launch** → the *Launch* button starts a real Chromium window with that
   profile's isolated user-data dir, fingerprint and proxy. The status dot
   turns green; *Stop* closes it.
4. **Manage** — search (debounced), group filter, *Duplicate* (same config,
   new fingerprint), *Bulk create* (N profiles at once), *Import/Export*
   (JSON, fingerprints preserved), *Settings* (API port, data dir,
   Chromium path, launch at login).

### Automation (API)

The value over manual browsers: every profile is drivable headlessly.

```bash
# Where is the API listening? (default 35000, fallback written here)
cat ~/.foxmask/http.port

# Create + start a profile
curl -s localhost:35000/api/v1/profiles -X POST \
  -H 'content-type: application/json' \
  -d '{"name":"bot-1","os":"windows","raw_proxy":"socks5://u:p@1.2.3.4:1080"}'
curl -s localhost:35000/api/v1/profiles/<id>/start -X POST   # → ws_endpoint
```

```js
// Playwright attaches to the SAME fingerprinted browser
const { chromium } = require('playwright-core')
const browser = await chromium.connectOverCDP('<ws_endpoint>')
const page = browser.contexts()[0].pages()[0]
await page.goto('https://browserleaks.com/javascript')
```

Full endpoint table is below; runnable examples in `examples/`.

## When to use Foxmask (and when not)

**Use it when you need many browser identities that must not link to each
other:**

- Multi-account workflows where cookies alone are not enough — ad platforms,
  marketplaces and social networks fingerprint via canvas/WebGL/audio/tz;
  each Foxmask profile is a consistent, unique device.
- Automation fleets — spin up N profiles via the REST API, drive each with
  Playwright/Selenium over CDP, each with its own proxy and geo.
- Testing geo/OS personalization — verify your site as a Windows user in
  Berlin or a macOS user in Hanoi without VMs.
- QA of anti-fraud systems — regression-test how your detector scores
  different fingerprint combinations.

**Skip it when:**

- You only need isolated *cookies* (no fingerprint masking) — a second
  browser profile or container tab is simpler and less detectable.
- One profile is enough — Foxmask's value is *managing many* identities.
- You face hardened, adversarial detection (banks, Google ads) — JS-level
  spoofing is not a patched Chromium; sophisticated detectors can still
  flag it. See *Key risks* below and `scripts/results.md`.
- The use violates platform terms or local law — that's on you; this tool
  ships a disclaimer for a reason.



```bash
npm test           # vitest: main-process (node) + renderer (jsdom) suites
npm run build      # typecheck (tsc) + electron-vite production build
npm run build:unpack  # package a runnable linux-unpacked binary (release/)
npm run build:linux   # AppImage + deb
```

Project layout:

```
src/main/        Electron main process (no electron imports outside index.ts)
  db/            SQLite store (node:sqlite) + migrations (PRAGMA user_version)
  fingerprint/   seeded generator + injection-script builder
  launcher/      Playwright-core persistent-context launcher, CDP endpoint
  proxy/ geo/    proxy parse/check, ip-geo resolver with cache
  api/           fastify REST API v1 (127.0.0.1, default :35000)
  ipc/           services container + typed IPC handlers
  settings/      persisted app settings
  transfer/      profile import/export
  verify/        opt-in live detector verification (browserleaks, creepjs)
src/preload/     contextBridge — window.foxmask typed API
src/renderer/    React UI (profiles, wizard, bulk create, settings)
```

## REST API

The app serves a localhost-only API on `127.0.0.1:35000` (actual port is
written to `~/.foxmask/http.port` when the default is taken). GPM-style
envelope: `{ success, data, message }`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/profiles?page=&page_size=&search=&sort=` | List profiles |
| GET | `/api/v1/profiles/:id` | Profile detail (full fingerprint) |
| POST | `/api/v1/profiles` | Create (generates + freezes fingerprint) |
| PUT | `/api/v1/profiles/:id` | Update metadata / proxy |
| DELETE | `/api/v1/profiles/:id` | Delete |
| POST | `/api/v1/profiles/:id/start` | Launch → `{ ws_endpoint, debug_port }` |
| POST | `/api/v1/profiles/:id/stop` | Stop |
| GET | `/api/v1/profiles/:id/status` | Running state + endpoints |
| POST | `/api/v1/proxies/check` | `{ raw }` → `{ ip, latencyMs, geo }` |
| GET | `/health` | Liveness |

Automation examples (Playwright, Selenium) live in [`docs/automation.md`](docs/automation.md)
with runnable scripts under `examples/`.

## Verification

The spoofing surface is validated against live detectors by an opt-in suite
(`scripts/results.md` has the latest snapshot):

```bash
FOXMASK_VERIFY_NET=1 npx vitest run src/main/verify
```

## License

MIT
