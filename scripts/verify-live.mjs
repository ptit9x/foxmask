#!/usr/bin/env node
/**
 * Live verification of selection-driven sync UI + window tiling against the
 * packaged app. Run with the app already up:
 *   release/linux-unpacked/foxmask --no-sandbox --disable-gpu --remote-debugging-port=9333
 * Usage: node scripts/verify-live.mjs
 */
import { chromium } from 'playwright-core';

const CDP = 'http://127.0.0.1:9333';
const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const app = await chromium.connectOverCDP(CDP);
const ctx = app.contexts()[0];
const page = ctx.pages().find(p => p.url().startsWith('file://')) || ctx.pages()[0];
await page.waitForLoadState('domcontentloaded');

try {
  // ---------- 0. clean leftovers from any earlier crashed run ----------
  const pre = await page.evaluate(() => window.foxmask.profiles.list({ search: 'TILE-' }));
  for (const p of pre.rows) {
    await page.evaluate((i) => window.foxmask.profiles.stop(i).catch(() => {}), p.id);
    await page.evaluate((i) => window.foxmask.profiles.delete(i), p.id);
  }
  await page.waitForTimeout(2000);
  // Reload so the table cannot show rows deleted behind the UI's back.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // ---------- 1. create 3 fresh profiles (unique per run) ----------
  const tag = `TILE-${Date.now() % 100000}`;
  const made = [];
  for (let i = 1; i <= 3; i++) {
    const p = await page.evaluate(([n, tg]) => window.foxmask.profiles.create({
      name: `${tg}-${n}`,
      group: 'tile-verify',
      notes: 'auto cleanup',
      proxy: null
    }), [i, tag]);
    made.push(p);
  }
  ok('created 3 test profiles', made.length === 3 && made.every(p => p && p.id));
  const ids = made.map(p => p.id);

  // ---------- 2. start all 3 → expect 3 tiled windows ----------
  for (const id of ids) await page.evaluate((i) => window.foxmask.profiles.start(i), id);
  await page.waitForTimeout(9000); // chromium spin-up + tile
  const st = {};
  for (const id of ids) st[id] = await page.evaluate((i) => window.foxmask.profiles.status(i), id);
  ok('all 3 profiles running', ids.every(id => st[id].running),
     ids.map(id => `${st[id].running}`).join(','));
  const httpOf = (s) => {
    const m = /ws:\/\/([\d.]+):(\d+)/.exec(s.wsEndpoint || '');
    return m ? `http://${m[1]}:${m[2]}` : null;
  };
  const eps = ids.map(id => httpOf(st[id]));
  ok('cdp endpoints present', eps.every(Boolean), JSON.stringify(eps));

  // query real window bounds from each profile browser via CDP
  async function winBounds(debugUrl) {
    const b = await chromium.connectOverCDP(debugUrl);
    const sess = await b.contexts()[0]?.newCDPSession(b.contexts()[0]?.pages()[0]);
    const t = await sess.send('Browser.getWindowForTarget');
    const r = await sess.send('Browser.getWindowBounds', { windowId: t.windowId });
    // never browser.close() a connectOverCDP handle — it kills the real browser
    return r.bounds;
  }

  const bs = [];
  for (const id of ids) bs.push(await winBounds(eps[ids.indexOf(id)]));
  console.log('bounds:', JSON.stringify(bs));
  // launcher grid: gap=16, top=40, work 1920x1040, cols=min(3,n)
  const gap = 16, top = 40;
  const cellW = Math.floor((1920 - gap * 4) / 3), cellH = Math.floor((1040 - top - gap * 2));
  bs.forEach((b, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const ex = gap + col * (cellW + gap), ey = top + gap + row * (cellH + gap);
    const match = b.left === ex && b.top === ey && b.width === cellW && b.height === cellH;
    ok(`window ${i} at grid slot`, match, `got ${b.left},${b.top} ${b.width}x${b.height} want ${ex},${ey} ${cellW}x${cellH}`);
  });

  const overlap = bs.some((a, i) => bs.some((c, j) => i < j &&
    a.left < c.left + c.width && c.left < a.left + a.width &&
    a.top < c.top + c.height && c.top < a.top + a.height));
  ok('no window overlaps', !overlap);

  // ---------- 3. checkbox + select-all UI ----------
  await page.fill('input.search', tag);
  await page.waitForTimeout(900); // 300ms debounce + fetch + status loop
  const rowCount = await page.locator('table tbody tr').count();
  ok('search filters to 3 test rows', rowCount === 3, `rows=${rowCount}`);

  const first = page.getByRole('checkbox', { name: new RegExp(`Select ${tag}-1|Chọn ${tag}-1`) });
  await first.check();
  ok('row checkbox checks', await first.isChecked());
  ok('badge shows count 1', (await page.getByText(/1 selected|Đã chọn 1/).count()) === 1);
  const selQ = 'select[aria-label="Sync master profile"] option, select[aria-label="Hồ sơ gốc đồng bộ"] option';
  const opts1 = await page.locator(selQ).allTextContents();
  // selection={1}, all running → candidates must be exactly TILE-1
  ok('master dropdown = selected ∩ running (single)', opts1.length === 2 && opts1[1] === `${tag}-1`, JSON.stringify(opts1));

  await page.getByRole('checkbox', { name: /Select all profiles|Chọn tất cả hồ sơ/ }).check();
  ok('select-all checks every row', await page.locator('table tbody tr input[type=checkbox]:checked').count() === 3);
  ok('badge shows count 3', (await page.getByText(/3 selected|Đã chọn 3/).count()) === 1);

  await page.getByRole('checkbox', { name: new RegExp(`Select ${tag}-2|Chọn ${tag}-2`) }).uncheck();
  const indet = await page.evaluate(() => {
    const el = document.querySelector('thead input[type=checkbox]');
    return el ? el.indeterminate : null;
  });
  ok('header checkbox indeterminate after partial select', indet === true, `indeterminate=${indet}`);
  ok('badge shows count 2', (await page.getByText(/2 selected|Đã chọn 2/).count()) === 1);

  // master dropdown offers selected+running only: TILE-1 & TILE-3 (2 unchecked)
  const opts = await page.locator(selQ).allTextContents();
  ok('master dropdown lists selected+running only',
     opts.includes(`${tag}-1`) && opts.includes(`${tag}-3`) && !opts.includes(`${tag}-2`),
     JSON.stringify(opts));

  await page.getByRole('button', { name: /Clear selection|Bỏ chọn/ }).click();
  ok('clear-selection empties checkboxes', await page.locator('table tbody tr input[type=checkbox]:checked').count() === 0);

  // ---------- 4. re-tile after stop ----------
  await page.evaluate((i) => window.foxmask.profiles.stop(i), ids[0]);
  await page.waitForTimeout(4000);
  const bs2 = [];
  for (let k = 1; k <= 2; k++) {
    const s2 = await page.evaluate((i) => window.foxmask.profiles.status(i), ids[k]);
    if (!s2.running) { ok(`profile ${k} still running after stop #1`, false, JSON.stringify(s2)); continue; }
    bs2.push(await winBounds(httpOf(s2)));
  }
  console.log('bounds after stop:', JSON.stringify(bs2));
  const cellW2 = Math.floor((1920 - gap * 3) / 2), cellH2 = Math.floor((1040 - top - gap * 2));
  bs2.forEach((b, i) => {
    const ex = gap + i * (cellW2 + gap), ey = top + gap;
    const match = b.left === ex && b.top === ey && b.width === cellW2 && b.height === cellH2;
    ok(`re-tile window ${i} (2-col grid)`, match, `got ${b.left},${b.top} ${b.width}x${b.height} want ${ex},${ey} ${cellW2}x${cellH2}`);
  });

  // ---------- 5. cleanup ----------
  for (let k = 1; k <= 2; k++) await page.evaluate((i) => window.foxmask.profiles.stop(i), ids[k]);
  await page.waitForTimeout(3000);
  for (const id of ids) await page.evaluate((i) => window.foxmask.profiles.delete(i), id);
  const rest = await page.evaluate((tg) => window.foxmask.profiles.list({ search: tg }), tag);
  ok('test profiles cleaned up', rest.rows.length === 0, `left=${rest.rows.length}`);
  await page.fill('input.search', '');
  await page.waitForTimeout(500);
} catch (err) {
  console.error('SCRIPT ERROR:', err);
} finally {
  console.log('--- SUMMARY', `${results.filter(r => r.pass).length}/${results.length}`, 'PASS');
  process.exit(0); // drop CDP connections without killing the app
}
