import type { Profile } from '../../../main/types/profile'
import type { LauncherStatus } from '../../../main/api/server'
import { useI18n } from '../i18n'

/**
 * The profile table: selection checkboxes, status dot, identity columns, and
 * per-row actions. Purely presentational — all behaviour arrives via props.
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
  /** Currently checked profile ids. */
  selectedIds: ReadonlySet<string>
  onToggleSelect(id: string, checked: boolean): void
  onToggleSelectAll(checked: boolean): void
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
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onLaunch,
  onStop,
  onEdit,
  onDuplicate,
  onDelete
}: ProfileTableProps): React.JSX.Element {
  const { t } = useI18n()
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  return (
    <table className="profile-table">
      <thead>
        <tr>
          <th className="col-select">
            <input
              type="checkbox"
              aria-label={t('table.selectAll')}
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && !allSelected
              }}
              onChange={(e) => onToggleSelectAll(e.target.checked)}
            />
          </th>
          <th className="col-status">{t('table.status')}</th>
          <th>{t('table.name')}</th>
          <th>{t('table.group')}</th>
          <th>{t('table.tags')}</th>
          <th>{t('table.os')}</th>
          <th>{t('table.proxy')}</th>
          <th>{t('table.created')}</th>
          <th className="col-actions">{t('table.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const running = statuses[row.id]?.running ?? false
          const busy = busyIds.has(row.id)
          return (
            <tr key={row.id} data-profile-id={row.id}>
              <td className="col-select">
                <input
                  type="checkbox"
                  aria-label={`${t('table.selectRow')} ${row.name}`}
                  checked={selectedIds.has(row.id)}
                  onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                />
              </td>
              <td className="col-status">
                <span
                  className={`dot ${running ? 'running' : 'stopped'}`}
                  title={running ? t('table.running') : t('table.stopped')}
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
                    ⏹️ {t('table.stop')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void onLaunch(row)}
                  >
                    {busy ? '⏳ ' + t('table.starting') : '🚀 ' + t('table.launch')}
                  </button>
                )}
                <button type="button" className="btn ghost" disabled={busy} onClick={() => onEdit(row)}>
                  ✏️ {t('table.edit')}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void onDuplicate(row)}
                >
                  🧬 {t('table.duplicate')}
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  disabled={busy}
                  onClick={() => onDelete(row)}
                >
                  🗑️ {t('table.delete')}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
