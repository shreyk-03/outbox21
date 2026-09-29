import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ToastHost } from './components/Overlays';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { router } from './router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <ToastHost />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
