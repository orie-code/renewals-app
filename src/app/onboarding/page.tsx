import { cached } from "@/lib/cache";
import { fetchOnboardingBoard } from "@/lib/onboarding";
import OnboardingView from "./OnboardingView";

export const dynamic = "force-dynamic";
// Vercel: allow up to 60s — the cross-referenced fetch exceeds the 10s default.
export const maxDuration = 60;

const TTL_MS = 10 * 60 * 1000;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { refresh?: string };
}) {
  try {
    const board = await cached("onboarding-board", TTL_MS, fetchOnboardingBoard, {
      bypass: searchParams.refresh === "1",
    });
    return <OnboardingView board={board} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <main className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Onboarding</h1>
        <div className="rounded border border-red-200 bg-red-50 text-red-800 p-4">
          <div className="font-medium mb-1">Failed to load data</div>
          <pre className="text-xs whitespace-pre-wrap">{message}</pre>
        </div>
      </main>
    );
  }
}
