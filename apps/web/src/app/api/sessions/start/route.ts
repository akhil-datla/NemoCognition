import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store-factory";
import { SessionRunner } from "@/lib/session-runner";
import { registerRunner } from "@/lib/session-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startInput = z.object({
  title: z.string().min(1),
  userTask: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NIM_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const nimEndpoint =
    process.env.NIM_ENDPOINT ??
    process.env.NVIDIA_NIM_BASE_URL ??
    "https://integrate.api.nvidia.com/v1";
  const nimModel =
    process.env.NIM_MODEL ??
    process.env.NVIDIA_NIM_MODEL ??
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

  const body = await request.json().catch(() => ({}));
  const parsed = startInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const store = await getStore();
  const runner = new SessionRunner(
    {
      store,
      nimEndpoint,
      nimApiKey: apiKey,
      nimModel,
      phoenixEndpoint:
        process.env.PHOENIX_ENDPOINT ??
        process.env.PHOENIX_BASE_URL ??
        "http://localhost:6006",
      sandboxRoot: process.env.NEMOCLAW_SANDBOX_ROOT,
    },
    parsed.data.title,
    parsed.data.userTask,
  );
  registerRunner(runner);

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
