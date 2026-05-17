import { NextResponse } from "next/server";
import { getStore } from "@/lib/store-factory";
import { snapper } from "@/lib/snapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/checkpoints/:cpId/tree
 *
 * Returns the file manifest of the snapshot referenced by checkpoint `cpId`.
 *
 * By default returns only files **that the agent directly modified at this
 * node** — the diff against the previous checkpoint on the same branch.
 * This filters out NemoClaw / OpenClaw housekeeping files (agent sessions,
 * trajectories, configs) that are present in every snapshot.
 *
 * Pass `?diff=false` to return the full manifest (every file in the snapshot)
 * — useful for the final node where seeing the entire workspace is more
 * informative than seeing the last delta.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ cpId: string }> },
) {
  const { cpId } = await params;
  const url = new URL(req.url);
  const wantDiff = url.searchParams.get("diff") !== "false";

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
    return NextResponse.json(
      { error: "Snapshot manifest not found on disk", artifactPath: cp.diffRef },
      { status: 410 },
    );
  }

  // Always diff against the run's BASELINE snapshot — the first manual
  // checkpoint taken at run start. That gives "everything this session
  // contributed" rather than the per-step delta, which is what operators
  // actually want to see when inspecting a checkpoint. The Codebase tab
  // shows the agent's cumulative codebase, filtered to workspace files.
  let diffFiles: typeof manifest.files = wantDiff ? [] : manifest.files;
  let previousCpId: string | null = null;
  const changeKind: Record<string, "added" | "modified" | "removed"> = {};
  if (wantDiff) {
    const allCps = await store.getRunBranchCheckpoints(cp.runId, cp.branchId);
    // Use the chronologically-first checkpoint with a snapshot as the
    // baseline reference. If the current checkpoint IS that baseline, skip
    // the diff entirely — there's nothing to compare against.
    const sortedCps = allCps
      .filter((c) => c.diffRef)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const isBaseline = sortedCps[0]?.id === cp.id;
    const prev = isBaseline ? undefined : sortedCps[0];
    if (prev && prev.diffRef) {
      const prevManifest = await snapper.readManifest(prev.diffRef);
      if (prevManifest) {
        previousCpId = prev.id;
        const prevByPath = new Map(prevManifest.files.map((f) => [f.path, f]));
        const currByPath = new Map(manifest.files.map((f) => [f.path, f]));
        const added: typeof manifest.files = [];
        const modified: typeof manifest.files = [];
        const removed: typeof manifest.files = [];
        for (const f of manifest.files) {
          const p = prevByPath.get(f.path);
          if (!p) {
            added.push(f);
            changeKind[f.path] = "added";
          } else if (p.size !== f.size) {
            modified.push(f);
            changeKind[f.path] = "modified";
          }
        }
        for (const p of prevManifest.files) {
          if (!currByPath.has(p.path)) {
            removed.push(p);
            changeKind[p.path] = "removed";
          }
        }
        diffFiles = [...added, ...modified, ...removed].sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      }
    }
  }

  // Filter out OpenClaw / NemoClaw / OpenShell internal state files. These
  // top-level prefixes appear in every real NemoClaw sandbox snapshot and
  // mutate on every agent turn but don't represent user-visible agent
  // actions. Use a *blacklist* (exclude these) instead of a whitelist (only
  // workspace/) so the Codebase tab also works for snapshots taken outside
  // a NemoClaw sandbox — e.g. the in-process web-terminal AgentLoop where
  // the sandbox is the repo root and the agent can write anywhere.
  const OPENCLAW_HOUSEKEEPING_PREFIXES = [
    "agents/",
    "canvas/",
    "credentials/",
    "cron/",
    "devices/",
    "extensions/",
    "hooks/",
    "identity/",
    "memory/",
    "skills/",
    "telegram/",
    "rebuild-manifest.json",
  ];
  const isHousekeeping = (p: string) =>
    OPENCLAW_HOUSEKEEPING_PREFIXES.some((prefix) => p.startsWith(prefix));
  diffFiles = diffFiles.filter((f) => !isHousekeeping(f.path));
  for (const k of Object.keys(changeKind)) {
    if (isHousekeeping(k)) delete changeKind[k];
  }

  return NextResponse.json({
    cpId: manifest.cpId,
    runId: manifest.runId,
    branchId: manifest.branchId,
    nodeId: manifest.nodeId,
    kind: manifest.kind,
    checksum: manifest.checksum,
    fileCount: diffFiles.length,
    files: diffFiles,
    sandboxRoot: manifest.sandboxRoot,
    createdAt: manifest.createdAt,
    diff: {
      enabled: wantDiff,
      previousCpId,
      hasChanges: diffFiles.length > 0,
      changeKind,
    },
  });
}
