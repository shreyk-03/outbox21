import { HealthBadge } from '../components/HealthBadge';

export function DashboardPage() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">ReachInbox</h1>
      <p className="mt-2 text-gray-600">Phase 1 scaffold — backend health check.</p>
      <div className="mt-4 rounded border p-4">
        <HealthBadge />
      </div>
    </div>
  );
}
