import { useI18n } from '../i18n'
import type { TKey } from '../i18n'

/**
 * Tip box for beginners: a 💡 hint shown while tips are enabled. The text
 * lives in the i18n dictionaries as `tip.<key>` entries.
 */
export function Tip({ tipKey }: { tipKey: TKey }): React.JSX.Element {
  const { tips, t } = useI18n()
  if (!tips) return <></>
  return (
    <div className="tip" role="note">
      <span aria-hidden="true">💡</span> {t(tipKey)}
    </div>
  )
}
