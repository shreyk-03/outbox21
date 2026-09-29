import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RedirectIfAuthenticated, RequireAuth } from '../components/ProtectedRoute';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { ComposePage } from '../pages/ComposePage';
import { ScheduledPage, SentPage } from '../pages/EmailListPages';
import { LoginPage } from '../pages/LoginPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SearchPage } from '../pages/SearchPage';
import { SlackPage } from '../pages/SlackPage';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    path: '/login',
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <RequireAuth>
        <DashboardLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'scheduled', element: <ScheduledPage /> },
      { path: 'sent', element: <SentPage /> },
      { path: 'compose', element: <ComposePage /> },
      { path: 'slack', element: <SlackPage /> },
      { path: 'search', element: <SearchPage /> },
    ],
  },
]);
