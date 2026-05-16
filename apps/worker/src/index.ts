import { InMemoryStore, PostgresStore, createClient, type Store } from "@nemocognition/db";
import { processPendingVideoJobs } from "./video-jobs";

async function bootstrapStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { db } = createClient(url);
    const store = new PostgresStore(db);
    const ok = await store.ping();
    if (!ok) throw new Error("Postgres ping failed — check DATABASE_URL");
    console.log("[worker] connected to Postgres");
    return store;
  }
  console.log("[worker] no DATABASE_URL set — running with InMemoryStore (jobs will not persist)");
  return new InMemoryStore();
}

async function main() {
  const store = await bootstrapStore();
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
  console.log(`[worker] polling every ${intervalMs}ms`);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] received ${sig}, draining...`);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!shuttingDown) {
    try {
      const result = await processPendingVideoJobs(store);
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[worker] processed=${result.processed} failed=${result.failed}`);
      }
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log("[worker] exited cleanly");
  process.exit(0);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
