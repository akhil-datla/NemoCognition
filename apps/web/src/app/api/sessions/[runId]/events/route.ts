import { NextRequest, NextResponse } from "next/server";
import { getRunner } from "@/lib/session-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events stream of a running session's tracker events. The
 * client receives all buffered events on connect (so it never misses the
 * first emissions), then live events, then a final `complete` event and a
 * clean close.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const runner = getRunner(runId);
  if (!runner) {
    return NextResponse.json(
      { error: "Session not found or expired. The replay UI at /runs/<id> can read the persisted run from Postgres." },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      const unsubscribe = runner.subscribe((e) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          if ((e.event as { type: string }).type === "complete") {
            unsubscribe();
            safeClose();
          }
        } catch {
          unsubscribe();
          safeClose();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx/Brev edge proxy buffering when applicable.
      "X-Accel-Buffering": "no",
    },
  });
}
