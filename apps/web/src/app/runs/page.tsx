import { Dashboard } from "@/components/dashboard/Dashboard";
import { demoRun } from "@/lib/demo-data";
import { getStore } from "@/lib/store-factory";
import type { Run } from "@nemocognition/core";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const store = await getStore();
  const stored = await store.getAllRuns();
  const all: Run[] = [...stored];
  // Always include the canonical demo run so fresh environments aren't empty.
  if (!stored.find((r) => r.id === demoRun.id)) {
    all.push(demoRun);
  }
  all.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return <Dashboard runs={all} />;
}
