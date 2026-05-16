import Link from "next/link";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
import { demoRun, demoNodes, demoBranches, demoPolicyEvents } from "@/lib/demo-data";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const run = runId === "run_demo_001" ? demoRun : null;

  if (!run) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center">
          <p className="text-[var(--color-text-muted)] text-sm">Run not found: {runId}</p>
          <Link href="/runs" className="text-[var(--color-accent)] text-xs mt-2 block hover:underline">
            Back to sessions
          </Link>
        </div>
      </main>
    );
  }

  return (
    <ReplayPlayer
      runId={run.id}
      runTitle={run.title}
      nodes={demoNodes}
      branches={demoBranches}
      policyEvents={demoPolicyEvents}
    />
  );
}
