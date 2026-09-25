// Dev harness: boots API+launcher in plain Node with a tmp FOXMASK_HOME so
// examples can be exercised without the Electron app. Not shipped.
process.env.FOXMASK_HOME = '/tmp/foxmask-api-home';
const { openDb, closeDb } = await import('../src/main/db/db.ts');
const { Launcher } = await import('../src/main/launcher/launch.ts');
const { startApiServer } = await import('../src/main/api/server.ts');
const { checkProxy } = await import('../src/main/proxy/check.ts');
const { chromium } = await import('playwright-core');
const fs = await import('node:fs');

let execPath;
try { execPath = chromium.executablePath(); } catch { execPath = undefined; }
if (typeof execPath === 'string' && execPath && fs.existsSync(execPath)) {
  console.log('[harness] chromium:', execPath);
} else {
  execPath = undefined;
  console.log('[harness] no dev chromium, launcher will use default channel');
}

fs.mkdirSync(process.env.FOXMASK_HOME, { recursive: true });
const db = openDb(`${process.env.FOXMASK_HOME}/foxmask.db`);
const launcher = new Launcher({ headless: true, executablePath: execPath });
const { port, close } = await startApiServer({ db, launcher, checkProxy });
console.log(`[harness] api on 127.0.0.1:${port}`);
process.on('SIGINT', async () => { await close(); closeDb(db); process.exit(0); });
setInterval(() => {}, 1 << 30);
