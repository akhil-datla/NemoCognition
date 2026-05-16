import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store-factory";
import { SessionRunner } from "@/lib/session-runner";
import { registerRunner } from "@/lib/session-registry";
import { setSandboxRoot, defaultSandboxRoot } from "@/lib/sandbox-registry";
import { DEFAULT_POLICY, STRICT_POLICY } from "@nemocognition/nemoclaw";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startInput = z.object({
  title: z.string().min(1),
  userTask: z.string().min(1),
  policyPreset: z.enum(["default", "strict"]).optional(),
});

export async function POST(request: NextRequest) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NIM_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = startInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const store = await getStore();
  const sandboxRoot = process.env.NEMOCLAW_SANDBOX_ROOT ?? defaultSandboxRoot();
  const runner = new SessionRunner(
    {
      store,
      nimEndpoint: process.env.NIM_ENDPOINT ?? "https://integrate.api.nvidia.com/v1",
      nimApiKey: apiKey,
      nimModel: process.env.NIM_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      phoenixEndpoint: process.env.PHOENIX_ENDPOINT ?? "http://localhost:6006",
      sandboxRoot,
      policy: parsed.data.policyPreset === "strict" ? STRICT_POLICY : DEFAULT_POLICY,
    },
    parsed.data.title,
    parsed.data.userTask,
  );
  registerRunner(runner);
  setSandboxRoot(runner.getRunId(), sandboxRoot);

  // Seed Run + Branch records immediately so /runs/<id> doesn't 404 while the
  // agent loop is still in flight. The end-of-run persistence overwrites these
  // with final status.
  const now = new Date().toISOString();
  await store.setRun({
    id: runner.getRunId(),
    title: parsed.data.title,
    userTask: parsed.data.userTask,
    status: "running",
    createdAt: now,
    completedAt: null,
    rootBranchId: runner.branchId,
    sandboxRoot,
  });
  await store.setBranch({
    id: runner.branchId,
    runId: runner.getRunId(),
    parentBranchId: null,
    forkNodeId: null,
    status: "running",
    correctionSummary: null,
    createdAt: now,
  });

  // Kick off the agent loop in the background — return immediately so the
  // client can subscribe to SSE before events start flying.
  void runner.run(parsed.data.userTask).catch(() => {
    /* errors are surfaced via the SSE error event */
  });

  return NextResponse.json(
    {
      runId: runner.getRunId(),
      branchId: runner.branchId,
      sseUrl: `/api/sessions/${runner.getRunId()}/events`,
    },
    { status: 201 },
  );
}
