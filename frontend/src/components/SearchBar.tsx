import { useNavigate } from 'react-router-dom';

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const q = String(data.get('q') ?? '').trim();
    if (q) navigate(`/dashboard/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className={compact ? '' : 'max-w-md'}>
      <label htmlFor={compact ? 'header-search' : 'page-search'} className="sr-only">
        Search emails
      </label>
      <input
        id={compact ? 'header-search' : 'page-search'}
        name="q"
        type="search"
        placeholder="Search recipient, subject…"
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
    </form>
  );
}
