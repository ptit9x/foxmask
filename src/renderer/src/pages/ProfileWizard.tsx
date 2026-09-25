import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Profile } from '../../../main/types/profile'
import type { Fingerprint } from '../../../main/types/fingerprint'
import { ProxyField } from '../components/ProxyField'
import { Tip } from '../components/Tip'
import { useI18n } from '../i18n'

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
  const { t } = useI18n()
  const editMode = initial !== null
  const stepKeys = useMemo(
    () =>
      editMode
        ? (['wizard.step.basics', 'wizard.step.proxy', 'wizard.step.review'] as const)
        : (['wizard.step.basics', 'wizard.step.fingerprint', 'wizard.step.proxy', 'wizard.step.review'] as const),
    [editMode]
  )
  const steps = stepKeys.map((k) => t(k))
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
    if (stepIndex === 0) return basics.name.trim() !== ''
    return true
  }

  const submit = useCallback(
    async (): Promise<void> => {
      setSubmitting(true)
      setError(null)
      const shared = {
        name: basics.name.trim(),
        group_id: basics.group.trim() || 'default',
        tags: basics.tags
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x !== ''),
        note: basics.note,
        startup_urls: basics.startupUrls
          .split('\n')
          .map((u) => u.trim())
          .filter((u) => u !== ''),
        raw_proxy: proxy.trim()
      }
      try {
        const saved =
          editMode && initial
            ? await window.foxmask.profiles.update(initial.id, shared)
            : await window.foxmask.profiles.create({ ...shared, os, seed })
        if (!saved) throw new Error(t('wizard.notFound'))
        onSaved(saved)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setSubmitting(false)
      }
    },
    [basics, proxy, editMode, initial, os, seed, onSaved, t]
  )

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wizard" role="dialog" aria-label={t('wizard.title.create')}>
        <header className="modal-header">
          <h3>
            {editMode ? t('wizard.title.edit', { name: initial?.name ?? '' }) : t('wizard.title.create')}
          </h3>
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

          {step === t('wizard.step.basics') && (
            <div className="form">
              <Tip tipKey="tip.wizard.basics" />
              <label>
                {t('wizard.name')}
                <input
                  aria-label={t('wizard.name')}
                  className="input"
                  value={basics.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder={t('wizard.namePlaceholder')}
                />
              </label>
              <label>
                {t('wizard.group')}
                <input
                  aria-label={t('wizard.group')}
                  className="input"
                  value={basics.group}
                  onChange={(e) => setField('group', e.target.value)}
                />
              </label>
              <label>
                {t('wizard.tags')}
                <input
                  aria-label={t('wizard.tags')}
                  className="input"
                  value={basics.tags}
                  onChange={(e) => setField('tags', e.target.value)}
                  placeholder={t('wizard.tagsPlaceholder')}
                />
              </label>
              <label>
                {t('wizard.note')}
                <textarea
                  aria-label={t('wizard.note')}
                  className="input"
                  rows={2}
                  value={basics.note}
                  onChange={(e) => setField('note', e.target.value)}
                />
              </label>
              <label>
                {t('wizard.startupUrls')}
                <textarea
                  aria-label={t('wizard.startupUrls')}
                  className="input"
                  rows={2}
                  value={basics.startupUrls}
                  onChange={(e) => setField('startupUrls', e.target.value)}
                  placeholder={'https://example.com'}
                />
              </label>
            </div>
          )}

          {step === t('wizard.step.fingerprint') && (
            <div className="form">
              <Tip tipKey="tip.wizard.fingerprint" />
              <label>
                {t('wizard.os')}
                <select
                  aria-label={t('wizard.os')}
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
                    <span className="muted">{t('wizard.ua')}</span>
                    <code>{preview.userAgent}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">{t('wizard.screen')}</span>
                    <code>
                      {preview.screen.width}×{preview.screen.height}
                    </code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">{t('wizard.gpu')}</span>
                    <code>{preview.webgl.renderer}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">{t('wizard.timezone')}</span>
                    <code>{preview.timezone}</code>
                  </div>
                  <div className="fp-row">
                    <span className="muted">{t('wizard.cores')}</span>
                    <code>
                      {preview.hardwareConcurrency} / {preview.deviceMemory}GB
                    </code>
                  </div>
                </div>
              ) : (
                <p className="muted">{t('wizard.previewWaiting')}</p>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSeed(crypto.randomUUID())}
              >
                {t('wizard.regenerate')}
              </button>
            </div>
          )}

          {step === t('wizard.step.proxy') && (
            <div className="form">
              <Tip tipKey="tip.wizard.proxy" />
              <ProxyField value={proxy} onChange={setProxy} />
            </div>
          )}

          {step === t('wizard.step.review') && (
            <div className="review">
              <div className="fp-row">
                <span className="muted">{t('table.name')}</span>
                <strong>{basics.name.trim()}</strong>
              </div>
              <div className="fp-row">
                <span className="muted">{t('table.group')}</span>
                <span>{basics.group.trim() || 'default'}</span>
              </div>
              <div className="fp-row">
                <span className="muted">{t('table.tags')}</span>
                <span>
                  {basics.tags
                    .split(',')
                    .map((x) => x.trim())
                    .filter((x) => x !== '')
                    .join(', ') || '—'}
                </span>
              </div>
              {preview && (
                <div className="fp-row">
                  <span className="muted">{t('wizard.reviewFingerprint')}</span>
                  <code>{preview.userAgent}</code>
                </div>
              )}
              {editMode && initial && (
                <div className="fp-row">
                  <span className="muted">{t('wizard.reviewFingerprint')}</span>
                  <code>{initial.fingerprint.userAgent}</code>
                </div>
              )}
              <div className="fp-row">
                <span className="muted">{t('wizard.reviewProxy')}</span>
                <code>{proxy.trim() || t('table.direct')}</code>
              </div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('wizard.cancel')}
          </button>
          <div className="spacer" />
          {stepIndex > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              {t('wizard.back')}
            </button>
          )}
          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              className="btn primary"
              disabled={!canAdvance()}
              onClick={() => setStepIndex((i) => i + 1)}
            >
              {t('wizard.next')}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={submitting || basics.name.trim() === ''}
              onClick={() => void submit()}
            >
              {submitting
                ? t('wizard.saving')
                : editMode
                  ? t('wizard.save')
                  : t('wizard.create')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
