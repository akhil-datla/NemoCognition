# NemoCognition — Policy Replay Lab

A visual execution, failure, and recovery debugger for NemoClaw agents running on NVIDIA Brev with NVIDIA Nemotron via NIM.

NemoCognition records every action an agent takes — model calls, tool calls, OpenShell policy decisions, checkpoints, memory updates — and lets you replay them in a cinematic, node-by-node UI. When the agent gets blocked or makes a mistake, you can fork from any checkpoint with a human correction and watch the recovery branch unfold alongside the original.

## Architecture

```
┌──────────────────┐    OTLP/HTTP    ┌──────────────┐
│   NemoClaw CLI   │ ──────────────► │ Arize Phoenix│  (live traces UI :6006)
│    (on Brev)     │                 └──────────────┘
│                  │
│  RuntimeTracker  │    REST POST    ┌──────────────┐    ┌──────────┐
│   + NIM client   │ ──────────────► │ NemoCognition│ ◄──┤ Postgres │
│   + ToolWrapper  │  /api/runs/     │   web app    │    └──────────┘
└──────────────────┘  import         │   (:3000)    │
                                     └──────┬───────┘
                                            │ polls
                                     ┌──────▼───────┐
                                     │ Video worker │  (storyboards)
                                     └──────────────┘
```

**Non-negotiable stack** — every layer is fixed:
- **Runtime:** NemoClaw (NVIDIA's OpenClaw wrapper)
- **Model:** NVIDIA Nemotron via NIM
- **Instrumentation:** OpenInference semantic conventions
- **Trace collector:** Arize Phoenix (self-hosted)
- **Transport:** OpenTelemetry OTLP/HTTP

## Three screens

1. **Terminal** (`/`) — launch a recording, list sessions, jump to replay.
2. **Sessions dashboard** (`/runs`) — every recorded run with status, time, and quick replay link. Lists everything in the persistent store plus the canonical demo run.
3. **Replay player** (`/runs/[runId]`) — video-style scrubber over the execution DAG with streaming agent narration, branch toggles, policy/audit/memory inspector tabs, and one-click "fix & rerun" from any checkpoint.

## Packages

| Package | Purpose |
|---|---|
| `@nemocognition/core` | Zod schemas, graph builder, failure classifier |
| `@nemocognition/tracing` | OpenInference span mapping, Phoenix OTLP exporter, trace ingestor |
| `@nemocognition/nemoclaw` | Runtime hooks (RuntimeTracker), NIM client, tool wrapper, checkpoint hooks |
| `@nemocognition/recovery` | Checkpoint manager, recovery orchestrator |
| `@nemocognition/db` | `Store` interface, `InMemoryStore`, Postgres-backed `PostgresStore`, Drizzle schema + migrations |
| `@nemocognition/video` | Trace → storyboard converter |
| `@nemocognition/cli` | `nemoclaw-record` binary |
| `@nemocognition/web` | Next.js 15 app (3 screens above) |
| `@nemocognition/worker` | Background job processor for video storyboards |

## Local dev quickstart

```bash
pnpm install
docker compose up -d postgres phoenix redis   # postgres on host :5433, phoenix :6006/:4317
pnpm db:migrate                          # apply Drizzle migrations
pnpm dev                                 # next dev on :3000
```

Open <http://localhost:3000>. The terminal screen is the entry; the demo run is preloaded.

Run the worker in another shell to process storyboard jobs:

```bash
DATABASE_URL=postgres://nemocognition:nemocognition_dev@localhost:5433/nemocognition pnpm worker
```

## Recording a session

The CLI is the recorder. Set the four env vars and run:

```bash
export NIM_API_KEY=nvapi-...
export PHOENIX_ENDPOINT=http://localhost:6006
export NEMOCOGNITION_API_URL=http://localhost:3000
pnpm --filter @nemocognition/cli dev demo            # scripted (no NIM calls)
pnpm --filter @nemocognition/cli dev record "title"  # interactive chat
```

Each session flushes to both Phoenix (traces UI at `http://localhost:6006`) and the NemoCognition API (`POST /api/runs/import`). Either channel can fail independently without aborting the other.

## Deploying on NVIDIA Brev

The repo ships production artifacts: `Dockerfile.web`, `Dockerfile.worker`, and `docker-compose.prod.yml`. **First-time deployers: run `docker compose -f docker-compose.prod.yml build` once before bringing the stack up so you can iterate on any build issues before binding ports.**

```bash
# On your Brev instance
git clone <repo>
cd nemocognition
cp .env.example .env       # fill in NIM_API_KEY at minimum
docker compose -f docker-compose.prod.yml up -d --build
```

That's it. The `migrator` service runs once on startup (after Postgres is healthy), applies any pending Drizzle migrations, and exits. The `web` and `worker` services wait for it to succeed before starting.

To re-run migrations after pulling new schema:

```bash
docker compose -f docker-compose.prod.yml run --rm migrator
```

Services that come up:
- **postgres** :5432 — persistent storage (volume `pgdata`)
- **phoenix** :6006 / :4317 — trace UI and OTLP endpoints
- **web** :3000 — NemoCognition replay UI + API
- **worker** — drains video-job queue every 5s

Health check: `curl http://<brev-host>:3000/api/health` returns `{ ok: true, storeKind: "postgres", ... }`.

### Env vars (copy from `.env.example`)

| Var | Purpose |
|---|---|
| `NIM_API_KEY` | NVIDIA NIM API key (required for `nemoclaw-record record`) |
| `NIM_ENDPOINT` | NIM endpoint (default: `https://integrate.api.nvidia.com/v1`) |
| `NIM_MODEL` | NIM model id (default: `nvidia/llama-3.1-nemotron-70b-instruct`) |
| `PHOENIX_ENDPOINT` | Arize Phoenix HTTP endpoint (default: `http://localhost:6006`) |
| `NEMOCOGNITION_API_URL` | Web app URL for replay import (optional — skip to run Phoenix-only) |
| `DATABASE_URL` | Postgres connection string. **If unset, falls back to in-memory store** |
| `WORKER_INTERVAL_MS` | Poll interval for the worker (default: 5000) |

## Scripts

```bash
pnpm test                      # full vitest suite
pnpm typecheck                 # per-package tsc --noEmit
pnpm lint                      # next lint
pnpm build                     # next build (web app)
pnpm db:migrate                # drizzle-kit migrate
pnpm db:studio                 # drizzle visual studio
pnpm worker                    # start the video worker locally
```

## Tests

The full pipeline is covered:

```
packages/core            schemas, graph builder, failure classifier
packages/tracing         span mapper, OTLP exporter, trace ingestor
packages/nemoclaw        runtime hooks, NIM client, tool wrapper, checkpoints
packages/recovery        checkpoint manager, recovery orchestrator
packages/db              PostgresStore against embedded pglite
packages/video           storyboard generator
packages/cli             session recorder + flush + end-to-end integration
apps/web                 pure API handlers (no Next runtime needed)
apps/worker              video job processor
```

Integration coverage includes: a recorder builds events → handler ingests them → store persists → API queries return the graph → storyboard reflects climactic policy_deny scenes. The Phoenix exporter is unit-tested against the OTLP/HTTP JSON envelope shape (hex IDs, OpenInference attribute keys).

## Recovery model

A failed branch is **immutable** — never overwritten. Hitting "Fix & rerun" from a denied action creates a sibling branch starting from the nearest checkpoint, with a human-written correction prompt injected. Both branches stay visible in the replay graph forever; the recovery branch is offset and color-coded.

## What the worker doesn't do (yet)

The video worker generates a typed `Storyboard` JSON per job. It does **not** render an actual MP4 — that requires a Remotion/ffmpeg pipeline and is deferred. The replay UI is the primary visualization; the storyboard exists so a future renderer has a declarative input.
