import { vi } from 'vitest'
import type { FoxmaskApi } from '../../../preload/index'
import type { Profile } from '../../../main/types/profile'
import type { Fingerprint } from '../../../main/types/fingerprint'

/**
 * Controllable window.foxmask fake for renderer tests.
 *
 * install() resets every mock and applies sensible defaults (two profiles,
 * stopped statuses, test app info) so each test starts from a known state;
 * individual tests then override what they care about.
 */

/** Minimal-but-typed fixture profile factory. */
export function fixtureProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Shop Alpha',
    group_id: 'ecom',
    tags: ['shop', 'vip'],
    note: '',
    startup_urls: [],
    raw_proxy: 'socks5://user:pass@1.2.3.4:1080',
    fingerprint: {
      os: 'windows',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
      platform: 'Win32',
      screen: { width: 1920, height: 1080, availHeight: 1040, devicePixelRatio: 1 },
      hardwareConcurrency: 8,
      deviceMemory: 8,
      languages: ['en-US', 'en'],
      timezone: 'Asia/Ho_Chi_Minh',
      geoip: null,
      canvas: 'noise',
      webgl: { mode: 'noise', vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, RTX 2060)' },
      audio: 'noise',
      webRtc: { mode: 'based-on-ip', publicIp: null },
      fonts: ['Segoe UI', 'Calibri'],
      doNotTrack: null,
      touchPoints: 0
    } as unknown as Fingerprint,
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
    ...overrides
  }
}

export function createFoxmaskMock(): {
  api: FoxmaskApi
  install: () => void
} {
  const fns = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    duplicate: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(),
    check: vi.fn(),
    fingerprintPreview: vi.fn(),
    settingsGet: vi.fn(),
    settingsSet: vi.fn(),
    appInfo: vi.fn()
  }

  const api = {
    profiles: {
      list: fns.list,
      get: fns.get,
      create: fns.create,
      update: fns.update,
      delete: fns.delete,
      duplicate: fns.duplicate,
      start: fns.start,
      stop: fns.stop,
      status: fns.status
    },
    proxies: { check: fns.check },
    fingerprintPreview: fns.fingerprintPreview,
    settings: { get: fns.settingsGet, set: fns.settingsSet },
    appInfo: fns.appInfo
  } as unknown as FoxmaskApi

  const defaults = (): void => {
    fns.fingerprintPreview.mockImplementation(({ os }: { os?: string }) =>
      Promise.resolve({
        ...fixtureProfile().fingerprint,
        userAgent: `Mozilla/5.0 (${os ?? 'windows'} preview UA)`
      } as never)
    )
    const alpha = fixtureProfile()
    const beta = fixtureProfile({
      id: 'p2',
      name: 'Solo Beta',
      group_id: 'solo',
      tags: [],
      raw_proxy: '',
      fingerprint: {
        os: 'macos',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel'
      } as unknown as Fingerprint
    })
    fns.list.mockResolvedValue({ rows: [alpha, beta], total: 2, last_page: 1 })
    fns.status.mockResolvedValue({
      running: false,
      wsEndpoint: null,
      debugPort: null,
      startedAt: null
    })
    fns.settingsGet.mockResolvedValue({
      apiPort: 35000,
      dataDir: '',
      chromiumPath: '',
      launchAtLogin: false
    })
    fns.settingsSet.mockImplementation(async (patch: Record<string, unknown>) => ({
      apiPort: 35000,
      dataDir: '',
      chromiumPath: '',
      launchAtLogin: false,
      ...patch
    }))
    fns.appInfo.mockResolvedValue({
      version: '0.1.0-test',
      apiPort: 35000,
      dataDir: '/tmp/foxmask-test'
    })
    fns.delete.mockResolvedValue({ deleted: true })
    fns.stop.mockResolvedValue({ stopped: true })
    fns.duplicate.mockResolvedValue(fixtureProfile({ id: 'p3', name: 'Shop Alpha (copy)' }))
  }

  const install = (): void => {
    for (const fn of Object.values(fns)) fn.mockReset()
    defaults()
    // The renderer reads the bridge off the global window object.
    ;(window as unknown as { foxmask: FoxmaskApi }).foxmask = api
  }

  return { api, install }
}
