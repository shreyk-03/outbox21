import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
}

function FieldShell({ label, error, hint, inputId, children }: FieldProps & { inputId: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ label, error, hint, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} inputId={inputId}>
      <input id={inputId} className={fieldClass} {...rest} />
    </FieldShell>
  );
}

export function Textarea({ label, error, hint, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} inputId={inputId}>
      <textarea id={inputId} className={fieldClass} {...rest} />
    </FieldShell>
  );
}

export function Select({
  label,
  error,
  hint,
  id,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} inputId={inputId}>
      <select id={inputId} className={fieldClass} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}
