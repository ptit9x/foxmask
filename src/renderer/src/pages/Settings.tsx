import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../main/settings/settings'
import { Tip } from '../components/Tip'
import { useI18n } from '../i18n'

/**
 * Settings page: API port, data dir, Chromium path, launch-at-login.
 * Read-only display of the effective data dir; apiPort applies after restart.
 */

export function Settings(): React.JSX.Element {
  const { t } = useI18n()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [info, setInfo] = useState<{ apiPort: number; dataDir: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.foxmask.settings.get(), window.foxmask.appInfo()]).then(
      ([s, i]) => {
        if (!cancelled) {
          setSettings(s)
          setInfo({ apiPort: i.apiPort, dataDir: i.dataDir })
        }
      }
    )
    return (): void => {
      cancelled = true
    }
  }, [])

  if (!settings) return <div className="page muted">{t('settings.loading')}</div>

  const update = (patch: Partial<AppSettings>): void => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    if (!settings || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = await window.foxmask.settings.set({
        apiPort: settings.apiPort,
        dataDir: settings.dataDir,
        chromiumPath: settings.chromiumPath,
        launchAtLogin: settings.launchAtLogin
      })
      setSettings(next)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2>⚙️ {t('settings.title')}</h2>
      <Tip tipKey="tip.settings" />
      {error && (
        <div role="alert" className="banner error">
          {error}
        </div>
      )}
      <div className="settings-form form">
        <label>
          {t('settings.apiPort')} ({t('settings.apiPortEffective', { port: info ? String(info.apiPort) : '…' })})
          <input
            aria-label={t('settings.apiPort')}
            className="input"
            type="number"
            min={1024}
            max={65535}
            value={settings.apiPort}
            onChange={(e) => update({ apiPort: Number(e.target.value) || 35000 })}
          />
        </label>
        <label>
          {t('settings.dataDir')}
          <input
            aria-label={t('settings.dataDir')}
            className="input"
            placeholder={info?.dataDir ?? '~/.foxmask'}
            value={settings.dataDir}
            onChange={(e) => update({ dataDir: e.target.value })}
          />
        </label>
        <label>
          {t('settings.chromium')}
          <input
            aria-label={t('settings.chromium')}
            className="input"
            placeholder="auto"
            value={settings.chromiumPath}
            onChange={(e) => update({ chromiumPath: e.target.value })}
          />
        </label>
        <label className="checkbox-row">
          <input
            aria-label={t('settings.launchAtLogin')}
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => update({ launchAtLogin: e.target.checked })}
          />
          {t('settings.launchAtLogin')}
        </label>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
          {saved && <span className="muted">{t('settings.saved')}</span>}
        </div>
      </div>
    </div>
  )
}
