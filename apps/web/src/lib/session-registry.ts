import type { SessionRunner } from "./session-runner";

/**
 * Process-global registry of active SessionRunner instances. Survives Next.js
 * dev-mode module re-instantiation by attaching to globalThis (same pattern
 * as the InMemoryStore singleton in @nemocognition/db).
 *
 * Runners are removed REGISTRY_TTL_MS milliseconds after they finish so the
 * UI can reconnect briefly to grab the tail of the stream; longer-term reads
 * come from Postgres via /api/runs/[id] etc.
 */
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const GLOBAL_KEY = "__nemocognition_session_registry__";

interface Slot {
  runners: Map<string, SessionRunner>;
  cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const g = globalThis as unknown as Record<string, Slot | undefined>;
const slot: Slot = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = {
  runners: new Map(),
  cleanupTimers: new Map(),
});

export function registerRunner(runner: SessionRunner): void {
  slot.runners.set(runner.getRunId(), runner);

  // Schedule eviction once the runner reports it's done — but check
  // periodically rather than chaining a single callback (the runner doesn't
  // expose an onComplete event hook from outside).
  const interval = setInterval(() => {
    if (runner.getEndedAt() !== null) {
      clearInterval(interval);
      const timer = setTimeout(() => {
        slot.runners.delete(runner.getRunId());
        slot.cleanupTimers.delete(runner.getRunId());
      }, REGISTRY_TTL_MS);
      slot.cleanupTimers.set(runner.getRunId(), timer);
    }
  }, 1000);
}

export function getRunner(runId: string): SessionRunner | undefined {
  return slot.runners.get(runId);
}

export function listActiveRunIds(): string[] {
  return [...slot.runners.keys()];
}
