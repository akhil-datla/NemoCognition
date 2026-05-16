import { Dashboard } from "@/components/dashboard/Dashboard";
import { demoRun } from "@/lib/demo-data";

export default function DashboardPage() {
  const runs = [demoRun];
  return <Dashboard runs={runs} />;
}
