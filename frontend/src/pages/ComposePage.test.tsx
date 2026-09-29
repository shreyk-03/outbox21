import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from '../components/Overlays';
import { ComposePage } from './ComposePage';

vi.mock('../hooks/queries', () => ({
  useSenders: vi.fn(),
  useScheduleBulk: vi.fn(),
  useCreateSender: vi.fn(),
}));

import { useCreateSender, useScheduleBulk, useSenders } from '../hooks/queries';

const mockedSenders = vi.mocked(useSenders);
const mockedBulk = vi.mocked(useScheduleBulk);
const mockedCreate = vi.mocked(useCreateSender);

const sender = { id: 'sender-1', email: 'news@example.com', name: 'News', hourlyLimit: 200, createdAt: '' };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ComposePage />
          <ToastHost />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSenders.mockReturnValue({ isPending: false, isError: false, data: [sender], refetch: vi.fn() } as never);
  mockedCreate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
});

describe('ComposePage validation', () => {
  it('blocks empty submission with field errors', async () => {
    const user = userEvent.setup();
    mockedBulk.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    renderPage();
    await user.click(screen.getByRole('button', { name: /schedule 0 emails/i }));
    expect(screen.getByText(/choose a sender/i)).toBeInTheDocument();
    expect(screen.getByText(/subject is required/i)).toBeInTheDocument();
    expect(screen.getByText(/body is required/i)).toBeInTheDocument();
    expect(screen.getByText(/at least one valid recipient/i)).toBeInTheDocument();
    expect(mockedBulk().mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid recipients before submission', async () => {
    const user = userEvent.setup();
    mockedBulk.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    renderPage();
    await user.selectOptions(screen.getByRole('combobox'), 'sender-1');
    await user.type(screen.getByLabelText('Subject'), 'Hi');
    await user.type(screen.getByLabelText('Body'), 'Hello');
    await user.type(screen.getByLabelText('Recipients'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /schedule 0 emails/i }));
    expect(screen.getByText(/at least one valid recipient/i)).toBeInTheDocument();
    expect(mockedBulk().mutateAsync).not.toHaveBeenCalled();
  });

  it('schedules valid recipients and shows the result panel', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({
      campaignId: 'c-1',
      totalRecipients: 2,
      scheduled: 2,
      failed: 0,
      duplicatesRemoved: 1,
      startTime: '2026-09-28T10:00:00.000Z',
      status: 'scheduled',
    });
    mockedBulk.mockReturnValue({ mutateAsync, isPending: false } as never);
    renderPage();
    await user.selectOptions(screen.getByRole('combobox'), 'sender-1');
    await user.type(screen.getByLabelText('Subject'), 'Hi');
    await user.type(screen.getByLabelText('Body'), 'Hello');
    await user.type(screen.getByLabelText('Recipients'), 'a@example.com\nA@EXAMPLE.COM\nb@example.com');
    expect(screen.getByText(/recipients:/i).textContent).toMatch(/2/);
    await user.click(screen.getByRole('button', { name: /schedule 2 emails/i }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: 'sender-1', recipients: ['a@example.com', 'b@example.com'] }),
    );
    expect(await screen.findByText(/scheduled successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicates skipped/i)).toBeInTheDocument();
  });

  it('surfaces scheduling errors without crashing', async () => {
    const user = userEvent.setup();
    mockedBulk.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(new Error('boom')), isPending: false } as never);
    renderPage();
    await user.selectOptions(screen.getByRole('combobox'), 'sender-1');
    await user.type(screen.getByLabelText('Subject'), 'Hi');
    await user.type(screen.getByLabelText('Body'), 'Hello');
    await user.type(screen.getByLabelText('Recipients'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: /schedule 1 email/i }));
    expect(await screen.findByText(/unable to schedule emails/i)).toBeInTheDocument();
  });
});
