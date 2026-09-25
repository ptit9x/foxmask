import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfoResult,
  CreateProfileRequest,
  ProfileListResult
} from '../main/ipc/handlers'
import type { Fingerprint } from '../main/types/fingerprint'
import type { AppSettings } from '../main/settings/settings'
import type { ExportEnvelope, ImportOutcome } from '../main/transfer/transfer'
import type { ListProfilesOptions } from '../main/db/profiles'
import type { UpdateProfileInput } from '../main/db/profiles'
import type { LaunchResult } from '../main/launcher/launch'
import type { LauncherStatus } from '../main/api/server'
import type { ProxyCheckResult } from '../main/proxy/check'
import type { Profile } from '../main/types/profile'
import type { SyncAction } from '../main/sync/sync'

/**
 * Renderer-facing API exposed as window.foxmask. Mirrors the IPC channels
 * registered by src/main/ipc/handlers.ts one to one; every method is an
 * ipcRenderer.invoke round-trip (request/response, promise-based).
 */
export interface FoxmaskApi {
  profiles: {
    list(opts?: ListProfilesOptions): Promise<ProfileListResult>
    get(id: string): Promise<Profile | null>
    create(input: CreateProfileRequest): Promise<Profile>
    update(id: string, patch: UpdateProfileInput): Promise<Profile | null>
    delete(id: string): Promise<{ deleted: boolean }>
    duplicate(id: string): Promise<Profile>
    start(id: string): Promise<LaunchResult>
    stop(id: string): Promise<{ stopped: boolean }>
    status(id: string): Promise<LauncherStatus>
    export(): Promise<ExportEnvelope>
    import(text: string): Promise<ImportOutcome>
  }
  proxies: {
    check(raw: string): Promise<ProxyCheckResult>
  }
  /** Preview a deterministic fingerprint without creating a profile. */
  fingerprintPreview(input: { os?: string; seed?: string }): Promise<Fingerprint>
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  sync: {
    /** Start mirroring: actions in masterId are replayed in followerIds. */
    start(masterId: string, followerIds: string[]): Promise<{ master: string; followers: string[] }>
    stop(): Promise<{ stopped: boolean }>
    status(): Promise<{ enabled: boolean; master: string | null; followers: string[] }>
    /** Inject one action into every follower (programmatic replay). */
    action(action: SyncAction): Promise<{ delivered: number }>
  }
  appInfo(): Promise<AppInfoResult>
}

const api: FoxmaskApi = {
  profiles: {
    list: (opts) => ipcRenderer.invoke('profiles:list', opts),
    get: (id) => ipcRenderer.invoke('profiles:get', id),
    create: (input) => ipcRenderer.invoke('profiles:create', input),
    update: (id, patch) => ipcRenderer.invoke('profiles:update', id, patch),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id),
    duplicate: (id) => ipcRenderer.invoke('profiles:duplicate', id),
    start: (id) => ipcRenderer.invoke('profiles:start', id),
    stop: (id) => ipcRenderer.invoke('profiles:stop', id),
    status: (id) => ipcRenderer.invoke('profiles:status', id),
    export: () => ipcRenderer.invoke('profiles:export'),
    import: (text) => ipcRenderer.invoke('profiles:import', text)
  },
  proxies: {
    check: (raw) => ipcRenderer.invoke('proxies:check', raw)
  },
  fingerprintPreview: (input) => ipcRenderer.invoke('fingerprints:preview', input),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  sync: {
    start: (masterId, followerIds) => ipcRenderer.invoke('sync:start', masterId, followerIds),
    stop: () => ipcRenderer.invoke('sync:stop'),
    status: () => ipcRenderer.invoke('sync:status'),
    action: (action) => ipcRenderer.invoke('sync:action', action)
  },
  appInfo: () => ipcRenderer.invoke('app:info')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('foxmask', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Non-isolated fallback (dev only): assign directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).foxmask = api
}
