# Foxmask Browser

An antidetect browser for managing isolated profiles with unique, seeded
fingerprints, per-profile proxies, and a local REST API for Selenium /
Playwright automation. Desktop app built with Electron + React + TypeScript.

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

## Development

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
