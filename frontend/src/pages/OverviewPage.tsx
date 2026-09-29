import { Link } from 'react-router-dom';
import { useScheduledEmails, useSenders, useSentEmails, useSlackStatus } from '../hooks/queries';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { useToasts } from '../context/ToastContext';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function OverviewPage() {
  const scheduled = useScheduledEmails();
  const sent = useSentEmails();
  const senders = useSenders();
  const slack = useSlackStatus();
  const [params, setParams] = useSearchParams();
  const { pushToast } = useToasts();

  const slackFlag = params.get('slack');

  useEffect(() => {
    if (slackFlag === 'connected') {
      pushToast('success', 'Slack workspace connected.');
      setParams({}, { replace: true });
    } else if (slackFlag === 'error') {
      pushToast('error', 'Slack connection failed. Please try again.');
      setParams({}, { replace: true });
    }
  }, [slackFlag, pushToast, setParams]);

  if (scheduled.isPending || sent.isPending || senders.isPending || slack.isPending) {
    return <Spinner label="Loading overview…" />;
  }
  if (scheduled.isError || sent.isError || senders.isError || slack.isError) {
    return (
      <ErrorState
        message="Unable to load dashboard data. Please check your connection and try again."
        onRetry={() => {
          scheduled.refetch();
          sent.refetch();
          senders.refetch();
          slack.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Scheduled" value={String(scheduled.data.length)} hint="Waiting to send" />
        <StatCard label="Sent" value={String(sent.data.length)} hint="Delivered via worker" />
        <StatCard label="Senders" value={String(senders.data.length)} hint="Verified identities" />
        <StatCard
          label="Slack"
          value={slack.data.connected ? 'On' : 'Off'}
          hint={slack.data.connected ? slack.data.teamName ?? 'Connected' : 'Not connected'}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Next up</h2>
          {scheduled.data.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing scheduled yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {scheduled.data.slice(0, 5).map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span className="truncate text-slate-700">{e.recipient}</span>
                  <span className="shrink-0 text-slate-400">{e.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/dashboard/scheduled" className="mt-3 inline-block text-sm font-medium text-slate-900 underline">
            View scheduled
          </Link>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Get started</h2>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <Link to="/dashboard/compose" className="rounded-md bg-slate-900 px-4 py-2 text-center font-medium text-white hover:bg-slate-700">
              Compose new email
            </Link>
            <Link to="/dashboard/slack" className="rounded-md border border-slate-300 px-4 py-2 text-center font-medium hover:bg-slate-50">
              Connect Slack for rate-limit alerts
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
