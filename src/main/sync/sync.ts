import type { BrowserContext, Page } from 'playwright-core'
import { EventEmitter } from 'node:events'

/**
 * Action Sync — replicate manual actions from a master profile to every
 * attached follower profile in real time.
 *
 * The master browser gets a recorder script injected that listens for real
 * user input (click, key, scroll, navigation) and posts each action to the
 * app over an exposed binding. The app fans the action out to each follower
 * browser, replaying it through the page's own event system (synthetic
 * trusted-looking events) so the site sees the same interaction.
 *
 * This module never imports 'electron' — it runs in plain Node/vitest.
 */

/** Action types the recorder understands and can replay. */
export type SyncActionType = 'click' | 'key' | 'scroll' | 'navigate'

/** Runtime set of action types (validation for API + IPC payloads). */
export const SYNC_ACTION_TYPES: ReadonlySet<string> = new Set<SyncActionType>([
  'click',
  'key',
  'scroll',
  'navigate'
])

/** One captured user action on the master page. */
export interface SyncAction {
  type: SyncActionType
  /** click: CSS path of the element; key: the key; navigate: the URL. */
  target?: string
  /** navigate URL. */
  url?: string
  /** key: key + code + modifiers. */
  key?: string
  code?: string
  /** Modifiers at event time. */
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  /** click coordinates relative to the viewport. */
  x?: number
  y?: number
  /** scroll delta. */
  deltaX?: number
  deltaY?: number
  /** Monotonic capture timestamp. */
  ts: number
}

/** Attached follower, by profileId. */
interface Follower {
  profileId: string
  context: BrowserContext
}

/** Event names used on the sync EventEmitter. */
export const SYNC_EVENTS = ['action', 'follower-error'] as const

/**
 * Recorder script injected into the master browser's pages. Runs before any
 * site script on every navigation, listens for real user input, and posts
 * actions via the __foxmaskSyncPost binding (exposed by ActionSync).
 */
export function buildRecorderScript(): string {
  return `(() => {
  if (window.__foxmaskSync) return;
  const post = (a) => { try { window.__foxmaskSyncPost && window.__foxmaskSyncPost(JSON.stringify(a)); } catch (e) {} };
  const cssPath = (el) => {
    if (!(el instanceof Element)) return '';
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 8) {
      let s = n.nodeName.toLowerCase();
      if (n.id) { s += '#' + n.id; parts.unshift(s); break; }
      const sib = n.parentNode ? Array.prototype.filter.call(n.parentNode.children, (c) => c.nodeName === n.nodeName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (Array.prototype.indexOf.call(sib, n) + 1) + ')';
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  window.__foxmaskSync = true;
  document.addEventListener('click', (e) => {
    post({ type: 'click', target: cssPath(e.target), x: e.clientX, y: e.clientY, ts: Date.now() });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    post({ type: 'key', key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, ts: Date.now() });
  }, true);
  let navTimer = null;
  const nav = () => {
    clearTimeout(navTimer);
    navTimer = setTimeout(() => post({ type: 'navigate', url: location.href, ts: Date.now() }), 150);
  };
  window.addEventListener('popstate', nav);
})();`
}

/** Replayer expression run in each follower page via page.evaluate. */
const REPLAYER = `(a) => {
  const fireKey = (target, a) => {
    const k = { key: a.key, code: a.code, bubbles: true, cancelable: true, ctrlKey: !!a.ctrl, altKey: !!a.alt, shiftKey: !!a.shift, metaKey: !!a.meta };
    target.dispatchEvent(new KeyboardEvent('keydown', k));
    target.dispatchEvent(new KeyboardEvent('keyup', k));
    const editable = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (editable) {
      if (a.key !== null && a.key !== undefined && a.key.length === 1) {
        const proto = Object.getPrototypeOf(target);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(target, target.value + a.key);
        else target.value = target.value + a.key;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (a.key === 'Backspace') {
        const proto = Object.getPrototypeOf(target);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(target, target.value.slice(0, -1));
        else target.value = target.value.slice(0, -1);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };
  if (a.type === 'navigate') { if (location.href !== a.url) location.href = a.url; return; }
  if (a.type === 'click') {
    let el = a.target ? document.querySelector(a.target) : null;
    if (!el) el = document.elementFromPoint(a.x || 0, a.y || 0);
    if (el) {
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: window, clientX: a.x != null ? a.x : r.left, clientY: a.y != null ? a.y : r.top, ctrlKey: !!a.ctrl, altKey: !!a.alt, shiftKey: !!a.shift, metaKey: !!a.meta };
      el.dispatchEvent(new MouseEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    }
    return;
  }
  if (a.type === 'key') { fireKey(document.activeElement || document.body, a); return; }
  if (a.type === 'scroll') { window.scrollTo(a.deltaX || 0, a.deltaY || 0); return; }
}`

/**
 * Core sync engine (no Electron imports). The app wires the master binding to
 * handlePageAction; the UI listens on .bus for 'action' / 'follower-error'.
 */
export class ActionSync {
  private readonly events = new EventEmitter()
  private master: { profileId: string; context: BrowserContext } | null = null
  private readonly followers = new Map<string, Follower>()
  private enabled = true

  /** Underlying emitter for wiring in the UI layer. */
  readonly bus = this.events

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(v: boolean): void {
    this.enabled = v
  }

  /** Current master profileId, or null. */
  getMaster(): string | null {
    return this.master?.profileId ?? null
  }

  /**
   * Designate the master. Injects the recorder into every existing page and
   * every page the context opens later. getStatus enforces running-only.
   */
  setMaster(
    profileId: string,
    context: BrowserContext,
    getStatus: (id: string) => { running: boolean } | 'not running'
  ): void {
    if (this.master) throw new Error('a master is already set — clear() first')
    const st = getStatus(profileId)
    const running = typeof st === 'object' && st.running
    if (!running) throw new Error(`profile ${profileId} is not running`)
    this.master = { profileId, context }
    void this.injectRecorder(context)
    context.on('page', (page) => {
      void this.injectRecorderIntoPage(page)
    })
  }

  /** Attach a follower: it will receive every action the master performs. */
  attach(profileId: string, context: BrowserContext): void {
    if (this.master && this.master.profileId === profileId) {
      throw new Error('cannot attach the master as a follower')
    }
    this.followers.set(profileId, { profileId, context })
  }

  /** Stop mirroring one follower. */
  detach(profileId: string): boolean {
    return this.followers.delete(profileId)
  }

  /** Attached follower ids (insertion order). */
  listFollowers(): string[] {
    return [...this.followers.keys()]
  }

  /** Full teardown: master + followers forgotten. */
  clear(): void {
    this.master = null
    this.followers.clear()
  }

  /**
   * Fan an action out to every follower page. Returns the number of pages
   * the action was delivered to.
   */
  async sync(action: SyncAction): Promise<number> {
    if (!this.enabled) return 0
    this.events.emit('action', action)
    let delivered = 0
    for (const f of this.followers.values()) {
      const pages = safePages(f.context)
      for (const page of pages) {
        try {
          await page.evaluate(REPLAYER, action)
          delivered++
        } catch (err) {
          this.events.emit('follower-error', f.profileId, err)
        }
      }
    }
    return delivered
  }

  /**
   * Entry point for the master page's exposed binding. Guards against echo:
   * actions reported by a non-master page are ignored.
   */
  async handlePageAction(profileId: string, action: SyncAction): Promise<number> {
    if (!this.master || this.master.profileId !== profileId) return 0
    return this.sync(action)
  }

  /** Inject the recorder into every existing page. */
  private async injectRecorder(context: BrowserContext): Promise<void> {
    for (const page of safePages(context)) {
      await this.injectRecorderIntoPage(page)
    }
  }

  /** Expose the binding, then evaluate the recorder now. */
  private async injectRecorderIntoPage(page: Page): Promise<void> {
    try {
      await page.exposeFunction('__foxmaskSyncPost', (payload: string) => {
        try {
          const action = JSON.parse(payload) as SyncAction
          void this.handlePageAction(this.master?.profileId ?? '', action)
        } catch {
          // malformed payload from the page — ignore
        }
      })
      await page.evaluate(buildRecorderScript())
    } catch {
      // page navigated/closed mid-injection — non-fatal
    }
  }
}

/** context.pages() guarded against closed contexts. */
function safePages(context: BrowserContext): Page[] {
  try {
    return context.pages()
  } catch {
    return []
  }
}
