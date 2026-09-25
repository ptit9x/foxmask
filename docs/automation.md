# Automation Guide

Foxmask is built for automation: every profile can be created, launched and
driven from your favorite tool via the Chrome DevTools Protocol (CDP). This
guide shows how to hand a Foxmask profile browser to Playwright or Selenium.

## How it works

While the Foxmask app is running it serves a local REST API on `127.0.0.1`.
The port is written to `<data>/http.port` (default data dir: `~/.foxmask`, so
usually `~/.foxmask/http.port`) and defaults to **35000**. When 35000 is
already taken, Foxmask picks a free port and writes that one to the file —
always read `http.port` if you want to be robust.

When a profile is started, Foxmask launches a real Chromium with the profile's
fingerprint injected and exposes:

- `wsEndpoint` — the browser-level CDP WebSocket URL
  (`ws://127.0.0.1:<debugPort>/devtools/browser/<id>`)
- `debugPort` — the DevTools TCP port (also loopback-only)

Both are returned by `POST /profiles/:id/start` and `GET /profiles/:id/status`.
Playwright attaches with the ws endpoint; Selenium attaches with the port.

> The API is **localhost-only by design**. Every `/api/v1` route rejects
> non-loopback clients with `403`. Profiles, fingerprints and browser control
> stay on your machine — do not try to expose the port remotely.

All responses share one envelope:

```json
{ "success": true, "data": { }, "message": "" }
```

## curl walkthrough

Create → start → connect → stop (substitute the port from `http.port`):

```bash
API=http://127.0.0.1:35000

# 1. create a profile (fingerprint is generated server-side)
curl -s $API/api/v1/profiles \
  -H 'content-type: application/json' \
  -d '{"name": "bot-01", "os": "windows"}'
# → {"success":true,"data":{"id":"<PROFILE_ID>", ...}}

# 2. start it — returns wsEndpoint + debugPort
curl -s -X POST $API/api/v1/profiles/<PROFILE_ID>/start
# → {"success":true,"data":{"profileId":"...","wsEndpoint":"ws://127.0.0.1:PORT/devtools/browser/UUID","debugPort":PORT,"startedAt":"..."}}

# 3. (automation attaches here — see below)

# 4. stop when done
curl -s -X POST $API/api/v1/profiles/<PROFILE_ID>/stop
```

Useful extras:

```bash
# running state + endpoints of a profile
curl -s $API/api/v1/profiles/<PROFILE_ID>/status

# check a proxy before assigning it (socks5 / http supported)
curl -s $API/api/v1/proxies/check \
  -H 'content-type: application/json' \
  -d '{"raw": "socks5://user:pass@1.2.3.4:1080"}'

# assign the proxy, then start
curl -s -X PUT $API/api/v1/profiles/<PROFILE_ID> \
  -H 'content-type: application/json' \
  -d '{"raw_proxy": "socks5://user:pass@1.2.3.4:1080"}'
```

## Playwright

**Important:** `connectOverCDP` attaches to an *already running* browser. The
first context (`browser.contexts[0]`) **is the profile's persistent context** —
cookies, storage and the injected fingerprint live there. Reuse it instead of
creating a new one; a fresh `browser.newContext()` would bypass the profile.

### Python

```python
import json
import urllib.request
from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:35000"
HEADERS = {"content-type": "application/json"}


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as res:
        return json.load(res)


profile = api("POST", "/api/v1/profiles", {"name": "pw-py-demo", "os": "windows"})["data"]
started = api("POST", f"/api/v1/profiles/{profile['id']}/start")["data"]

try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(started["wsEndpoint"])
        context = browser.contexts[0]          # the profile's persistent context
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://example.com")
        print(page.title())
finally:
    api("POST", f"/api/v1/profiles/{profile['id']}/stop")
```

### Node (runnable demo in this repo)

See [`examples/playwright-node-demo.mjs`](../examples/playwright-node-demo.mjs):

```bash
node examples/playwright-node-demo.mjs
```

It uses `chromium.connectOverCDP(wsEndpoint)` from `playwright-core` (already a
dependency) and Node's global `fetch` — no extra installs.

## Selenium (Python)

Selenium attaches through the DevTools port with
`Options.debugger_address`. Because the browser is already running, the driver
only acts as a bridge to it.

```bash
pip install selenium   # Selenium >= 4.6; Selenium Manager fetches chromedriver
```

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

# ... create + start the profile via the API as above, then:
options = Options()
options.debugger_address = f"127.0.0.1:{started['debugPort']}"
driver = webdriver.Chrome(options=options)   # attaches, does not launch

driver.get("https://example.com")
print(driver.title)
# no driver.quit() needed for the browser itself — stop the profile via the API
```

A complete runnable version lives at
[`examples/selenium_demo.py`](../examples/selenium_demo.py).

> **Chromedriver note:** Selenium Manager downloads a chromedriver matching the
> *system* Chrome. The Foxmask browser is its own Chromium build — if you see a
> version mismatch, point `Service(executable_path=...)` at a driver matching
> the Chromium major version Foxmask launches.

## API reference

| # | Method | Route | Description |
|---|--------|-------|-------------|
| 1 | GET | `/health` | Liveness probe (no `/api/v1` prefix, no loopback guard payload) |
| 2 | GET | `/api/v1/profiles` | List profiles (query: `page`, `page_size`, `search`, `sort`) |
| 3 | GET | `/api/v1/profiles/:id` | Get one profile incl. full fingerprint |
| 4 | POST | `/api/v1/profiles` | Create profile (body: `name`*, `os`, `seed`, `tags`, `startup_urls`, `note`, `raw_proxy`) |
| 5 | PUT | `/api/v1/profiles/:id` | Update profile fields (not the fingerprint) |
| 6 | POST | `/api/v1/profiles/:id/regenerate` | New fingerprint (optional body: `os`, `seed`) |
| 7 | DELETE | `/api/v1/profiles/:id` | Delete profile |
| 8 | POST | `/api/v1/profiles/:id/start` | Launch browser → `wsEndpoint` + `debugPort` |
| 9 | POST | `/api/v1/profiles/:id/stop` | Stop the running browser |
| 10 | GET | `/api/v1/profiles/:id/status` | `running`, `wsEndpoint`, `debugPort`, `startedAt` |
| 11 | POST | `/api/v1/proxies/check` | Test connectivity + exit IP of a proxy (body: `raw`*, `timeout_ms`) |

`os` accepts `windows`, `macos`, `linux`, `android`.
`raw_proxy` accepts `scheme://[user:pass@]host:port` with `socks5` or `http(s)`.

## Tips

- **One profile = one browser.** Starting an already-running profile answers
  `200` with `message: "already running"` and the existing endpoints.
- **Keep the app running.** The API lives in the Foxmask app process; closing
  the app stops the API (running profile browsers keep their CDP endpoints
  until stopped).
- **Reuse the persistent context** in Playwright (see above) so the profile's
  fingerprint and storage apply to every page you open.
