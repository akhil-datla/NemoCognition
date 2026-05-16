import Link from "next/link";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
import { demoRun, demoNodes, demoBranches, demoPolicyEvents } from "@/lib/demo-data";
import { getStore } from "@/lib/store-factory";

export const dynamic = "force-dynamic";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  if (runId === demoRun.id) {
    return (
      <ReplayPlayer
        runId={demoRun.id}
        runTitle={demoRun.title}
        nodes={demoNodes}
        branches={demoBranches}
        policyEvents={demoPolicyEvents}
      />
    );
  }

  const store = await getStore();
  const run = await store.getRun(runId);
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

  const nodes = (await store.getRunNodes(runId)).sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const branches = await store.getRunBranches(runId);
  const policyEvents = await store.getRunPolicyDecisions(runId);

  return (
    <ReplayPlayer
      runId={run.id}
      runTitle={run.title}
      nodes={nodes}
      branches={branches}
      policyEvents={policyEvents}
    />
  );
}
