import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmailTable } from './EmailTable';
import type { EmailListItem } from '../types/api';

const emails: EmailListItem[] = [
  {
    id: 'e-1',
    recipient: 'alice@example.com',
    subject: 'Hello Alice',
    scheduledAt: '2026-09-28T10:00:00.000Z',
    sentAt: null,
    status: 'SCHEDULED',
    attempts: 0,
    createdAt: '',
  },
  {
    id: 'e-2',
    recipient: 'bob@example.com',
    subject: 'Hello Bob',
    scheduledAt: '2026-09-28T10:05:00.000Z',
    sentAt: '2026-09-28T10:06:00.000Z',
    status: 'SENT',
    attempts: 1,
    createdAt: '',
  },
];

describe('EmailTable', () => {
  it('renders rows and notifies row selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EmailTable emails={emails} timeLabel="Scheduled" onSelect={onSelect} />);
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Scheduled', { selector: 'span' })).toHaveLength(1);
    expect(screen.getAllByText('Sent', { selector: 'span' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /hello bob/i }));
    expect(onSelect).toHaveBeenCalledWith('e-2');
  });
});
