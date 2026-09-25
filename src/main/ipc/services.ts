import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { closeDb as defaultCloseDb, openDb as defaultOpenDb } from '../db/db';
import { launcher as defaultLauncher, resolveDataDir } from '../launcher/launch';
import { startApiServer as defaultStartApiServer, type ApiDeps, type LauncherLike } from '../api/server';
import { checkProxy as defaultCheckProxy } from '../proxy/check';
import { ActionSync } from '../sync/sync';

/**
 * Main-process service container (db + launcher + local API server).
 *
 * Plain Node module — must never import 'electron' so it stays testable in
 * vitest. src/main/index.ts calls getServices() on app ready and
 * disposeServices() on will-quit. All factory dependencies are injectable,
 * mirroring api/server.ts's DI style.
 */

/** Default API port (mirrors api/server.ts DEFAULT_PORT). */
export const DEFAULT_API_PORT = 35000;

/** Injected proxy checker (src/main/proxy/check.ts or a test stub). */
export type CheckProxyFn = ApiDeps['checkProxy'];

/** Structural slice of Launcher the IPC layer needs; test fakes satisfy it. */
export type LauncherService = LauncherLike;

/** Factory dependencies; every default is the real engine module. */
export interface ServicesDeps {
  openDb?: typeof defaultOpenDb;
  closeDb?: typeof defaultCloseDb;
  launcher?: LauncherService;
  startApiServer?: typeof defaultStartApiServer;
  checkProxy?: CheckProxyFn;
  /** Preferred API port; the actually bound port may differ (EADDRINUSE fallback). */
  apiPort?: number;
}

/** The wired app services consumed by the IPC handlers. */
export interface AppServices {
  db: DatabaseSync;
  launcher: LauncherService;
  /** Port the local API server actually bound (may differ from the default). */
  apiPort: number;
  /** Root data dir (~/.foxmask or FOXMASK_HOME) the db lives in. */
  dataDir: string;
  /** Action-sync engine shared by IPC and the API server. */
  sync: ActionSync;
  /** Shut the API server and the db down. Safe to call once; never when uninitialized. */
  dispose: () => Promise<void>;
}

/**
 * Build an AppServices instance from (possibly overridden) factory deps:
 * resolve the data dir, open <dataDir>/foxmask.db, start the API server and
 * capture the port it actually bound. Returns the container plus dispose().
 */
export async function createServices(deps: ServicesDeps = {}): Promise<AppServices> {
  const openDb = deps.openDb ?? defaultOpenDb;
  const closeDbDep = deps.closeDb ?? defaultCloseDb;
  const launcher = deps.launcher ?? defaultLauncher;
  const startApiServer = deps.startApiServer ?? defaultStartApiServer;
  const checkProxy = deps.checkProxy ?? defaultCheckProxy;

  const dataDir = resolveDataDir();
  const db = openDb(path.join(dataDir, 'foxmask.db'));

  const server = await startApiServer({ db, launcher, checkProxy }, deps.apiPort ?? DEFAULT_API_PORT);

  let disposed = false;
  return {
    db,
    launcher,
    sync: new ActionSync(),
    apiPort: server.port,
    dataDir,
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      // Close the server first (in-flight requests touch the db), then the db.
      // Server-close errors must not skip the db close, so collect and rethrow.
      let error: unknown;
      try {
        await server.close();
      } catch (err) {
        error = err;
      }
      try {
        closeDbDep(db);
      } catch (err) {
        error = err;
      }
      if (error !== undefined) throw error;
    }
  };
}

/** Resolved singleton; null until the first getServices() completes. */
let instance: AppServices | null = null;
/** Guard so concurrent first calls share one initialization. */
let pending: Promise<AppServices> | null = null;

/**
 * Lazily build (once) and return the app services. Factory overrides are only
 * honored on the very first call — later calls get the same instance until
 * disposeServices() resets it.
 */
export function getServices(deps: ServicesDeps = {}): Promise<AppServices> {
  if (instance) return Promise.resolve(instance);
  pending ??= createServices(deps)
    .then((s) => {
      instance = s;
      return s;
    })
    .catch((err: unknown) => {
      // Let the next call retry instead of caching a rejected promise forever.
      pending = null;
      throw err;
    });
  return pending;
}

/**
 * Dispose the singleton and clear it so a later getServices() can rebuild.
 * Safe when never initialized.
 */
export async function disposeServices(): Promise<void> {
  const current = instance;
  instance = null;
  pending = null;
  if (!current) return;
  await current.dispose();
}
