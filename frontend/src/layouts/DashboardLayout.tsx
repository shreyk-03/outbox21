import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SearchBar } from '../components/SearchBar';

const NAV = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/scheduled', label: 'Scheduled' },
  { to: '/dashboard/sent', label: 'Sent' },
  { to: '/dashboard/compose', label: 'Compose' },
  { to: '/dashboard/slack', label: 'Slack' },
];

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/scheduled': 'Scheduled emails',
  '/dashboard/sent': 'Sent emails',
  '/dashboard/compose': 'Compose email',
  '/dashboard/slack': 'Slack integration',
  '/dashboard/search': 'Search results',
};

function navClass(active: boolean): string {
  return `block rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;
}

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const title = TITLES[location.pathname] ?? 'ReachInbox';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'fixed inset-y-0 left-0 z-30 w-64 translate-x-0' : 'hidden'
          } flex-col border-r border-slate-200 bg-white p-4 transition-transform md:static md:flex md:w-60 md:translate-x-0`}
          aria-label="Primary navigation"
        >
          <div className="mb-6 flex items-center justify-between">
            <span className="text-lg font-bold">ReachInbox</span>
            <button
              className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 md:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            >
              ×
            </button>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => navClass(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto border-t border-slate-200 pt-4">
            <div className="flex items-center gap-2">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm">
                  {(user?.name ?? '?').slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              Logout
            </button>
          </div>
        </aside>
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-20 bg-slate-900/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                ☰
              </button>
              <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
              <div className="hidden w-64 sm:block">
                <SearchBar compact />
              </div>
            </div>
            <div className="mt-2 sm:hidden">
              <SearchBar compact />
            </div>
          </header>
          <main className="flex-1 px-4 py-4 md:px-8 md:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
