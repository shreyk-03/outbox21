import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { useDisconnectSlack, useSlackStatus } from '../hooks/queries';
import { useToasts } from '../context/ToastContext';
import { apiErrorMessage, startSlackConnect } from '../services/api';

export function SlackPage() {
  const status = useSlackStatus();
  const disconnect = useDisconnectSlack();
  const { pushToast } = useToasts();

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync();
      pushToast('success', 'Slack disconnected.');
    } catch (err) {
      pushToast('error', apiErrorMessage(err, 'Unable to disconnect Slack.'));
    }
  }

  if (status.isPending) return <Spinner label="Checking Slack connection…" />;
  if (status.isError)
    return (
      <ErrorState
        message={apiErrorMessage(status.error, 'Unable to check Slack status.')}
        onRetry={() => status.refetch()}
      />
    );

  return (
    <div className="w-full max-w-2xl space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">Slack integration</h2>
      <p className="text-sm text-slate-600">
        When a sender hits its hourly email limit, ReachInbox posts a single alert to your workspace and reschedules
        the remaining emails.
      </p>
      {status.data.connected ? (
        <div className="space-y-3">
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Connected{status.data.teamName ? ` to ${status.data.teamName}` : ''}.
          </p>
          <Button variant="danger" onClick={handleDisconnect} disabled={disconnect.isPending}>
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Slack'}
          </Button>
        </div>
      ) : (
        <Button onClick={startSlackConnect}>Connect Slack</Button>
      )}
    </div>
  );
}
