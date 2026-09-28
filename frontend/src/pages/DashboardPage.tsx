import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HealthBadge } from '../components/HealthBadge';

export function DashboardHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="flex items-center justify-between border-b pb-4">
      <span className="text-xl font-bold">ReachInbox</span>
      <div className="flex items-center gap-3">
        {user?.avatarUrl && (
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
        )}
        <div className="text-right">
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="text-xs text-gray-500">{user?.email}</div>
        </div>
        <button
          onClick={handleLogout}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-100"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

export function DashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-8">
      <DashboardHeader />
      <p className="text-gray-600">Email scheduling lands in Phase 4. Your account is connected.</p>
      <div className="rounded border p-4">
        <HealthBadge />
      </div>
    </div>
  );
}
