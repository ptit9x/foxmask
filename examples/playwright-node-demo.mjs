#!/usr/bin/env node
/**
 * Foxmask → Playwright (Node) demo.
 *
 * Creates a profile via the local API, starts it, attaches over CDP with
 * playwright-core, opens example.com, prints the title, then stops and
 * deletes the profile.
 *
 * Run from the repo root (playwright-core resolves from node_modules):
 *
 *   node examples/playwright-node-demo.mjs
 *
 * Requires the Foxmask app (and its local API) to be running. The API port
 * defaults to 35000 — override with FOXMASK_API_PORT or FOXMASK_API.
 */
import { chromium } from 'playwright-core';

const apiBase =
  process.env.FOXMASK_API ?? `http://127.0.0.1:${process.env.FOXMASK_API_PORT ?? 35000}`;

async function api(method, path, body) {
  const res = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`${method} ${path} failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  // 1. create a profile — the fingerprint is generated server-side
  const profile = await api('POST', '/profiles', { name: `pw-demo-${Date.now()}`, os: 'windows' });
  console.log(`[demo] created profile ${profile.id} (${profile.fingerprint.platform})`);

  try {
    // 2. start it — returns the CDP endpoints
    const started = await api('POST', `/profiles/${profile.id}/start`);
    if (!started.wsEndpoint) {
      throw new Error('launcher returned no wsEndpoint (DevTools endpoint did not come up)');
    }
    console.log(`[demo] started, debugPort=${started.debugPort}`);

    // 3. attach. NOTE: contexts[0] is the profile's persistent context —
    //    reuse it so cookies/storage/fingerprint apply to our pages.
    const browser = await chromium.connectOverCDP(started.wsEndpoint);
    const context = browser.contexts[0];
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto('https://example.com', { timeout: 30_000 });
    console.log(`[demo] title: ${await page.title()}`);
    console.log(`[demo] user agent: ${await page.evaluate(() => navigator.userAgent)}`);

    await browser.close(); // detaches; the profile browser keeps running
  } finally {
    // 4. stop + clean up
    await api('POST', `/profiles/${profile.id}/stop`);
    await api('DELETE', `/profiles/${profile.id}`);
    console.log('[demo] stopped and deleted profile');
  }
}

main().catch((err) => {
  if (err?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err?.message ?? '')) {
    console.error(
      `[demo] cannot reach the Foxmask API at ${apiBase}.\n` +
        '        Start the Foxmask app first (npm run dev), or point FOXMASK_API_PORT\n' +
        '        at the port found in ~/.foxmask/http.port'
    );
    process.exit(1);
  }
  console.error('[demo]', err);
  process.exit(1);
});
