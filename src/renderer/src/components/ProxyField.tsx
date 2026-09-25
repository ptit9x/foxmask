import { useState } from 'react'
import type { ProxyCheckResult } from '../../../main/proxy/check'

/**
 * Proxy input with a live Test button: pastes a raw proxy URL, checks it via
 * foxmask.proxies.check and renders IP / latency / geo feedback.
 */

interface ProxyFieldProps {
  value: string
  onChange: (value: string) => void
}

export function ProxyField({ value, onChange }: ProxyFieldProps): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ProxyCheckResult | null>(null)

  const test = async (): Promise<void> => {
    if (!value.trim() || checking) return
    setChecking(true)
    setResult(null)
    try {
      setResult(await window.foxmask.proxies.check(value.trim()))
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="proxy-field">
      <div className="row">
        <input
          aria-label="Proxy URL"
          className="input proxy-input"
          placeholder="socks5://user:pass@host:port — leave empty for direct"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn ghost"
          disabled={checking || !value.trim()}
          onClick={() => void test()}
        >
          {checking ? 'Testing…' : 'Test'}
        </button>
      </div>
      {result && result.ok && (
        <div className="proxy-result ok" role="status">
          ✓ {result.ip} · {result.latencyMs}ms
          {result.geo ? ` · ${result.geo.city}, ${result.geo.country}` : ''}
        </div>
      )}
      {result && !result.ok && (
        <div className="proxy-result fail" role="alert">
          ✗ {result.error}
        </div>
      )}
    </div>
  )
}
