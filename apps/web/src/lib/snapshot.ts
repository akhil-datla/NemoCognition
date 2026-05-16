import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Directories we never include in a snapshot — too large, generated, or managed
 * elsewhere. Restoring them would do more harm than good.
 */
const SNAPSHOT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  ".nemoclaw-snapshots",
]);

export function defaultSnapshotsDir(): string {
  return process.env.NEMOCLAW_SNAPSHOTS_DIR ?? path.join(os.tmpdir(), "nemoclaw-snapshots");
}

export interface SnapshotResult {
  /** The directory the snapshot tree lives in. */
  tarPath: string;
  bytes: number;
}

export interface RestoreResult {
  filesRemoved: number;
  filesRestored: number;
}

/**
 * Copy the sandbox into a snapshot directory tree. Per-file ops avoid the
 * Docker-Desktop "Resource deadlock" that shells out to `tar` hit on bind-mounted
 * volumes. The `outPath` is the *target directory* (despite the legacy field name
 * tarPath in the result, which we keep for store schema compatibility).
 */
export async function takeSnapshot(sandboxRoot: string, outPath: string): Promise<SnapshotResult> {
  await fs.mkdir(outPath, { recursive: true });
  const files = await walkSandbox(sandboxRoot);
  let bytes = 0;
  for (const rel of files) {
    const src = path.join(sandboxRoot, rel);
    const dst = path.join(outPath, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    try {
      const stat = await fs.stat(dst);
      bytes += stat.size;
    } catch {
      /* ignore missing-after-copy races */
    }
  }
  return { tarPath: outPath, bytes };
}

/**
 * Restore from a snapshot directory tree:
 * 1. Walk the snapshot, build a relative-path set.
 * 2. Walk the sandbox, delete any file not in the snapshot.
 * 3. Copy every snapshot file back into the sandbox (overwriting).
 * Excluded directories (node_modules etc.) are left untouched in both steps.
 */
export async function restoreSnapshot(
  snapshotPath: string,
  sandboxRoot: string,
): Promise<RestoreResult> {
  await fs.access(snapshotPath);
  const snapshotFiles = new Set(await walkSandbox(snapshotPath));
  const currentFiles = await walkSandbox(sandboxRoot);

  let filesRemoved = 0;
  for (const rel of currentFiles) {
    if (!snapshotFiles.has(rel)) {
      await fs.rm(path.join(sandboxRoot, rel), { force: true });
      filesRemoved++;
    }
  }

  for (const rel of snapshotFiles) {
    const src = path.join(snapshotPath, rel);
    const dst = path.join(sandboxRoot, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }

  return { filesRemoved, filesRestored: snapshotFiles.size };
}

async function walkSandbox(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, relPrefix: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Exclude these directory names at any depth — `.next` and nested
      // `node_modules` show up below the top level via the standalone build.
      if (SNAPSHOT_EXCLUDES.has(e.name)) continue;
      const relPath = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      // Resolve symlinks to know whether they point at a file or directory.
      // Skip dir-symlinks (often pnpm node_modules links into the store) so
      // copyFile doesn't EISDIR on them.
      if (e.isSymbolicLink()) {
        try {
          const target = await fs.stat(abs);
          if (target.isFile()) out.push(relPath);
        } catch {
          /* dangling symlink — skip */
        }
        continue;
      }
      if (e.isDirectory()) {
        await rec(abs, relPath);
      } else if (e.isFile()) {
        out.push(relPath);
      }
    }
  }
  await rec(root, "");
  return out;
}
