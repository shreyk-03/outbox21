import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmailDetailModal } from '../components/EmailDetailModal';
import { EmailTable } from '../components/EmailTable';
import { TableSkeleton } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';
import { useScheduledEmails, useSentEmails } from '../hooks/queries';
import { apiErrorMessage } from '../services/api';

function useSelectedEmail() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return {
    selectedId,
    open: (id: string) => setSelectedId(id),
    close: () => setSelectedId(null),
  };
}

export function ScheduledPage() {
  const query = useScheduledEmails();
  const selected = useSelectedEmail();

  if (query.isPending) return <TableSkeleton />;
  if (query.isError)
    return (
      <ErrorState
        message={apiErrorMessage(query.error, 'Unable to load scheduled emails.')}
        onRetry={() => query.refetch()}
      />
    );
  if (query.data.length === 0)
    return (
      <EmptyState
        title="No scheduled emails yet."
        body="Compose your first campaign and it will appear here once queued."
        action={
          <Link to="/dashboard/compose" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Compose email
          </Link>
        }
      />
    );
  return (
    <>
      <EmailTable emails={query.data} timeLabel="Scheduled" onSelect={selected.open} />
      <EmailDetailModal emailId={selected.selectedId} onClose={selected.close} />
    </>
  );
}

export function SentPage() {
  const query = useSentEmails();
  const selected = useSelectedEmail();

  if (query.isPending) return <TableSkeleton />;
  if (query.isError)
    return <ErrorState message={apiErrorMessage(query.error, 'Unable to load sent emails.')} onRetry={() => query.refetch()} />;
  if (query.data.length === 0)
    return <EmptyState title="No sent emails yet." body="Delivered emails will show up here, newest first." />;
  return (
    <>
      <EmailTable emails={query.data} timeLabel="Sent" onSelect={selected.open} />
      <EmailDetailModal emailId={selected.selectedId} onClose={selected.close} />
    </>
  );
}
