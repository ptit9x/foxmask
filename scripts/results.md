# Fingerprint network verification results

Opt-in suite: `src/main/verify/verify-fingerprint.test.ts` (skipped unless `FOXMASK_VERIFY_NET=1`).

## How to run

```bash
# full live run (needs network + playwright chromium installed)
FOXMASK_VERIFY_NET=1 npx vitest run src/main/verify

# normal CI run — verify file is skipped
npm test
```

Each test launches a real headless Chromium via the production `Launcher` with a
seed-generated Windows fingerprint (fresh `FOXMASK_HOME` tmpdir, no proxy), then
asserts what the live site actually observes.

## Results (2026-09-25, live run)

| # | Test | Status | Observed |
|---|------|--------|----------|
| 1 | browserleaks.com/javascript shows spoofed values | **PASS** | UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/138.0.0.0 Safari/537.36`, platform `Win32`, timezone `Asia/Tokyo`, screen `1536x864`, hardwareConcurrency `16` — all present in page output. (Site prints `1536×864` with U+00D7; the test normalizes `×`→`x`.) |
| 2 | browserleaks.com/webgl shows spoofed gpu | **PASS** | Vendor `Google Inc. (NVIDIA)` + renderer `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)` both shown. |
| 3 | webrtc public IP not leaked | **FAIL (real bug found)** | WebRTC section listed public IPs `123.24.143.188`, `118.70.236.74` as WebRTC-observed srflx addresses. Root cause below. |
| 4 | ipify via browser | **PASS** | Body text `118.70.236.74` (valid IPv4). Node-side `realIp` was `123.24.143.188` in the same run — this network's egress IP rotates between connections, so browser-vs-node "same IP" is not a stable assertion; validity is what we assert. |
| 5 | creepjs loads (soft) | **PASS** | Snapshot saved to `scripts/creepjs-snapshot.txt` (3000 chars). Observations below. |

## Finding: WebRTC srflx leak (test 3)

`browserleaks.com/webrtc` "Public IP Address" listed two real public IPs gathered
via WebRTC even though the profile has no proxy, so `WEBRTC_IP` is null and the
inject script intends to drop all srflx candidates (mDNS-only).

Direct probe of a launched profile (STUN to `stun.l.google.com:19302`):

- `pc.onicecandidate = ...` handler received a raw srflx candidate containing the
  real public IP — the inject script only rewrites `addEventListener('icecandidate', ...)`
  listeners; it never patches the `onicecandidate` property setter.
- `pc.localDescription.sdp` still contained `a=candidate:... typ srflx <ip> ...`
  after `await pc.setLocalDescription(await pc.createOffer())` — the script's
  `setLocalDescription` wrapper calls `orig.call(this, desc)` with a rewritten
  desc, but Chromium re-gathers/trickles candidates and the promise form bypasses
  the rewrite path the wrapper covers.
- `addEventListener` path delivered zero candidates at all (site code that uses
  only addEventListener sees nothing) — which is why browserleaks still catches
  it: the site reads `localDescription.sdp`/`onicecandidate`.

Fix directions (not in this commit — harness-only scope): define an
`onicecandidate` accessor on `RTCPeerConnection.prototype` that filters the
dispatched event, and rewrite `pc.localDescription`/`currentLocalDescription`
getters (plus `createOffer` resolution when trickle is disabled). Until fixed,
profiles without a proxy expose the machine's public IP(s) to WebRTC-probing pages.

Note on the original whole-body assertion: "Your Remote IP" on that page is the
HTTP egress IP (server-side view), which legitimately equals the real IP without
a proxy — the test now scopes to the WebRTC-observed section instead.

## Creepjs observations (test 5 snapshot)

Fingerprint used: seed `creepjs-check` → tz `Europe/London`, langs `ko-KR`, UA
`Chrome/137.0.0.0` Windows, screen `1536x864`, dpr `1.25`, gpu Intel UHD 630.

What creepjs saw (quoted from `scripts/creepjs-snapshot.txt`):

- Main-thread spoofs hold: `gpu: Google Inc. (Intel)` / `ANGLE (Intel, Intel(R) UHD Graphics 630 ... Direct3D11 ...)`, `...screen: 1536 x 864`, `avail: 1536 x 816`, dpr `1.25`, canvas `rendering: 15% rgba noise`, timezone rendered in Korean (`영국 하계 표준시` = British Summer Time) consistent with `Europe/London` + `ko-KR` locale.
- Headless flags (harness runs headless; a headful profile would score differently): `chromium: true`, `75% like headless`, `67% headless`, `20% stealth`.
- **Worker scope is not spoofed** — the inject script runs at document start only, so worker `navigator` leaks the real host: `userAgent: Mozilla/5.0 (X11; Linux x86_64) ... HeadlessChrome/153.0.8010.12 Safari/537.36`, `device: Linux (Linux x86_64)`, `cores: 8, ram: 16` (fingerprint says 4 cores), worker gpu = SwiftShader. Second real finding: inject scripts must also cover `Worker`/`ServiceWorkerGlobalScope` (e.g. via a patched `Worker` constructor injecting the same IIFE into blob URLs).
- WebRTC (creepjs's own probes): `host connection: blocked`, `stun connection: blocked`, `foundation/ip: unsupported` — consistent with srflx dropping intent, though browserleaks' localDescription read still finds them (finding above).
- `userAgentData: Windows Unknown [10.0] x86` — UA-CH platform says Windows (consistent) but brand/version come out "Unknown": high-entropy UA-CH fields are not fully mocked yet.

## Full-suite state

`npm test` (no env var): **114 passed | 5 skipped (verify file) — exit 0.**
`FOXMASK_VERIFY_NET=1`: 4 pass, 1 fail (the WebRTC leak above — a product bug the harness exists to catch, not a harness defect).

## Hardening re-run (post WebRTC + Worker fixes)

| Check | Result | Notes |
|---|---|---|
| browserleaks/javascript | PASS | UA/platform/tz/screen/cores all spoofed |
| browserleaks/webgl | PASS | NVIDIA RTX 3060 renderer spoofed |
| WebRTC leak | PASS | srflx filtered via onicecandidate + SDP + getters |
| ipify via browser | PASS | traffic flows normally |
| creepjs worker scope | PASS | HeadlessChrome: 0 hits, cores: 0 leaks; worker UA = Windows Chrome 137 |

Fixes shipped: onicecandidate property patch, localDescription getter sanitize,
Worker/SharedWorker Blob-wrapped with navigator+userAgentData+WebGL spoof,
serviceWorkers: 'block' (out-of-scope SW cannot be spoofed at JS level).
