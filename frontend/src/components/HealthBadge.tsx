import { useHealth } from '../hooks/useHealth';

export function HealthBadge() {
  const { data, isLoading, isError } = useHealth();
  if (isLoading) return <span className="text-sm text-gray-500">Checking backend…</span>;
  if (isError || !data) return <span className="text-sm text-red-600">Backend unreachable</span>;
  return (
    <span className="text-sm text-gray-600">
      Backend: {data.status} · redis: {data.redis} · db: {data.database}
    </span>
  );
}
