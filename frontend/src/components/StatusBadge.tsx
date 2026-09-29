import type { EmailStatus } from '../types/api';

const STYLES: Record<EmailStatus, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SENT: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
};

const LABELS: Record<EmailStatus, string> = {
  SCHEDULED: 'Scheduled',
  PROCESSING: 'Processing',
  SENT: 'Sent',
  FAILED: 'Failed',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
