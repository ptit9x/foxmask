import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Profile } from '../../../main/types/profile'
import type { Fingerprint } from '../../../main/types/fingerprint'
import { ProxyField } from '../components/ProxyField'

/**
 * Profile create/edit wizard.
 *
 * Create: 4 steps — basics, fingerprint (OS + live preview + regenerate),
 * proxy, review → foxmask.profiles.create (the engine freezes the fingerprint).
 * Edit: metadata + proxy only — the fingerprint is frozen at creation by
 * design, so the fingerprint step is skipped and update() is called.
 */

const OS_OPTIONS = [
  { value: 'windows', label: '🪟 Windows' },
  { value: 'macos', label: '🍎 macOS' },
  { value: 'linux', label: '🐧 Linux' },
  { value: 'android', label: '🤖 Android' }
]

interface ProfileWizardProps {
  /** Profile being edited; null in create mode. */
  initial: Profile | null
  onClose: () => void
  onSaved: (profile: Profile) => void
}

interface BasicsForm {
  name: string
  group: string
  tags: string
  note: string
  startupUrls: string
}

function basicsFromProfile(p: Profile | null): BasicsForm {
  return {
    name: p?.name ?? '',
    group: p?.group_id ?? 'default',
    tags: p?.tags.join(', ') ?? '',
    note: p?.note ?? '',
    startupUrls: p?.startup_urls.join('\n') ?? ''
  }
}

export function ProfileWizard({ initial, onClose, onSaved }: ProfileWizardProps): React.JSX.Element {
  const editMode = initial !== null
  const steps = useMemo(
    () => (editMode ? ['Basics', 'Proxy', 'Review'] : ['Basics', 'Fingerprint', 'Proxy', 'Review']),
    [editMode]
  )
  const [stepIndex, setStepIndex] = useState(0)
  const [basics, setBasics] = useState<BasicsForm>(() => basicsFromProfile(initial))
  const [os, setOs] = useState<string>(initial?.fingerprint.os ?? 'windows')
  const [seed, setSeed] = useState<string>(() => crypto.randomUUID())
  const [preview, setPreview] = useState<Fingerprint | null>(null)
  const [proxy, setProxy] = useState(initial?.raw_proxy ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const step = steps[stepIndex]

  // Live fingerprint preview for the current os/seed (create mode only).
  useEffect(() => {
    if (editMode) return
    let cancelled = false
    window.foxmask
      .fingerprintPreview({ os, seed })
      .then((fp) => {
        if (!cancelled) setPreview(fp)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return (): void => {
      cancelled = true
    }
  }, [os, seed, editMode])

  const setField = (field: keyof BasicsForm, value: string): void => {
    setBasics((prev) => ({ ...prev, [field]: value }))
  }

  const canAdvance = (): boolean => {
    if (step === 'Basics') return basics.name.trim() !== ''
    return true
  }

  const submit = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    const shared = {
      name: basics.name.trim(),
      group_id: basics.group.trim() || 'default',
      tags: basics.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      note: basics.note,
      startup_urls: basics.startupUrls
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u !== ''),
      raw_proxy: proxy.trim()
    }
    try {
      const saved = editMode && initial
        ? await window.foxmask.profiles.update(initial.id, shared)
        : await window.foxmask.profiles.create({ ...shared, os, seed })
      if (!saved) throw new Error('profile not found')
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }, [basics, proxy, editMode, initial, os, seed, onSaved])

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wizard" role="dialog" aria-label="Profile wizard">
        <header className="modal-header">
          <h3>{editMode ? `Edit “${initial?.name}”` : 'Create profile'}</h3>
          <button type="button" className="btn ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <ol className="wizard-steps">
          {steps.map((s, i) => (
            <li key={s} className={i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}>
              {s}
            </li>
          ))}
        </ol>

        <div className="modal-body">
          {error && (
            <div role="alert" className="banner error">
              {error}
            </div>
          )}

          {step === 'Basics' && (
            <div className="form">
              <label>
                Name *
                <input
                  aria-label="Profile name"
                  className="input"
                  value={basics.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Shop Alpha"
                />
              </label>
              <label>
                Group
                <input
                  aria-label="Group"
                  className="input"
                  value={basics.group}
                  onChange={(e) => setField('group', e.target.value)}
                />
              </label>
              <label>
                Tags (comma separated)
                <input
                  aria-label="Tags"
                  className="input"
                  value={basics.tags}
                  onChange={(e) => setField('tags', e.target.value)}
                  placeholder="shop, vip"
                />
              </label>
              <label>
                Note
                <textarea
                  aria-label="Note"
                  className="input"
                  rows={2}
                  value={basics.note}
                  onChange={(e) => setField('note', e.target.value)}
                />
              </label>
              <label>
                Startup URLs (one per line)
                <textarea
                  aria-label="Startup URLs"
                  className="input"
                  rows={2}
                  value={basics.startupUrls}
                  onChange={(e) => setField('startupUrls', e.target.value)}
                  placeholder={'https://example.com'}
                />
              </label>
            </div>
          )}

          {step === 'Fingerprint' && (
            <div className="form">
              <label>
                Operating system
                <select
                  aria-label="Fingerprint OS"
                  className="input select"
                  value={os}
                  onChange={(e) => setOs(e.target.value)}
                >
                  {OS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {preview ? (
                <div className="fp-preview">
                  <div className="fp-row">
                    <span className="muted">User-Agent</span>
                    <code>{preview.userAgent}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">Screen</span>
                    <code>
                      {preview.screen.width}×{preview.screen.height}
                    </code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">GPU</span>
                    <code>{preview.webgl.renderer}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">Timezone</span>
                    <code>{preview.timezone}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">Cores / RAM</span>
                    <code>
                      {preview.hardwareConcurrency} / {preview.deviceMemory}GB
                    </code>
                  </div>
                </div>
              ) : (
                <p className="muted">Generating preview…</p>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSeed(crypto.randomUUID())}
              >
                ↻ Regenerate
              </button>
            </div>
          )}

          {step === 'Proxy' && <ProxyField value={proxy} onChange={setProxy} />}

          {step === 'Review' && (
            <div className="review">
              <div className="fp-row">
                <span className="muted">Name</span>
                <strong>{basics.name.trim()}</strong>
              </div>
              <div className="fp-row">
                <span className="muted">Group</span>
                <span>{basics.group.trim() || 'default'}</span>
              </div>
              <div className="fp-row">
                <span className="muted">Tags</span>
                <span>
                  {basics.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter((t) => t !== '')
                    .join(', ') || '—'}
                </span>
              </div>
              {preview && (
                <div className="fp-row">
                  <span className="muted">Fingerprint</span>
                  <code>{preview.userAgent}</code>
                </div>
              )}
              {editMode && initial && (
                <div className="fp-row">
                  <span className="muted">Fingerprint</span>
                  <code>{initial.fingerprint.userAgent}</code>
                </div>
              )}
              <div className="fp-row">
                <span className="muted">Proxy</span>
                <code>{proxy.trim() || 'direct'}</code>
              </div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <div className="spacer" />
          {stepIndex > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              ‹ Back
            </button>
          )}
          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              className="btn primary"
              disabled={!canAdvance()}
              onClick={() => setStepIndex((i) => i + 1)}
            >
              Next ›
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={submitting || basics.name.trim() === ''}
              onClick={() => void submit()}
            >
              {submitting ? 'Saving…' : editMode ? 'Save changes' : 'Create profile'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
