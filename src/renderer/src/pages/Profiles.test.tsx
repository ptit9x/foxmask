// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Profiles } from './Profiles'
import { createFoxmaskMock, fixtureProfile } from '../test/mock-foxmask'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { api, install } = createFoxmaskMock()
const foxmask = api as unknown as {
  profiles: {
    list: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
}

const noop = (): void => {}

beforeEach(() => {
  install()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Profiles page', () => {
  it('renders rows from the mocked list', async () => {
    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)

    expect(await screen.findByText('Shop Alpha')).toBeInTheDocument()
    expect(screen.getByText('Solo Beta')).toBeInTheDocument()
    expect(screen.getAllByText('ecom').length).toBeGreaterThan(0)
    expect(screen.getByText('vip', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Windows/)).toBeInTheDocument()
    expect(screen.getByText(/macOS/)).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4:1080')).toBeInTheDocument()
    expect(screen.getByText('direct')).toBeInTheDocument()
  })

  it('shows the empty state with a Create button when the list is empty', async () => {
    foxmask.profiles.list.mockResolvedValue({ rows: [], total: 0, last_page: 1 })

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)

    expect(await screen.findByText(/no profiles yet/i)).toBeInTheDocument()
    const createButtons = screen.getAllByRole('button', { name: /create profile/i })
    expect(createButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('debounces search input by 300ms', async () => {
    vi.useFakeTimers()
    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    await act(async () => {})
    expect(foxmask.profiles.list).toHaveBeenCalledTimes(1)

    const input = screen.getByLabelText('Search profiles')
    fireEvent.change(input, { target: { value: 'alpha' } })

    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(foxmask.profiles.list).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(foxmask.profiles.list).toHaveBeenCalledTimes(2)
    expect(foxmask.profiles.list).toHaveBeenLastCalledWith({
      page: 1,
      page_size: 50,
      search: 'alpha'
    })
  })

  it('Launch calls start and disables while in flight, then refreshes statuses', async () => {
    let resolveStart: (value: unknown) => void = () => {}
    foxmask.profiles.start.mockImplementation(
      () =>
        new Promise((res) => {
          resolveStart = res
        })
    )

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    const launch = (await screen.findAllByRole('button', { name: 'Launch' }))[0]
    const statusCallsBefore = foxmask.profiles.status.mock.calls.length

    fireEvent.click(launch)
    // In flight: disabled and labelled as starting.
    expect(launch).toBeDisabled()
    expect(launch).toHaveTextContent(/starting/i)

    await act(async () => {
      resolveStart({ profileId: 'p1', wsEndpoint: null, debugPort: null, startedAt: '' })
    })
    await waitFor(() => {
      expect(foxmask.profiles.status.mock.calls.length).toBeGreaterThan(statusCallsBefore)
    })
  })

  it('Stop calls stop for a running profile', async () => {
    foxmask.profiles.status.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'p1'
          ? { running: true, wsEndpoint: 'ws://x', debugPort: 1, startedAt: 'now' }
          : { running: false, wsEndpoint: null, debugPort: null, startedAt: null }
      )
    )

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    const row = await screen.findByText('Shop Alpha')
    const stopBtn = row.closest('tr')?.querySelector('button') as HTMLButtonElement
    await waitFor(() => expect(stopBtn).toHaveTextContent('Stop'))

    fireEvent.click(stopBtn)
    await waitFor(() => expect(foxmask.profiles.stop).toHaveBeenCalledWith('p1'))
  })

  it('Delete asks for confirmation and only deletes on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    const row = await screen.findByText('Shop Alpha')
    const delBtn = [...(row.closest('tr')?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.includes('Delete')
    ) as HTMLButtonElement

    fireEvent.click(delBtn)
    expect(confirmSpy).toHaveBeenCalled()
    expect(foxmask.profiles.delete).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(delBtn)
    await waitFor(() => expect(foxmask.profiles.delete).toHaveBeenCalledWith('p1'))
  })

  it('paginates with next/prev calling list with the right page', async () => {
    foxmask.profiles.list.mockResolvedValue({
      rows: Array.from({ length: 2 }, (_, i) => fixtureProfile({ id: `p${i}`, name: `Row ${i}` })),
      total: 120,
      last_page: 3
    })

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    const next = await screen.findByRole('button', { name: /next/i })

    fireEvent.click(next)
    await waitFor(() =>
      expect(foxmask.profiles.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, page_size: 50 })
      )
    )

    const prev = screen.getByRole('button', { name: /prev/i })
    fireEvent.click(prev)
    await waitFor(() =>
      expect(foxmask.profiles.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, page_size: 50 })
      )
    )
  })

  it('shows an error banner with retry when the list rejects', async () => {
    foxmask.profiles.list.mockRejectedValueOnce(new Error('db locked'))

    render(<Profiles onCreate={noop} onEdit={noop} onBulkCreate={noop} />)
    expect(await screen.findByText(/failed to load profiles/i)).toBeInTheDocument()
    expect(screen.getByText(/db locked/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(foxmask.profiles.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Shop Alpha')).toBeInTheDocument()
  })
})
