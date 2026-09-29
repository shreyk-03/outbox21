import { useEmailDetail } from '../hooks/queries';
import { formatDateTime } from '../utils/format';
import { Modal } from './Overlays';
import { Spinner } from './Spinner';
import { ErrorState } from './States';
import { StatusBadge } from './StatusBadge';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-sm">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="col-span-2 break-words text-slate-900">{value}</dd>
    </div>
  );
}

export function EmailDetailModal({ emailId, onClose }: { emailId: string | null; onClose: () => void }) {
  const detail = useEmailDetail(emailId);
  if (emailId === null) return null;
  return (
    <Modal title="Email details" onClose={onClose}>
      {detail.isPending ? (
        <Spinner label="Loading email…" />
      ) : detail.isError ? (
        <ErrorState message="Unable to load this email. It may have been removed." onRetry={() => detail.refetch()} />
      ) : (
        <dl className="divide-y divide-slate-100">
          <Row label="Recipient" value={detail.data.recipient} />
          <Row label="Subject" value={detail.data.subject} />
          <div className="grid grid-cols-3 gap-2 py-2 text-sm">
            <dt className="font-medium text-slate-500">Status</dt>
            <dd className="col-span-2">
              <StatusBadge status={detail.data.status} />
            </dd>
          </div>
          <Row label="Scheduled" value={formatDateTime(detail.data.scheduledAt)} />
          <Row label="Sent" value={formatDateTime(detail.data.sentAt)} />
          {detail.data.errorMessage ? <Row label="Error" value={detail.data.errorMessage} /> : null}
          <div className="py-2">
            <dt className="mb-1 text-sm font-medium text-slate-500">Body</dt>
            <dd className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-900">{detail.data.body}</dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}
