// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ProfileWizard } from './ProfileWizard'
import { I18nProvider } from '../i18n'
import { BulkCreate } from './BulkCreate'
import { createFoxmaskMock, fixtureProfile } from '../test/mock-foxmask'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { api, install } = createFoxmaskMock()
const foxmask = api as unknown as {
  profiles: {
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  fingerprintPreview: ReturnType<typeof vi.fn>
  proxies: { check: ReturnType<typeof vi.fn> }
}

const noop = (): void => {}

beforeEach(() => {
  install()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProfileWizard — create mode', () => {
  it('blocks Next on the Basics step until the name is filled', async () => {
    render(<I18nProvider><ProfileWizard initial={null} onClose={noop} onSaved={noop}  /></I18nProvider>)

    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Wizard Test' } })
    expect(next).not.toBeDisabled()
  })

  it('previews the fingerprint and regenerates on demand', async () => {
    render(<I18nProvider><ProfileWizard initial={null} onClose={noop} onSaved={noop}  /></I18nProvider>)

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'W' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/User-Agent/)).toBeInTheDocument()
    const callsBefore = foxmask.fingerprintPreview.mock.calls.length
    expect(callsBefore).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    await waitFor(() =>
      expect(foxmask.fingerprintPreview.mock.calls.length).toBeGreaterThan(callsBefore)
    )
  })

  it('submits create() with the form values on the review step', async () => {
    foxmask.profiles.create.mockResolvedValue(fixtureProfile({ id: 'new', name: 'Wizard Test' }))

    render(<I18nProvider><ProfileWizard initial={null} onClose={noop} onSaved={noop}  /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Wizard Test' } })
    fireEvent.change(screen.getByLabelText(/Tags \(comma separated\)/), { target: { value: 'a, b' } })

    // Basics → Fingerprint → Proxy → Review
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    const create = await screen.findByRole('button', { name: /create profile/i })
    fireEvent.click(create)

    await waitFor(() => expect(foxmask.profiles.create).toHaveBeenCalledTimes(1))
    const arg = foxmask.profiles.create.mock.calls[0][0]
    expect(arg.name).toBe('Wizard Test')
    expect(arg.tags).toEqual(['a', 'b'])
    expect(arg.os).toBe('windows')
    expect(typeof arg.seed).toBe('string')
  })
})

describe('ProfileWizard — edit mode', () => {
  it('updates metadata via update() and skips the fingerprint step', async () => {
    const initial = fixtureProfile({ id: 'p9', name: 'Original' })
    foxmask.profiles.update.mockResolvedValue({ ...initial, name: 'Renamed' })

    render(<I18nProvider><ProfileWizard initial={initial} onClose={noop} onSaved={noop}  /></I18nProvider>)
    expect(screen.getByText(/edit .original./i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Renamed' } })
    // Basics → Proxy (fingerprint frozen at creation; step skipped in edit)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    const save = await screen.findByRole('button', { name: /save changes/i })
    fireEvent.click(save)

    await waitFor(() => expect(foxmask.profiles.update).toHaveBeenCalledWith('p9', expect.objectContaining({ name: 'Renamed' })))
  })
})

describe('BulkCreate', () => {
  it('creates N profiles with sequential names', async () => {
    foxmask.profiles.create.mockImplementation(async (input: { name: string }) =>
      fixtureProfile({ id: input.name, name: input.name })
    )

    render(<I18nProvider><BulkCreate onClose={noop} onDone={noop} /></I18nProvider>)
    fireEvent.change(screen.getByLabelText(/Count \(1–100\)/), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /create 3 profiles/i }))

    await waitFor(() => expect(foxmask.profiles.create).toHaveBeenCalledTimes(3))
    const names = foxmask.profiles.create.mock.calls.map((c) => c[0].name)
    expect(names).toEqual(['Batch #1', 'Batch #2', 'Batch #3'])
  })
})
