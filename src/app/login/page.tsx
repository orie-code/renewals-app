export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const next = searchParams.next ?? "/renewals";
  const error = searchParams.error;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        action="/api/login"
        method="POST"
        className="bg-white rounded border border-gray-200 p-6 w-full max-w-sm space-y-4"
      >
        <h1 className="text-lg font-semibold">Renewals dashboard</h1>
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="text-sm text-gray-600">Password</span>
          <input
            name="password"
            type="password"
            autoFocus
            required
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </label>
        {error === "invalid" && (
          <div className="text-sm text-red-700">Incorrect password.</div>
        )}
        {error === "misconfigured" && (
          <div className="text-sm text-red-700">
            App misconfigured: <code>SHARED_PASSWORD</code> env var is not set.
          </div>
        )}
        <button
          type="submit"
          className="w-full rounded bg-gray-900 text-white py-2 text-sm font-medium hover:bg-gray-800"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
