export function LoginPage() {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-bold">ReachInbox</h1>
      <p className="mt-2 text-gray-600">Google OAuth lands in Phase 3.</p>
      <button
        className="mt-6 w-full rounded bg-black px-4 py-2 text-white opacity-50"
        disabled
        title="Coming in Phase 3"
      >
        Continue with Google (Phase 3)
      </button>
    </div>
  );
}
