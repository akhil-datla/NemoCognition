import path from "node:path";

/**
 * Process-global map of runId → absolute sandbox root the run's agent was
 * scoped to. Separate from the SessionRunner registry so it survives the
 * runner's TTL eviction (UI may browse a run's filesystem long after the
 * runner is gone). Lost on server restart — older runs fall back to the
 * env/cwd default.
 */
const GLOBAL_KEY = "__nemocognition_sandbox_roots__";

interface Slot {
  roots: Map<string, string>;
}

const g = globalThis as unknown as Record<string, Slot | undefined>;
const slot: Slot = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = { roots: new Map() });

export function setSandboxRoot(runId: string, root: string): void {
  slot.roots.set(runId, path.resolve(root));
}

export function getSandboxRoot(runId: string): string | undefined {
  return slot.roots.get(runId);
}

export function defaultSandboxRoot(): string {
  return process.env.NEMOCLAW_SANDBOX_ROOT
    ? path.resolve(process.env.NEMOCLAW_SANDBOX_ROOT)
    : process.cwd();
}
