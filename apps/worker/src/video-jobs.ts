import type { Store } from "@nemocognition/db";
import { traceToStoryboard } from "@nemocognition/video";

export interface ProcessResult {
  processed: number;
  failed: number;
}

/**
 * Drain the pending video-job queue once. Each job is converted to a
 * Storyboard JSON document; the storyboard ref is written to outputVideoRef
 * and the job is marked completed.
 *
 * Actual MP4 rendering is intentionally deferred — the replay UI already
 * provides a richer experience than a static video, and the storyboard is the
 * declarative input any future ffmpeg/Remotion pipeline would consume.
 */
export async function processPendingVideoJobs(store: Store): Promise<ProcessResult> {
  const pending = await store.listPendingVideoJobs();
  let processed = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const job of pending) {
    const run = await store.getRun(job.runId);
    if (!run) {
      await store.setVideoJob({
        ...job,
        status: "failed",
        completedAt: now,
      });
      failed += 1;
      continue;
    }

    try {
      const nodes = (await store.getRunNodes(job.runId)).sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      );
      const storyboard = traceToStoryboard(nodes, { runId: job.runId, title: run.title });
      // For Brev: replace this stub with a Remotion/ffmpeg render that
      // outputs to S3/Cloudflare R2 and returns the object URL.
      const outputRef = `storyboard://run/${job.runId}/${storyboard.scenes.length}-scenes`;
      await store.setVideoJob({
        ...job,
        status: "completed",
        outputVideoRef: outputRef,
        completedAt: now,
      });
      processed += 1;
    } catch (err) {
      await store.setVideoJob({
        ...job,
        status: "failed",
        completedAt: now,
      });
      failed += 1;
      console.error(`[video-jobs] ${job.id} failed:`, err);
    }
  }

  return { processed, failed };
}
