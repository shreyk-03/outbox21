import type { EmailListItem } from '../types/api';
import { formatDateTime } from '../utils/format';
import { StatusBadge } from './StatusBadge';

export function EmailTable({
  emails,
  timeLabel,
  onSelect,
}: {
  emails: EmailListItem[];
  timeLabel: 'Scheduled' | 'Sent';
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium text-slate-500">
              Recipient
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-slate-500">
              Subject
            </th>
            <th scope="col" className="hidden px-4 py-3 text-left font-medium text-slate-500 md:table-cell">
              {timeLabel}
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-slate-500">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {emails.map((email) => (
            <tr key={email.id} className="hover:bg-slate-50">
              <td className="max-w-[12rem] truncate px-4 py-3 font-medium text-slate-900">{email.recipient}</td>
              <td className="max-w-[16rem] truncate px-4 py-3 text-slate-600">
                <button
                  onClick={() => onSelect(email.id)}
                  className="truncate text-left underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  title="View details"
                >
                  {email.subject}
                </button>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-slate-500 md:table-cell">
                {formatDateTime(timeLabel === 'Sent' ? email.sentAt : email.scheduledAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <StatusBadge status={email.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
