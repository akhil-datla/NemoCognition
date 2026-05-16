import { store as inMemoryStore, PostgresStore, createClient, type Store } from "@nemocognition/db";

const GLOBAL_KEY = "__nemocognition_store_singleton__";

interface StoreSlot {
  store: Store;
  kind: "postgres" | "in-memory";
}

const g = globalThis as unknown as Record<string, StoreSlot | undefined>;

export async function getStore(): Promise<Store> {
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!.store;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.length > 0) {
    const { db } = createClient(databaseUrl);
    const store = new PostgresStore(db);
    g[GLOBAL_KEY] = { store, kind: "postgres" };
    return store;
  }

  g[GLOBAL_KEY] = { store: inMemoryStore, kind: "in-memory" };
  return inMemoryStore;
}

export function getStoreKind(): "postgres" | "in-memory" | "uninitialized" {
  return g[GLOBAL_KEY]?.kind ?? "uninitialized";
}
