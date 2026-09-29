import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Input, Select, Textarea } from '../components/Fields';
import { FileUploader, type FileParseResult } from '../components/FileUploader';
import { Spinner } from '../components/Spinner';
import { useCreateSender, useScheduleBulk, useSenders } from '../hooks/queries';
import { useToasts } from '../context/ToastContext';
import { apiErrorMessage } from '../services/api';
import type { ScheduleBulkResult } from '../types/api';
import { defaultStartTimeLocal, formatDateTime, localInputToIso } from '../utils/format';
import { parseRecipientText, type ParsedRecipients } from '../utils/recipients';

const DELAY_PRESETS = [
  { label: '2 sec', value: 2000 },
  { label: '5 sec', value: 5000 },
  { label: '10 sec', value: 10_000 },
  { label: '30 sec', value: 30_000 },
  { label: '1 min', value: 60_000 },
];

type Mode = 'manual' | 'file';

export function ComposePage() {
  const sendersQuery = useSenders();
  const schedule = useScheduleBulk();
  const createSender = useCreateSender();
  const { pushToast } = useToasts();

  const [senderId, setSenderId] = useState('');
  const [showNewSender, setShowNewSender] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newLimit, setNewLimit] = useState('200');
  const [mode, setMode] = useState<Mode>('manual');
  const [manualText, setManualText] = useState('');
  const [fileResult, setFileResult] = useState<FileParseResult | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startLocal, setStartLocal] = useState(defaultStartTimeLocal);
  const [delayMs, setDelayMs] = useState<number>(2000);
  const [customDelay, setCustomDelay] = useState('2000');
  const [useCustomDelay, setUseCustomDelay] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ScheduleBulkResult | null>(null);

  const recipients: ParsedRecipients = useMemo(
    () => (mode === 'file' && fileResult ? fileResult : parseRecipientText(manualText)),
    [mode, fileResult, manualText],
  );

  const selectedSender = sendersQuery.data?.find((s) => s.id === senderId);
  const effectiveDelay = useCustomDelay ? Number(customDelay) : delayMs;

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!senderId) errors.sender = 'Choose a sender.';
    if (!subject.trim()) errors.subject = 'Subject is required.';
    if (!body.trim()) errors.body = 'Body is required.';
    if (Number.isNaN(new Date(startLocal).getTime())) errors.start = 'Start time must be a valid date.';
    if (!Number.isInteger(effectiveDelay) || effectiveDelay < 0 || effectiveDelay > 3_600_000)
      errors.delay = 'Delay must be between 0 ms and 1 hour.';
    if (recipients.valid.length === 0) errors.recipients = 'Add at least one valid recipient.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!validate()) return;
    try {
      const res = await schedule.mutateAsync({
        senderId,
        subject: subject.trim(),
        body,
        scheduledAt: localInputToIso(startLocal),
        delayMs: effectiveDelay,
        recipients: recipients.valid,
      });
      setResult(res);
      pushToast('success', `${res.scheduled} email(s) scheduled.`);
    } catch (err) {
      pushToast('error', apiErrorMessage(err, 'Unable to schedule emails.'));
    }
  }

  async function handleCreateSender(e: React.FormEvent) {
    e.preventDefault();
    try {
      const sender = await createSender.mutateAsync({
        email: newEmail.trim(),
        name: newName.trim(),
        hourlyLimit: Number(newLimit),
      });
      setSenderId(sender.id);
      setShowNewSender(false);
      setNewEmail('');
      setNewName('');
      pushToast('success', `Sender ${sender.email} created.`);
    } catch (err) {
      pushToast('error', apiErrorMessage(err, 'Unable to create sender.'));
    }
  }

  if (sendersQuery.isPending) return <Spinner label="Loading senders…" />;
  if (sendersQuery.isError)
    return (
      <p role="alert" className="text-sm text-red-600">
        Unable to load senders.{' '}
        <button className="underline" onClick={() => sendersQuery.refetch()}>
          Try again
        </button>
      </p>
    );

  if (result) {
    return (
      <div className="w-full max-w-2xl space-y-3 rounded-lg border border-green-200 bg-green-50 p-6" role="status">
        <h2 className="text-lg font-semibold text-green-900">Scheduled successfully</h2>
        <dl className="space-y-1 text-sm text-green-900">
          <div className="flex justify-between"><dt>Emails scheduled</dt><dd className="font-semibold">{result.scheduled}</dd></div>
          <div className="flex justify-between"><dt>Duplicates skipped</dt><dd className="font-semibold">{result.duplicatesRemoved}</dd></div>
          <div className="flex justify-between"><dt>Earliest send</dt><dd className="font-semibold">{formatDateTime(result.startTime)}</dd></div>
          <div className="flex justify-between"><dt>Subject</dt><dd className="max-w-56 truncate font-semibold">{subject.trim()}</dd></div>
        </dl>
        <div className="flex gap-2 pt-2">
          <Link to="/dashboard/scheduled" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            View scheduled
          </Link>
          <Button variant="secondary" onClick={() => setResult(null)}>
            Schedule more
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-5xl space-y-6" noValidate>
      <div className="space-y-2">
        <Select
          label="Sender"
          value={senderId}
          onChange={(e) => {
            setSenderId(e.target.value);
            setFieldErrors((p) => ({ ...p, sender: '' }));
          }}
          error={fieldErrors.sender || undefined}
          hint={selectedSender ? `Hourly limit enforced by server: ${selectedSender.hourlyLimit}/hour` : undefined}
        >
          <option value="">Select a sender…</option>
          {sendersQuery.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ‹{s.email}›
            </option>
          ))}
        </Select>
        {showNewSender ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
            <Input label="Sender email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@company.com" />
            <Input label="Display name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme News" />
            <Input label="Hourly limit" type="number" min={1} value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowNewSender(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSender} disabled={createSender.isPending}>
                {createSender.isPending ? 'Creating…' : 'Create sender'}
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setShowNewSender(true)} className="text-sm text-slate-700 underline">
            + New sender
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div role="group" aria-label="Recipient input mode" className="flex gap-2 text-sm">
          {(['manual', 'file'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-md border px-3 py-1.5 font-medium ${mode === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
            >
              {m === 'manual' ? 'Type addresses' : 'Upload file'}
            </button>
          ))}
        </div>
        {mode === 'manual' ? (
          <Textarea
            label="Recipients"
            rows={6}
            value={manualText}
            onChange={(e) => {
              setManualText(e.target.value);
              setFieldErrors((p) => ({ ...p, recipients: '' }));
            }}
            placeholder={'alice@example.com\nbob@example.com'}
            hint="One per line; commas work too."
            error={fieldErrors.recipients || undefined}
          />
        ) : (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Recipient file</span>
            <FileUploader onParsed={setFileResult} onClear={() => setFileResult(null)} />
            {fieldErrors.recipients ? (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors.recipients}
              </p>
            ) : null}
          </div>
        )}
        <p aria-live="polite" className="text-sm text-slate-600">
          Recipients: <strong>{recipients.valid.length}</strong>
          {recipients.invalid.length > 0 ? <span className="text-red-600"> · {recipients.invalid.length} invalid</span> : null}
          {recipients.duplicatesRemoved > 0 ? <span> · {recipients.duplicatesRemoved} duplicate(s) removed</span> : null}
        </p>
        {recipients.invalid.length > 0 ? (
          <p className="max-w-full truncate text-xs text-slate-500">Invalid: {recipients.invalid.slice(0, 5).join(', ')}{recipients.invalid.length > 5 ? '…' : ''}</p>
        ) : null}
      </div>

      <Input
        label="Subject"
        value={subject}
        onChange={(e) => {
          setSubject(e.target.value);
          setFieldErrors((p) => ({ ...p, subject: '' }));
        }}
        placeholder="Hello from ReachInbox"
        error={fieldErrors.subject || undefined}
      />
      <Textarea
        label="Body"
        rows={10}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setFieldErrors((p) => ({ ...p, body: '' }));
        }}
        placeholder="Write your message…"
        error={fieldErrors.body || undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Start time"
          type="datetime-local"
          value={startLocal}
          onChange={(e) => {
            setStartLocal(e.target.value);
            setFieldErrors((p) => ({ ...p, start: '' }));
          }}
          hint="Your local time. Past times send immediately."
          error={fieldErrors.start || undefined}
        />
        <div>
          <span id="delay-label" className="mb-1 block text-sm font-medium text-slate-700">
            Delay between emails
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="delay-label">
            {DELAY_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  setUseCustomDelay(false);
                  setDelayMs(p.value);
                  setFieldErrors((f) => ({ ...f, delay: '' }));
                }}
                aria-pressed={!useCustomDelay && delayMs === p.value}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${!useCustomDelay && delayMs === p.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setUseCustomDelay(true)}
              aria-pressed={useCustomDelay}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${useCustomDelay ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
            >
              Custom
            </button>
          </div>
          {useCustomDelay ? (
            <input
              type="number"
              min={0}
              max={3600000}
              value={customDelay}
              onChange={(e) => {
                setCustomDelay(e.target.value);
                setFieldErrors((f) => ({ ...f, delay: '' }));
              }}
              aria-label="Custom delay in milliseconds"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          ) : null}
          {fieldErrors.delay ? (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.delay}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Server enforces spacing and hourly limits.</p>
          )}
        </div>
      </div>

      <Button type="submit" disabled={schedule.isPending} className="w-full sm:w-auto">
        {schedule.isPending ? 'Scheduling…' : `Schedule ${recipients.valid.length} email${recipients.valid.length === 1 ? '' : 's'}`}
      </Button>
    </form>
  );
}
