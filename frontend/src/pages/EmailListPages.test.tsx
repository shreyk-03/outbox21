import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../context/ToastContext';
import type { EmailListItem } from '../types/api';
import { ScheduledPage, SentPage } from './EmailListPages';

vi.mock('../hooks/queries', () => ({
  useScheduledEmails: vi.fn(),
  useSentEmails: vi.fn(),
  useEmailDetail: vi.fn(),
}));

import { useScheduledEmails, useSentEmails } from '../hooks/queries';

const mockedScheduled = vi.mocked(useScheduledEmails);
const mockedSent = vi.mocked(useSentEmails);

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const row = (overrides: Partial<EmailListItem> = {}): EmailListItem => ({
  id: 'email-1',
  recipient: 'alice@example.com',
  subject: 'Hello',
  scheduledAt: '2026-09-28T10:00:00.000Z',
  sentAt: null,
  status: 'SCHEDULED',
  attempts: 0,
  createdAt: '2026-09-28T09:00:00.000Z',
  ...overrides,
});

describe('ScheduledPage', () => {
  it('shows loading state', () => {
    mockedScheduled.mockReturnValue({ isPending: true } as never);
    renderPage(<ScheduledPage />);
    expect(screen.getByLabelText(/loading table/i)).toBeInTheDocument();
  });

  it('shows empty state with compose action', () => {
    mockedScheduled.mockReturnValue({ isPending: false, isError: false, data: [] } as never);
    renderPage(<ScheduledPage />);
    expect(screen.getByText(/no scheduled emails yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /compose email/i })).toHaveAttribute('href', '/dashboard/compose');
  });

  it('shows error state with retry', () => {
    const refetch = vi.fn();
    mockedScheduled.mockReturnValue({ isPending: false, isError: true, error: new Error('down'), refetch } as never);
    renderPage(<ScheduledPage />);
    expect(screen.getByText(/unable to load scheduled emails/i)).toBeInTheDocument();
  });

  it('renders rows with status badges', () => {
    mockedScheduled.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row(), row({ id: 'email-2', recipient: 'bob@example.com', status: 'PROCESSING' })],
    } as never);
    renderPage(<ScheduledPage />);
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Scheduled', { selector: 'span' })).toHaveLength(1);
    expect(screen.getAllByText('Processing', { selector: 'span' })).toHaveLength(1);
  });
});

describe('SentPage', () => {
  it('shows empty and error states', () => {
    mockedSent.mockReturnValue({ isPending: false, isError: false, data: [] } as never);
    const { unmount } = renderPage(<SentPage />);
    expect(screen.getByText(/no sent emails yet/i)).toBeInTheDocument();
    unmount();

    mockedSent.mockReturnValue({ isPending: false, isError: true, error: new Error('down'), refetch: vi.fn() } as never);
    renderPage(<SentPage />);
    expect(screen.getByText(/unable to load sent emails/i)).toBeInTheDocument();
  });

  it('renders sent rows newest-first data as given', () => {
    mockedSent.mockReturnValue({
      isPending: false,
      isError: false,
      data: [row({ id: 's-1', status: 'SENT', sentAt: '2026-09-28T11:00:00.000Z' })],
    } as never);
    renderPage(<SentPage />);
    expect(screen.getAllByText('Sent', { selector: 'span' })).toHaveLength(1);
  });
});
