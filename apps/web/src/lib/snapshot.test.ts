import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { takeSnapshot, restoreSnapshot } from "./snapshot";

let sandbox: string;
let snapshotsDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "snap-sandbox-"));
  snapshotsDir = mkdtempSync(path.join(os.tmpdir(), "snap-store-"));
  writeFileSync(path.join(sandbox, "kept.txt"), "v1");
  writeFileSync(path.join(sandbox, "edited.txt"), "before");
  mkdirSync(path.join(sandbox, "sub"), { recursive: true });
  writeFileSync(path.join(sandbox, "sub", "nested.txt"), "nested");
  // Excluded dirs should not appear in the snapshot
  mkdirSync(path.join(sandbox, "node_modules"), { recursive: true });
  writeFileSync(path.join(sandbox, "node_modules", "big.bin"), "ignored");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(snapshotsDir, { recursive: true, force: true });
});

describe("takeSnapshot + restoreSnapshot", () => {
  it("captures sandbox files (excluding ignored dirs)", async () => {
    const tar = path.join(snapshotsDir, "cp.tar.gz");
    const result = await takeSnapshot(sandbox, tar);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(tar)).toBe(true);
  });

  it("restores files that were modified after the snapshot", async () => {
    const tar = path.join(snapshotsDir, "cp.tar.gz");
    await takeSnapshot(sandbox, tar);

    // Mutate the sandbox
    writeFileSync(path.join(sandbox, "edited.txt"), "after");
    writeFileSync(path.join(sandbox, "kept.txt"), "v2");

    const result = await restoreSnapshot(tar, sandbox);
    expect(result.filesRestored).toBeGreaterThan(0);

    expect(readFileSync(path.join(sandbox, "edited.txt"), "utf8")).toBe("before");
    expect(readFileSync(path.join(sandbox, "kept.txt"), "utf8")).toBe("v1");
    expect(readFileSync(path.join(sandbox, "sub", "nested.txt"), "utf8")).toBe("nested");
  });

  it("removes files created after the snapshot", async () => {
    const tar = path.join(snapshotsDir, "cp.tar.gz");
    await takeSnapshot(sandbox, tar);

    writeFileSync(path.join(sandbox, "new.txt"), "added after");

    const result = await restoreSnapshot(tar, sandbox);
    expect(result.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(sandbox, "new.txt"))).toBe(false);
  });

  it("leaves excluded dirs untouched on restore", async () => {
    const tar = path.join(snapshotsDir, "cp.tar.gz");
    await takeSnapshot(sandbox, tar);
    // Add a file inside the excluded dir AFTER snapshot
    writeFileSync(path.join(sandbox, "node_modules", "stay.bin"), "stays");

    await restoreSnapshot(tar, sandbox);
    expect(existsSync(path.join(sandbox, "node_modules", "stay.bin"))).toBe(true);
    expect(existsSync(path.join(sandbox, "node_modules", "big.bin"))).toBe(true);
  });
});
