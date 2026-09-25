import { useEffect, useMemo, useState } from 'react'
import type { Profile } from '../../../main/types/profile'
import { useI18n } from '../i18n'
import { Tip } from './Tip'

/**
 * Action-sync control panel. Select profiles with the table checkboxes (or
 * Select all), pick which checked one is the master, and every click / key /
 * scroll / navigation in the master is replayed in the other checked running
 * profiles in real time.
 */
export function SyncPanel({
  rows,
  statuses,
  selectedIds,
  onClearSelection
}: {
  rows: Profile[]
  statuses: Record<string, { running: boolean }>
  /** ids checked in the table (drives the master dropdown). */
  selectedIds: ReadonlySet<string>
  onClearSelection(): void
}): React.JSX.Element {
  const { t } = useI18n()
  const [master, setMaster] = useState('')
  const [status, setStatus] = useState<{
    enabled: boolean
    master: string | null
    followers: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.foxmask.sync
      .status()
      .then(setStatus)
      .catch(() => {})
  }, [])

  const active = status?.master != null
  const nameOf = (id: string): string => rows.find((r) => r.id === id)?.name ?? id

  // Candidates: checked AND running.
  const candidates = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id) && statuses[r.id]?.running),
    [rows, selectedIds, statuses]
  )
  const runningCount = useMemo(
    () => rows.filter((r) => statuses[r.id]?.running).length,
    [rows, statuses]
  )

  // Keep master valid when the selection changes.
  useEffect(() => {
    if (master && !candidates.some((c) => c.id === master)) setMaster('')
  }, [candidates, master])

  const followers = candidates.filter((c) => c.id !== master).map((c) => c.id)

  const start = async (): Promise<void> => {
    if (!master) return
    setBusy(true)
    setError('')
    try {
      const res = await window.foxmask.sync.start(master, followers)
      setStatus({ enabled: true, master: res.master, followers: res.followers })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.foxmask.sync.stop()
      setStatus(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sync-panel">
      <Tip tipKey="tip.sync" />
      {active ? (
        <div className="sync-active">
          <span className="sync-badge">🔄</span>
          <span>
            {t('sync.activePrefix')} <strong>{nameOf(status?.master ?? '')}</strong> →{' '}
            {status?.followers.length ?? 0} {t('sync.followersSuffix')}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void stop()}>
            ⏹ {t('sync.stop')}
          </button>
        </div>
      ) : (
        <div className="sync-controls">
          <select
            aria-label={t('sync.master')}
            className="input select"
            value={master}
            onChange={(e) => setMaster(e.target.value)}
          >
            <option value="">
              {candidates.length === 0 ? t('sync.pickMaster') : t('sync.pickMasterReady')}
            </option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!master || busy || followers.length === 0}
            onClick={() => void start()}
          >
            🔄 {t('sync.start')}
          </button>
          {selectedIds.size > 0 && (
            <span className="muted small">
              {t('sync.selectedCount', { n: selectedIds.size })}
            </span>
          )}
          {runningCount < 2 && <span className="muted small">{t('sync.needTwo')}</span>}
          {selectedIds.size > 0 && (
            <button type="button" className="btn ghost small" onClick={onClearSelection}>
              ✖️ {t('sync.clearSelection')}
            </button>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="banner error">
          {error}
        </div>
      )}
    </div>
  )
}
