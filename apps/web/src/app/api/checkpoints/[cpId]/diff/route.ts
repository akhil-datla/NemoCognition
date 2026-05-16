import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { snapper, sandboxRootForRun } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DiffEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  snapshotSize: number | null;
  currentSize: number | null;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".cache"]);

async function walkLive(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  async function walk(dir: string, rel: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const d of dirents) {
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        await walk(path.join(dir, d.name), path.posix.join(rel, d.name));
      } else if (d.isFile()) {
        const abs = path.join(dir, d.name);
        const st = await fs.stat(abs);
        const key = path.posix.join(rel, d.name).replace(/^\.?\//, "");
        out.set(key, st.size);
      }
    }
  }
  await walk(root, "");
  return out;
}

/**
 * GET /api/checkpoints/:cpId/diff
 *
 * Compares the snapshot manifest against the live sandbox and returns a list
 * of changes that "Restore" would apply. Used to populate the confirmation
 * modal before any destructive action.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cpId: string }> },
) {
  const { cpId } = await params;
  const store = await getStore();
  const cp = await store.getCheckpoint(cpId);
  if (!cp) return NextResponse.json({ error: "Checkpoint not found" }, { status: 404 });
  if (!cp.diffRef) {
    return NextResponse.json(
      { error: "Checkpoint has no filesystem snapshot" },
      { status: 404 },
    );
  }
  const manifest = await snapper.readManifest(cp.diffRef);
  if (!manifest) {
    return NextResponse.json({ error: "Snapshot manifest missing" }, { status: 410 });
  }

  const sandboxRoot = manifest.sandboxRoot || sandboxRootForRun(cp.runId);
  const live = await walkLive(sandboxRoot);
  const snap = new Map<string, number>(manifest.files.map((f) => [f.path, f.size]));

  const entries: DiffEntry[] = [];
  const seen = new Set<string>();

  for (const [p, size] of snap) {
    seen.add(p);
    const liveSize = live.get(p);
    if (liveSize === undefined) {
      entries.push({ path: p, status: "added", snapshotSize: size, currentSize: null });
    } else if (liveSize !== size) {
      entries.push({ path: p, status: "modified", snapshotSize: size, currentSize: liveSize });
    } else {
      entries.push({ path: p, status: "unchanged", snapshotSize: size, currentSize: liveSize });
    }
  }
  for (const [p, size] of live) {
    if (!seen.has(p)) {
      entries.push({ path: p, status: "deleted", snapshotSize: null, currentSize: size });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const summary = entries.reduce(
    (acc, e) => {
      acc[e.status] += 1;
      return acc;
    },
    { added: 0, modified: 0, deleted: 0, unchanged: 0 } as Record<DiffEntry["status"], number>,
  );

  return NextResponse.json({
    cpId,
    sandboxRoot,
    summary,
    entries,
  });
}
