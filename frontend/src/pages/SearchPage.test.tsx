import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../context/ToastContext';
import { SearchPage } from './SearchPage';

vi.mock('../hooks/queries', () => ({
  useEmailSearch: vi.fn(),
  useEmailDetail: vi.fn(),
}));

import { useEmailSearch } from '../hooks/queries';

const mockedSearch = vi.mocked(useEmailSearch);

function renderPage(path = '/dashboard/search') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <SearchPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('SearchPage', () => {
  it('shows the idle empty state before typing', () => {
    mockedSearch.mockReturnValue({ isPending: false, isError: false, data: [] } as never);
    renderPage();
    expect(screen.getByText(/search your emails/i)).toBeInTheDocument();
    expect(mockedSearch).toHaveBeenCalledWith('');
  });

  it('debounces keystrokes before searching', async () => {
    vi.useFakeTimers();
    try {
      mockedSearch.mockReturnValue({ isPending: true } as never);
      renderPage();
      const input = screen.getByLabelText(/search emails/i);
      fireEvent.change(input, { target: { value: 'alice' } });
      // Still debouncing: hook still holds the previous value.
      expect(mockedSearch).toHaveBeenLastCalledWith('');
      await vi.advanceTimersByTimeAsync(500);
      expect(mockedSearch).toHaveBeenLastCalledWith('alice');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders results and clear action', async () => {
    mockedSearch.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        {
          id: 'e-1',
          recipient: 'alice@example.com',
          subject: 'Hi',
          scheduledAt: '2026-09-28T10:00:00.000Z',
          sentAt: null,
          status: 'SENT',
          attempts: 1,
          createdAt: '',
        },
      ],
    } as never);
    renderPage('/dashboard/search?q=alice');
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText(/1 result for/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /clear search/i }));
    expect(screen.getByLabelText(/search emails/i)).toHaveValue('');
    // Debounce (400ms) delays the idle empty state.
    expect(await screen.findByText(/search your emails/i)).toBeInTheDocument();
  });

  it('shows error state with retry', () => {
    mockedSearch.mockReturnValue({ isPending: false, isError: true, error: new Error('down'), refetch: vi.fn() } as never);
    renderPage('/dashboard/search?q=boom');
    expect(screen.getByText(/search failed/i)).toBeInTheDocument();
  });
});
