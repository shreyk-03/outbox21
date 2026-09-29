import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from '../components/Overlays';
import { SlackPage } from './SlackPage';

vi.mock('../hooks/queries', () => ({
  useSlackStatus: vi.fn(),
  useDisconnectSlack: vi.fn(),
}));

import { useDisconnectSlack, useSlackStatus } from '../hooks/queries';

const mockedStatus = vi.mocked(useSlackStatus);
const mockedDisconnect = vi.mocked(useDisconnectSlack);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <SlackPage />
          <ToastHost />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SlackPage', () => {
  it('shows connect affordance when disconnected', () => {
    mockedStatus.mockReturnValue({ isPending: false, isError: false, data: { connected: false, teamName: null } } as never);
    mockedDisconnect.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    renderPage();
    expect(screen.getByRole('button', { name: /connect slack/i })).toBeInTheDocument();
  });

  it('shows team name and disconnects when connected', async () => {
    const user = userEvent.setup();
    mockedStatus.mockReturnValue({
      isPending: false,
      isError: false,
      data: { connected: true, teamName: 'Acme' },
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockedDisconnect.mockReturnValue({ mutateAsync, isPending: false } as never);
    renderPage();
    expect(screen.getByText(/connected to acme/i)).toBeInTheDocument();
    expect(screen.queryByText(/xoxp/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /disconnect slack/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/slack disconnected/i)).toBeInTheDocument();
  });

  it('shows loading and error states', () => {
    mockedStatus.mockReturnValue({ isPending: true } as never);
    mockedDisconnect.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    const { unmount } = renderPage();
    expect(screen.getByText(/checking slack connection/i)).toBeInTheDocument();
    unmount();

    mockedStatus.mockReturnValue({ isPending: false, isError: true, error: new Error('down'), refetch: vi.fn() } as never);
    renderPage();
    expect(screen.getByText(/unable to check slack status/i)).toBeInTheDocument();
  });
});
