import * as tar from "tar";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

export type SnapshotKind = "pre_tool" | "post_tool" | "final" | "manual" | "pre_restore";

export interface SnapshotInput {
  runId: string;
  branchId: string;
  nodeId: string;
  kind: SnapshotKind;
  sandboxRoot: string;
  /** Override the checkpoint storage root. Defaults to env CHECKPOINT_STORAGE_ROOT or ./checkpoints. */
  storageRoot?: string;
  /** Optional explicit cpId. When unset, generated. */
  cpId?: string;
}

export interface SnapshotFileEntry {
  path: string;
  size: number;
}

export interface SnapshotResult {
  cpId: string;
  artifactPath: string;
  manifestPath: string;
  checksum: string;
  fileCount: number;
  files: SnapshotFileEntry[];
  kind: SnapshotKind;
  createdAt: string;
}

export interface SnapshotManifest {
  cpId: string;
  runId: string;
  branchId: string;
  nodeId: string;
  kind: SnapshotKind;
  checksum: string;
  fileCount: number;
  files: SnapshotFileEntry[];
  sandboxRoot: string;
  createdAt: string;
}

/** Default storage root for checkpoint archives. Honors env override. */
export function defaultCheckpointRoot(): string {
  const envRoot = process.env.CHECKPOINT_STORAGE_ROOT;
  if (envRoot && envRoot.trim().length > 0) return path.resolve(envRoot);
  return path.resolve(process.cwd(), "checkpoints");
}

/** Default sandbox root for a given run. Honors env override. */
export function sandboxRootForRun(runId: string): string {
  const envRoot = process.env.SANDBOX_STORAGE_ROOT;
  const base = envRoot && envRoot.trim().length > 0
    ? path.resolve(envRoot)
    : path.resolve(process.cwd(), "sandboxes");
  return path.join(base, runId);
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".cache"]);

/**
 * Walks a directory recursively, returning relative paths of every regular
 * file. Symlinks and special files are skipped. SKIP_DIRS is not traversed
 * (defensive — should not exist in a fresh per-run sandbox).
 */
async function walkSandbox(root: string): Promise<SnapshotFileEntry[]> {
  const out: SnapshotFileEntry[] = [];
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
        out.push({ path: path.posix.join(rel, d.name).replace(/^\.?\//, ""), size: st.size });
      }
    }
  }
  await walk(root, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function sha256OfFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(p);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Snapper takes filesystem snapshots of a per-run sandbox.
 *
 * Strategy: snap the entire sandbox into a TAR archive on every call. Per-run
 * sandboxes start empty and only contain files the agent has created, so the
 * archives are small. Each snapshot is fully self-contained — restoring is a
 * single `tar -xf` over a clean directory, no chain replay needed.
 */
export class Snapper {
  /**
   * Snapshot the current state of a sandbox. Writes:
   *  - <storageRoot>/<runId>/<cpId>.tar     — the archive
   *  - <storageRoot>/<runId>/<cpId>.json    — metadata manifest
   */
  async snapshot(input: SnapshotInput): Promise<SnapshotResult> {
    const cpId = input.cpId ?? `cp_${randomUUID().slice(0, 8)}`;
    const storageRoot = input.storageRoot ?? defaultCheckpointRoot();
    const runDir = path.join(storageRoot, input.runId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(input.sandboxRoot, { recursive: true });

    const files = await walkSandbox(input.sandboxRoot);
    const artifactPath = path.join(runDir, `${cpId}.tar`);
    const manifestPath = path.join(runDir, `${cpId}.json`);

    if (files.length === 0) {
      // Write an empty placeholder tar so restore is well-defined. We do this
      // by creating an archive that captures a known sentinel directory entry.
      await tar.create(
        { file: artifactPath, cwd: input.sandboxRoot, portable: true },
        ["."],
      );
    } else {
      await tar.create(
        { file: artifactPath, cwd: input.sandboxRoot, portable: true },
        files.map((f) => f.path),
      );
    }

    const checksum = await sha256OfFile(artifactPath);
    const createdAt = new Date().toISOString();

    const manifest: SnapshotManifest = {
      cpId,
      runId: input.runId,
      branchId: input.branchId,
      nodeId: input.nodeId,
      kind: input.kind,
      checksum,
      fileCount: files.length,
      files,
      sandboxRoot: input.sandboxRoot,
      createdAt,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
      cpId,
      artifactPath,
      manifestPath,
      checksum,
      fileCount: files.length,
      files,
      kind: input.kind,
      createdAt,
    };
  }

  /**
   * Read the manifest of a previously-written snapshot. Supports two formats:
   *
   *  1. Our own TAR-based snapshots: `<root>/<runId>/<cpId>.tar` paired with
   *     `<root>/<runId>/<cpId>.json` carrying the manifest.
   *  2. Real NemoClaw directory snapshots produced by
   *     `nemoclaw <sandbox> snapshot create`. These live at
     *     `/home/ubuntu/.nemoclaw/rebuild-backups/<sandbox>/<timestamp>` as a
   *     directory tree of the sandbox's files. We synthesize a manifest by
   *     walking the directory.
   */
  async readManifest(artifactPath: string): Promise<SnapshotManifest | null> {
    // Fast path: sidecar JSON next to a .tar archive.
    const manifestPath = artifactPath.replace(/\.tar$/, ".json");
    if (manifestPath !== artifactPath) {
      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        return JSON.parse(raw) as SnapshotManifest;
      } catch {
        /* fall through to directory case */
      }
    }
    // NemoClaw directory format: walk the directory and synthesise a manifest.
    let stat;
    try {
      stat = await fs.stat(artifactPath);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return null;
    const files = await walkSandbox(artifactPath);
    const parts = artifactPath.split(path.sep).filter(Boolean);
    const sandboxName = parts[parts.length - 2] ?? "?";
    const ts = parts[parts.length - 1] ?? "?";
    return {
      cpId: `nemoclaw:${sandboxName}:${ts}`,
      runId: "?",
      branchId: "?",
      nodeId: "?",
      kind: "manual",
      checksum: "",
      fileCount: files.length,
      files,
      sandboxRoot: artifactPath,
      createdAt: stat.mtime.toISOString(),
    };
  }

  /**
   * Read a single file's bytes from a snapshot. Handles both TAR archives
   * and NemoClaw directory snapshots.
   */
  async readEntry(artifactPath: string, entryPath: string): Promise<Buffer | null> {
    const normalized = entryPath.replace(/^\.?\//, "");
    // Directory snapshot (NemoClaw): read directly from disk.
    try {
      const stat = await fs.stat(artifactPath);
      if (stat.isDirectory()) {
        const filePath = path.join(artifactPath, normalized);
        // Defend against path traversal by ensuring resolved path stays inside.
        const rel = path.relative(artifactPath, filePath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
        try {
          return await fs.readFile(filePath);
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
    // TAR archive: stream-parse and return the matching entry.
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let found = false;
      const parser = new tar.Parser();
      parser.on("entry", (entry: tar.ReadEntry) => {
        const candidate = entry.path.replace(/^\.?\//, "");
        if (!found && candidate === normalized && entry.type === "File") {
          found = true;
          entry.on("data", (c: Buffer) => chunks.push(c));
          entry.on("end", () => resolve(Buffer.concat(chunks)));
        } else {
          entry.resume();
        }
      });
      parser.on("end", () => {
        if (!found) resolve(null);
      });
      parser.on("error", reject);
      const stream = createReadStream(artifactPath);
      stream.on("error", reject);
      stream.pipe(parser);
    });
  }

  /**
   * Extract a snapshot into a target directory. Handles both TAR archives
   * and NemoClaw directory snapshots (the latter via plain recursive copy).
   * The target is wiped and recreated to guarantee bit-for-bit fidelity.
   */
  async extract(artifactPath: string, destDir: string): Promise<void> {
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.mkdir(destDir, { recursive: true });
    let stat;
    try {
      stat = await fs.stat(artifactPath);
    } catch {
      throw new Error(`extract: source not found: ${artifactPath}`);
    }
    if (stat.isDirectory()) {
      await fs.cp(artifactPath, destDir, { recursive: true });
      return;
    }
    await tar.extract({ file: artifactPath, cwd: destDir });
  }
}

/**
 * Module-level singleton. The agent loop and the API routes both grab this so
 * snapshot bookkeeping is shared in-process.
 */
const GLOBAL_KEY = "__nemocognition_snapper__";
const g = globalThis as unknown as Record<string, Snapper | undefined>;
export const snapper: Snapper = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new Snapper());
