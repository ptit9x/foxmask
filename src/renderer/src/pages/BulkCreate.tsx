import { useState } from 'react'

/**
 * Bulk-create dialog: N profiles sharing group/OS/proxy, each with a distinct
 * random seed (unique fingerprints), named '<prefix> #k'.
 */

interface BulkCreateProps {
  onClose: () => void
  onDone: () => void
}

export function BulkCreate({ onClose, onDone }: BulkCreateProps): React.JSX.Element {
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
      <div className="modal" role="dialog" aria-label="Bulk create profiles">
        <header className="modal-header">
          <h3>Bulk create profiles</h3>
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
          <div className="form">
            <label>
              Name prefix
              <input
                aria-label="Name prefix"
                className="input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </label>
            <label>
              Count (1–100)
              <input
                aria-label="Count"
                className="input"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              Group
              <input
                aria-label="Group"
                className="input"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </label>
            <label>
              OS
              <select
                aria-label="Bulk OS"
                className="input select"
                value={os}
                onChange={(e) => setOs(e.target.value)}
              >
                <option value="windows">🪟 Windows</option>
                <option value="macos">🍎 macOS</option>
                <option value="linux">🐧 Linux</option>
                <option value="android">🤖 Android</option>
              </select>
            </label>
            <label>
              Shared proxy (optional)
              <input
                aria-label="Shared proxy"
                className="input"
                placeholder="socks5://user:pass@host:port"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
            </label>
          </div>
          {submitting && (
            <div role="status" className="muted">
              Creating… {done}/{count}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn primary"
            disabled={submitting || prefix.trim() === ''}
            onClick={() => void submit()}
          >
            {submitting ? 'Creating…' : `Create ${count} profiles`}
          </button>
        </footer>
      </div>
    </div>
  )
}
