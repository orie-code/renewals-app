import { loadRenewals } from "@/lib/renewals";
import RenewalsView from "./RenewalsView";

export const dynamic = "force-dynamic";

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: { refresh?: string };
}) {
  try {
    const accounts = await loadRenewals({ refresh: searchParams.refresh === "1" });
    return <RenewalsView accounts={accounts} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <main className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Renewals</h1>
        <div className="rounded border border-red-200 bg-red-50 text-red-800 p-4">
          <div className="font-medium mb-1">Failed to load data</div>
          <pre className="text-xs whitespace-pre-wrap">{message}</pre>
        </div>
      </main>
    );
  }
}
