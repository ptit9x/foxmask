import { useState } from 'react'
import { Tip } from '../components/Tip'
import { useI18n } from '../i18n'

/**
 * Bulk-create dialog: N profiles sharing group/OS/proxy, each with a distinct
 * random seed (unique fingerprints), named '<prefix> #k'.
 */

const OS_OPTIONS = [
  { value: 'windows', label: '🪟 Windows' },
  { value: 'macos', label: '🍎 macOS' },
  { value: 'linux', label: '🐧 Linux' },
  { value: 'android', label: '🤖 Android' }
]

interface BulkCreateProps {
  onClose: () => void
  onDone: () => void
}

export function BulkCreate({ onClose, onDone }: BulkCreateProps): React.JSX.Element {
  const { t } = useI18n()
  const [prefix, setPrefix] = useState('Batch')
  const [count, setCount] = useState(5)
  const [group, setGroup] = useState('default')
  const [os, setOs] = useState('windows')
  const [proxy, setProxy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(0)

  const submit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setDone(0)
    try {
      for (let i = 1; i <= count; i++) {
        await window.foxmask.profiles.create({
          name: `${prefix} #${i}`,
          group_id: group || 'default',
          os,
          raw_proxy: proxy.trim() || undefined
        })
        setDone(i)
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={t('bulk.title')}>
        <header className="modal-header">
          <h3>{t('bulk.title')}</h3>
          <button type="button" className="btn ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          {error && (
            <div role="alert" className="banner error">
              {error}
            </div>
          )}
          <Tip tipKey="tip.bulk" />
          <div className="form">
            <label>
              {t('bulk.prefix')}
              <input
                aria-label={t('bulk.prefix')}
                className="input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </label>
            <label>
              {t('bulk.count')}
              <input
                aria-label={t('bulk.count')}
                className="input"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              {t('bulk.group')}
              <input
                aria-label={t('bulk.group')}
                className="input"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </label>
            <label>
              {t('bulk.os')}
              <select
                aria-label={t('bulk.os')}
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
            <label>
              {t('bulk.sharedProxy')}
              <input
                aria-label={t('bulk.sharedProxy')}
                className="input"
                placeholder="socks5://user:pass@host:port"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
            </label>
          </div>
          {submitting && (
            <div role="status" className="muted">
              {t('bulk.creating', { done, count })}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('wizard.cancel')}
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn primary"
            disabled={submitting || prefix.trim() === ''}
            onClick={() => void submit()}
          >
            {submitting ? t('bulk.creating', { done, count }) : t('bulk.create', { count })}
          </button>
        </footer>
      </div>
    </div>
  )
}
