import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  pushToast: () => undefined,
  dismissToast: () => undefined,
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
      setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast],
  );

  return <ToastContext.Provider value={{ toasts, pushToast, dismissToast }}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastContextValue {
  return useContext(ToastContext);
}
