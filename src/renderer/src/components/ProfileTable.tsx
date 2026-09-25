import type { Profile } from '../../../main/types/profile'
import type { LauncherStatus } from '../../../main/api/server'

/**
 * The profile table: status dot, identity columns, and per-row actions.
 * Purely presentational — all behaviour arrives via props.
 */

const OS_LABELS: Record<string, string> = {
  windows: '🪟 Windows',
  macos: '🍎 macOS',
  linux: '🐧 Linux',
  android: '🤖 Android'
}

/** Extract a display-friendly host from a raw proxy URL ('' → direct). */
export function proxyHost(raw: string): string {
  if (!raw) return 'direct'
  try {
    const url = new URL(raw)
    return url.host
  } catch {
    return raw
  }
}

interface ProfileTableProps {
  rows: Profile[]
  statuses: Record<string, LauncherStatus>
  busyIds: ReadonlySet<string>
  onLaunch: (profile: Profile) => void | Promise<void>
  onStop: (profile: Profile) => void | Promise<void>
  onEdit: (profile: Profile) => void
  onDuplicate: (profile: Profile) => void | Promise<void>
  onDelete: (profile: Profile) => void
}

export function ProfileTable({
  rows,
  statuses,
  busyIds,
  onLaunch,
  onStop,
  onEdit,
  onDuplicate,
  onDelete
}: ProfileTableProps): React.JSX.Element {
  return (
    <table className="profile-table">
      <thead>
        <tr>
          <th className="col-status">Status</th>
          <th>Name</th>
          <th>Group</th>
          <th>Tags</th>
          <th>OS</th>
          <th>Proxy</th>
          <th>Created</th>
          <th className="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const running = statuses[row.id]?.running ?? false
          const busy = busyIds.has(row.id)
          return (
            <tr key={row.id} data-profile-id={row.id}>
              <td className="col-status">
                <span
                  className={`dot ${running ? 'running' : 'stopped'}`}
                  title={running ? 'Running' : 'Stopped'}
                />
              </td>
              <td className="cell-name">{row.name}</td>
              <td>{row.group_id}</td>
              <td>
                <div className="tags">
                  {row.tags.map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td>{OS_LABELS[row.fingerprint.os] ?? row.fingerprint.os}</td>
              <td className="cell-proxy">{proxyHost(row.raw_proxy)}</td>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td className="col-actions">
                {running ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void onStop(row)}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void onLaunch(row)}
                  >
                    {busy ? 'Starting…' : 'Launch'}
                  </button>
                )}
                <button type="button" className="btn ghost" disabled={busy} onClick={() => onEdit(row)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void onDuplicate(row)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  disabled={busy}
                  onClick={() => onDelete(row)}
                >
                  Delete
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
