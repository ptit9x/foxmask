// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Settings } from './Settings'
import { createFoxmaskMock } from '../test/mock-foxmask'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { api, install } = createFoxmaskMock()
const foxmask = api as unknown as {
  settings: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  install()
  foxmask.settings.get.mockResolvedValue({
    apiPort: 35000,
    dataDir: '',
    chromiumPath: '',
    launchAtLogin: false
  })
  foxmask.settings.set.mockImplementation(async (patch: Record<string, unknown>) => ({
    apiPort: 35000,
    dataDir: '',
    chromiumPath: '',
    launchAtLogin: false,
    ...patch
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings page', () => {
  it('loads and renders current settings', async () => {
    render(<Settings />)
    expect(await screen.findByLabelText('API port')).toHaveValue(35000)
    expect(screen.getByLabelText('Launch at login')).not.toBeChecked()
  })

  it('saves the edited settings via settings.set', async () => {
    render(<Settings />)
    const port = await screen.findByLabelText('API port')
    fireEvent.change(port, { target: { value: '36000' } })
    const login = screen.getByLabelText('Launch at login')
    fireEvent.click(login)

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(foxmask.settings.set).toHaveBeenCalled())
    const patch = foxmask.settings.set.mock.calls[0][0]
    expect(patch.apiPort).toBe(36000)
    expect(patch.launchAtLogin).toBe(true)
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
  })
})
