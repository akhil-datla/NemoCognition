import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("migrations", () => {
  it("apply cleanly to an empty database", async () => {
    const pg = new PGlite();
    const drizzleDir = resolve(__dirname, "..", "drizzle");
    const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const ddl = readFileSync(resolve(drizzleDir, file), "utf8");
      const statements = ddl.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await pg.exec(stmt);
      }
    }

    // Verify the expected tables exist.
    const result = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = result.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "audit_events",
        "branches",
        "checkpoints",
        "execution_nodes",
        "policy_decisions",
        "runs",
        "trace_span_refs",
        "validation_results",
        "video_jobs",
      ]),
    );
  });
});
