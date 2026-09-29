import { useEffect, type ReactNode } from 'react';
import { useToasts } from '../context/ToastContext';

const KIND_STYLES = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
} as const;

export function ToastHost() {
  const { toasts, dismissToast } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-md ${KIND_STYLES[t.kind]}`}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="rounded px-1 font-bold opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-2"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
