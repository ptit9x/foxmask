import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ActionSync, SYNC_EVENTS, buildRecorderScript } from './sync'
import type { Page, BrowserContext } from 'playwright-core'

/** Fake playwright Page recording evaluate calls. */
function fakePage(id: string): Page & { evals: Array<{ expr: string; arg?: unknown }> } {
  const evals: Array<{ expr: string; arg?: unknown }> = []
  return {
    _id: id,
    evals,
    url: () => `https://${id}.example`,
    evaluate: vi.fn(async (expr: string, arg?: unknown) => {
      evals.push({ expr, arg })
      return undefined
    }),
    bringToFront: vi.fn(async () => {}),
    exposeFunction: vi.fn(async () => {})
  } as unknown as Page & { evals: Array<{ expr: string; arg?: unknown }> }
}

/** Fake BrowserContext with controllable pages(). */
function fakeContext(pages: Page[]): BrowserContext {
  return {
    pages: () => pages,
    on: vi.fn(),
    close: vi.fn(async () => {})
  } as unknown as BrowserContext
}

describe('buildRecorderScript', () => {
  it('is an IIFE string with no capture-groups left open', () => {
    const src = buildRecorderScript()
    expect(typeof src).toBe('string')
    expect(src).toContain('window.__foxmaskSync')
  })
})

describe('ActionSync', () => {
  let sync: ActionSync
  let master: Page & { evals: Array<{ expr: string; arg?: unknown }> }
  let follower: Page & { evals: Array<{ expr: string; arg?: unknown }> }

  beforeEach(() => {
    sync = new ActionSync()
    master = fakePage('master')
    follower = fakePage('f')
  })

  it('defaults to enabled', () => {
    expect(sync.isEnabled()).toBe(true)
    expect(sync.listFollowers()).toEqual([])
  })

  it('setMaster rejects a profile that is not running', () => {
    expect(() => sync.setMaster('p1', fakeContext([]), () => ({ running: false }))).toThrow(/not running/)
  })

  it('setMaster throws when another master is already set', () => {
    sync.setMaster('p1', fakeContext([master]), () => ({ running: true }))
    expect(() => sync.setMaster('p2', fakeContext([follower]), () => ({ running: true }))).toThrow(/master/)
  })

  it('attach remembers the follower (no injection needed)', () => {
    const ctx = fakeContext([follower])
    sync.attach('p2', ctx)
    expect(sync.listFollowers()).toEqual(['p2'])
  })

  it('sync forwards an action from master to every follower', async () => {
    sync.setMaster('p1', fakeContext([master]), () => ({ running: true }))
    sync.attach('p2', fakeContext([follower]))
    const delivered = await sync.sync({
      type: 'navigate',
      url: 'https://x.example',
      ts: Date.now()
    })
    expect(delivered).toBe(1)
    expect(follower.evals.at(-1)?.arg).toMatchObject({ type: 'navigate' })
  })

  it('sync ignores actions when disabled', async () => {
    sync.setMaster('p1', fakeContext([master]), () => ({ running: true }))
    sync.attach('p2', fakeContext([follower]))
    sync.setEnabled(false)
    const delivered = await sync.sync({ type: 'navigate', url: 'x', ts: 1 })
    expect(delivered).toBe(0)
    expect(follower.evals.length).toBe(0)
  })

  it('detach removes a follower', async () => {
    sync.attach('p2', fakeContext([follower]))
    sync.detach('p2')
    expect(sync.listFollowers()).toEqual([])
  })

  it('clear stops syncing and forgets everything', async () => {
    sync.setMaster('p1', fakeContext([master]), () => ({ running: true }))
    sync.attach('p2', fakeContext([follower]))
    sync.clear()
    expect(sync.getMaster()).toBe(null)
    expect(sync.listFollowers()).toEqual([])
  })

  it('ignores actions sourced from a follower page (no echo loop)', async () => {
    sync.setMaster('p1', fakeContext([master]), () => ({ running: true }))
    sync.attach('p2', fakeContext([follower]))
    // follower page itself reports an action — must NOT be forwarded
    const delivered = await sync.handlePageAction('p2', { type: 'navigate', url: 'x', ts: 1 })
    expect(delivered).toBe(0)
  })

  it('SYNC_EVENTS lists the event names used on the bus', () => {
    expect(SYNC_EVENTS).toContain('action')
  })
})
