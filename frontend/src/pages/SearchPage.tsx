import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmailDetailModal } from '../components/EmailDetailModal';
import { EmailTable } from '../components/EmailTable';
import { TableSkeleton } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useEmailSearch } from '../hooks/queries';
import { apiErrorMessage } from '../services/api';

export function SearchPage() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(input, 400);
  const query = useEmailSearch(debounced);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="w-full max-w-2xl">
        <label htmlFor="search-input" className="sr-only">
          Search emails
        </label>
        <div className="flex gap-2">
          <input
            id="search-input"
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search recipient, subject, body…"
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {input ? (
            <button
              type="button"
              onClick={() => setInput('')}
              className="rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50"
            >
              Clear search
            </button>
          ) : null}
        </div>
      </form>

      {debounced.trim() === '' ? (
        <EmptyState title="Search your emails." body="Type a recipient, subject, or keyword above. Results come from the server search index." />
      ) : query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={apiErrorMessage(query.error, 'Search failed. Please try again.')} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState title="No matching emails found." body={`Nothing matched "${debounced.trim()}".`} />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {query.data.length} result{query.data.length === 1 ? '' : 's'} for “{debounced.trim()}”
          </p>
          <EmailTable emails={query.data} timeLabel="Scheduled" onSelect={setSelectedId} />
          <EmailDetailModal emailId={selectedId} onClose={() => setSelectedId(null)} />
        </>
      )}
    </div>
  );
}
