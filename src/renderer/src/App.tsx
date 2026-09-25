import { useEffect, useState } from 'react'
import type { Profile } from '../../main/types/profile'
import { I18nProvider, useI18n } from './i18n'
import { Profiles } from './pages/Profiles'
import { ProfileWizard } from './pages/ProfileWizard'
import { BulkCreate } from './pages/BulkCreate'
import { Settings } from './pages/Settings'

/**
 * App shell: brand header with version, simple nav, modal orchestration
 * (wizard + bulk create) and the active page. Page switching is plain state —
 * no router dependency for a small tool. Wraps everything in I18nProvider
 * (language + beginner tips), so inner components use useI18n().
 */

type Page = 'profiles' | 'settings'

interface AppInfo {
  version: string
  apiPort: number
  dataDir: string
}

function Shell(): React.JSX.Element {
  const { t, lang, setLang, tips, setTips } = useI18n()
  const [page, setPage] = useState<Page>('profiles')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardProfile, setWizardProfile] = useState<Profile | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [listKey, setListKey] = useState(0)

  const openCreate = (): void => {
    setWizardProfile(null)
    setWizardOpen(true)
  }
  const openEdit = (profile: Profile): void => {
    setWizardProfile(profile)
    setWizardOpen(true)
  }
  const refreshList = (): void => {
    setListKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    window.foxmask
      .appInfo()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch(() => {
        /* version display is cosmetic; ignore failures */
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🦊</span>
          <span className="brand-name">Foxmask</span>
          {info && <span className="brand-version">v{info.version}</span>}
        </div>
        <nav className="nav">
          <button
            type="button"
            className={`nav-item ${page === 'profiles' ? 'active' : ''}`}
            onClick={() => setPage('profiles')}
          >
            <span aria-hidden="true">🗂️</span> {t('nav.profiles')}
          </button>
          <button
            type="button"
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => setPage('settings')}
          >
            <span aria-hidden="true">⚙️</span> {t('nav.settings')}
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setTips(!tips)}
            title={tips ? t('tips.hide') : t('tips.show')}
          >
            {tips ? '💡 ' + t('tips.hide') : '💡 ' + t('tips.show')}
          </button>
          <div className="lang-switch" role="group" aria-label="Language">
            <button
              type="button"
              className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${lang === 'vi' ? 'active' : ''}`}
              onClick={() => setLang('vi')}
            >
              VI
            </button>
          </div>
          {info && (
            <>
              <div className="muted">API 127.0.0.1:{info.apiPort}</div>
              <div className="muted small" title={info.dataDir}>
                {info.dataDir}
              </div>
            </>
          )}
        </div>
      </aside>
      <main className="content">
        {page === 'profiles' ? (
          <Profiles
            key={listKey}
            onCreate={openCreate}
            onEdit={openEdit}
            onBulkCreate={() => setBulkOpen(true)}
          />
        ) : (
          <Settings />
        )}
      </main>

      {wizardOpen && (
        <ProfileWizard
          initial={wizardProfile}
          onClose={() => setWizardOpen(false)}
          onSaved={() => {
            setWizardOpen(false)
            refreshList()
          }}
        />
      )}
      {bulkOpen && (
        <BulkCreate
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false)
            refreshList()
          }}
        />
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  )
}

export default App
