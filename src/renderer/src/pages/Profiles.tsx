import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Profile } from '../../../main/types/profile'
import type { LauncherStatus } from '../../../main/api/server'
import { ProfileTable } from '../components/ProfileTable'

/**
 * Profiles list page: toolbar (search / group filter / create / bulk create),
 * the profile table, pagination, and per-row start/stop actions.
 * Status strategy: fetch statuses on load and refresh them after start/stop.
 */

const PAGE_SIZE = 50

interface ProfilesPageProps {
  onCreate: () => void
  onEdit: (profile: Profile) => void
  onBulkCreate: () => void
}

interface ListState {
  rows: Profile[]
  total: number
  lastPage: number
}

const STOPPED: LauncherStatus = { running: false, wsEndpoint: null, debugPort: null, startedAt: null }

export function Profiles({ onCreate, onEdit, onBulkCreate }: ProfilesPageProps): React.JSX.Element {
  const [list, setList] = useState<ListState | null>(null)
  const [statuses, setStatuses] = useState<Record<string, LauncherStatus>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const searchTimer = useRef<number | null>(null)

  const fetchStatuses = useCallback(async (rows: Profile[]): Promise<void> => {
    const next: Record<string, LauncherStatus> = {}
    for (const row of rows) {
      try {
        next[row.id] = await window.foxmask.profiles.status(row.id)
      } catch {
        // Status failure is non-fatal; the dot just stays gray.
        next[row.id] = STOPPED
      }
    }
    setStatuses(next)
  }, [])

  const fetchPage = useCallback(
    async (targetPage: number, targetSearch: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.foxmask.profiles.list({
          page: targetPage,
          page_size: PAGE_SIZE,
          search: targetSearch || undefined
        })
        const state = { rows: result.rows, total: result.total, lastPage: result.last_page }
        setList(state)
        setLoading(false)
        await fetchStatuses(state.rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    },
    [fetchStatuses]
  )

  // Load whenever the page changes (also covers initial mount).
  useEffect(() => {
    void fetchPage(page, search)
    // search intentionally excluded: the debounced effect below owns re-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fetchPage])

  // Debounced search: re-fetch 300ms after the last keystroke.
  useEffect(() => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void fetchPage(page, search)
    }, 300)
    return (): void => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const row of list?.rows ?? []) set.add(row.group_id)
    return [...set].sort()
  }, [list])

  const visibleRows = useMemo(
    () => (group ? (list?.rows ?? []).filter((r) => r.group_id === group) : (list?.rows ?? [])),
    [list, group]
  )

  const markBusy = (id: string, busy: boolean): void => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleLaunch = async (profile: Profile): Promise<void> => {
    markBusy(profile.id, true)
    setActionError(null)
    try {
      await window.foxmask.profiles.start(profile.id)
      await fetchStatuses(list?.rows ?? [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      markBusy(profile.id, false)
    }
  }

  const handleStop = async (profile: Profile): Promise<void> => {
    markBusy(profile.id, true)
    setActionError(null)
    try {
      await window.foxmask.profiles.stop(profile.id)
      await fetchStatuses(list?.rows ?? [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      markBusy(profile.id, false)
    }
  }

  const handleDuplicate = async (profile: Profile): Promise<void> => {
    markBusy(profile.id, true)
    setActionError(null)
    try {
      await window.foxmask.profiles.duplicate(profile.id)
      await fetchPage(page, search)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      markBusy(profile.id, false)
    }
  }

  const handleDelete = (profile: Profile): void => {
    if (!window.confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return
    markBusy(profile.id, true)
    void (async (): Promise<void> => {
      try {
        await window.foxmask.profiles.delete(profile.id)
        await fetchPage(page, search)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        markBusy(profile.id, false)
      }
    })()
  }

  const retry = (): void => {
    void fetchPage(page, search)
  }

  const handleExport = async (): Promise<void> => {
    setActionError(null)
    try {
      const env = await window.foxmask.profiles.export()
      const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `foxmask-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleImport = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return
      void (async (): Promise<void> => {
        setActionError(null)
        try {
          const text = await file.text()
          const outcome = await window.foxmask.profiles.import(text)
          const summary =
            `Imported ${outcome.imported.length}` +
            (outcome.skipped.length > 0 ? `, skipped ${outcome.skipped.length}` : '')
          window.alert(summary)
          await fetchPage(page, search)
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err))
        }
      })()
    }
    input.click()
  }

  return (
    <div className="page">
      <div className="toolbar">
        <input
          aria-label="Search profiles"
          className="input search"
          placeholder="Search profiles…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <select
          aria-label="Filter by group"
          className="input select"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={handleImport} title="Import profiles from JSON">
          Import
        </button>
        <button type="button" className="btn ghost" onClick={() => void handleExport()} title="Export all profiles to JSON">
          Export
        </button>
        <button type="button" className="btn ghost" onClick={onBulkCreate}>
          Bulk create
        </button>
        <button type="button" className="btn primary" onClick={onCreate}>
          Create profile
        </button>
      </div>

      {actionError && (
        <div role="alert" className="banner error">
          {actionError}
        </div>
      )}
      {error && (
        <div role="alert" className="banner error">
          Failed to load profiles: {error}
          <button type="button" className="btn ghost" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty">Loading profiles…</div>
      ) : error ? null : visibleRows.length === 0 ? (
        <div className="empty">
          <p>No profiles yet.</p>
          <button type="button" className="btn primary" onClick={onCreate}>
            Create profile
          </button>
        </div>
      ) : (
        <ProfileTable
          rows={visibleRows}
          statuses={statuses}
          busyIds={busyIds}
          onLaunch={handleLaunch}
          onStop={handleStop}
          onEdit={onEdit}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
      )}

      {list && (
        <div className="pagination">
          <button
            type="button"
            className="btn ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Prev
          </button>
          <span className="page-indicator">
            Page {page} / {Math.max(1, list.lastPage)} · {list.total} profiles
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={page >= list.lastPage || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  )
}
