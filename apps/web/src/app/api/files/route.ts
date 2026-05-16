import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSandboxRoot, setSandboxRoot, defaultSandboxRoot } from "@/lib/sandbox-registry";
import { getStore } from "@/lib/store-factory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_READ_BYTES = 200 * 1024;
const MAX_ENTRIES = 500;

async function rootForRun(runId: string | null): Promise<{ root: string; runScoped: boolean }> {
  if (runId) {
    const fromRegistry = getSandboxRoot(runId);
    if (fromRegistry) return { root: fromRegistry, runScoped: true };
    try {
      const store = await getStore();
      const run = await store.getRun(runId);
      if (run?.sandboxRoot) {
        // Warm the in-memory map so subsequent requests skip the DB hit.
        setSandboxRoot(runId, run.sandboxRoot);
        return { root: path.resolve(run.sandboxRoot), runScoped: true };
      }
    } catch {
      /* store may be unavailable in some setups — fall through to default */
    }
  }
  return { root: defaultSandboxRoot(), runScoped: false };
}

function resolveSafe(root: string, requested: string): { absolute: string; relative: string } | null {
  const cleaned = requested.replace(/^\/+/, "");
  const absolute = path.resolve(root, cleaned || ".");
  const rel = path.relative(root, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { absolute, relative: rel === "" ? "." : rel };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("path") ?? ".";
  const runId = url.searchParams.get("runId");
  const { root, runScoped } = await rootForRun(runId);
  const resolved = resolveSafe(root, requested);
  if (!resolved) {
    return NextResponse.json({ error: "Path escapes sandbox" }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(resolved.absolute);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Not found: ${msg}` }, { status: 404 });
  }

  if (stat.isDirectory()) {
    const dirents = await fs.readdir(resolved.absolute, { withFileTypes: true });
    const sorted = dirents
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? ("dir" as const) : d.isFile() ? ("file" as const) : ("other" as const),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return NextResponse.json({
      kind: "directory",
      path: resolved.relative,
      entries: sorted.slice(0, MAX_ENTRIES),
      total: sorted.length,
      truncated: sorted.length > MAX_ENTRIES,
      root,
      runScoped,
    });
  }

  if (stat.isFile()) {
    const fd = await fs.open(resolved.absolute, "r");
    try {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
      const slice = buf.subarray(0, bytesRead);
      const isBinary = slice.includes(0);
      return NextResponse.json({
        kind: "file",
        path: resolved.relative,
        content: isBinary ? null : slice.toString("utf8"),
        binary: isBinary,
        bytes: stat.size,
        truncated: stat.size > MAX_READ_BYTES,
        root,
        runScoped,
      });
    } finally {
      await fd.close();
    }
  }

  return NextResponse.json({ error: "Unsupported entry type" }, { status: 400 });
}
