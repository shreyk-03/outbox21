import { useSearchParams } from 'react-router-dom';
import { startGoogleLogin } from '../services/api';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Google sign-in failed. Please try again.',
  account_conflict: 'This email is already associated with a different sign-in method.',
};

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">ReachInbox</h1>
      <p className="mt-2 text-gray-600">Sign in to schedule and track your outreach emails.</p>
      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.'}
        </div>
      )}
      <button
        onClick={startGoogleLogin}
        className="mt-6 w-full rounded bg-black px-4 py-2 text-white hover:bg-gray-800"
      >
        Continue with Google
      </button>
    </div>
  );
}
