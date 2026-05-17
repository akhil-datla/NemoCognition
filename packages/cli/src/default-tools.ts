import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { AgentTool } from "@nemocognition/nemoclaw";

export type { AgentTool } from "@nemocognition/nemoclaw";

const MAX_READ_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 1 * 1024 * 1024;
const MAX_LIST_ENTRIES = 200;
const MAX_BASH_OUTPUT_BYTES = 64 * 1024;
const BASH_TIMEOUT_MS = 30_000;

interface ResolvedPath {
  absolute: string;
  relative: string;
  insideSandbox: boolean;
}

function resolveInSandbox(sandboxRoot: string, p: string): ResolvedPath {
  const absolute = path.resolve(sandboxRoot, p);
  const rel = path.relative(sandboxRoot, absolute);
  const insideSandbox = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  return { absolute, relative: rel === "" ? "." : rel, insideSandbox };
}

export function buildAgentTools(sandboxRoot: string): AgentTool[] {
  return [
    {
      name: "read_file",
      description:
        "Read a UTF-8 file under the repo root. Returns up to 200KB of content and a `truncated` flag.",
      actionType: "file_read",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repo root." },
        },
        required: ["path"],
      },
      resourceFromArgs: (a) => String(a.path ?? ""),
      execute: async (a) => {
        const requested = String(a.path ?? "");
        const { absolute, relative, insideSandbox } = resolveInSandbox(sandboxRoot, requested);
        if (!insideSandbox) throw new Error(`Path escapes the sandbox: ${requested}`);
        const stat = await fs.stat(absolute);
        if (stat.isDirectory()) throw new Error(`Path is a directory, not a file: ${relative}`);
        const fd = await fs.open(absolute, "r");
        try {
          const buf = Buffer.alloc(MAX_READ_BYTES);
          const { bytesRead } = await fd.read(buf, 0, MAX_READ_BYTES, 0);
          return {
            path: relative,
            content: buf.subarray(0, bytesRead).toString("utf8"),
            bytes: bytesRead,
            truncated: stat.size > MAX_READ_BYTES,
          };
        } finally {
          await fd.close();
        }
      },
    },

    {
      name: "list_directory",
      description: "List files and subdirectories in a directory under the repo root.",
      actionType: "file_read",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Directory path relative to the repo root. Use "." for the repo root.',
          },
        },
        required: ["path"],
      },
      resourceFromArgs: (a) => String(a.path ?? "."),
      execute: async (a) => {
        const requested = String(a.path ?? ".");
        const { absolute, relative, insideSandbox } = resolveInSandbox(sandboxRoot, requested);
        if (!insideSandbox) throw new Error(`Path escapes the sandbox: ${requested}`);
        const dirents = await fs.readdir(absolute, { withFileTypes: true });
        const limited = dirents.slice(0, MAX_LIST_ENTRIES);
        return {
          path: relative,
          entries: limited.map((d) => ({
            name: d.name,
            type: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
          })),
          total: dirents.length,
          truncated: dirents.length > MAX_LIST_ENTRIES,
        };
      },
    },

    {
      name: "write_file",
      description:
        "Write UTF-8 content to a file under the workspace/ directory. The path must start with 'workspace/' (e.g. workspace/hello.py). Overwrites any existing file. Creates parent directories as needed. Max 1MB.",
      actionType: "file_write",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repo root." },
          content: { type: "string", description: "Full UTF-8 file content." },
        },
        required: ["path", "content"],
      },
      resourceFromArgs: (a) => String(a.path ?? ""),
      execute: async (a) => {
        const requested = String(a.path ?? "");
        const content = typeof a.content === "string" ? a.content : "";
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > MAX_WRITE_BYTES) {
          throw new Error(`Write exceeds ${MAX_WRITE_BYTES} bytes (got ${bytes})`);
        }
        const { absolute, relative, insideSandbox } = resolveInSandbox(sandboxRoot, requested);
        if (!insideSandbox) throw new Error(`Path escapes the sandbox: ${requested}`);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content, "utf8");
        return { path: relative, bytes };
      },
    },

    {
      name: "run_bash",
      description:
        "Run a shell command with bash -c from the repo root. 30s timeout. Returns stdout, stderr, exitCode.",
      actionType: "command_execution",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute." },
        },
        required: ["command"],
      },
      resourceFromArgs: (a) => String(a.command ?? ""),
      execute: async (a) => {
        const command = String(a.command ?? "");
        const result = await runBash(command, sandboxRoot);
        // Surface non-zero shell exits / timeouts as tool errors so the
        // ToolWrapper records errorClass + outer exitCode = 1, the trace
        // ingestor marks the node "failure" (red), and classifyFailure can
        // match the "permission denied" / "command failed" / "timeout"
        // patterns. Returning a structured BashResult silently hid these
        // failures behind a green-success node. The stdout/stderr/exitCode
        // are still attached to the thrown Error's message so the agent
        // sees the full context in its tool-result message.
        if (result.exitCode !== 0 || result.timedOut) {
          const summary = (result.stderr || result.stdout || "(no output)")
            .trim()
            .slice(0, 800);
          const cls = result.timedOut
            ? "BashTimeout"
            : /permission denied/i.test(result.stderr)
              ? "PermissionDenied"
              : "BashError";
          const err = new Error(
            `${cls}: exit ${result.exitCode}: ${summary}`,
          );
          (err as Error & { bashResult?: BashResult }).bashResult = result;
          throw err;
        }
        return result;
      },
    },
  ];
}

interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  timedOut: boolean;
}

function runBash(command: string, cwd: string): Promise<BashResult> {
  return new Promise((resolve) => {
    // Use `sh` not `bash` — works on both alpine (no bash) and debian-based
    // containers. POSIX `sh` is enough for the simple commands the agent
    // issues (echo, redirection, mkdir, ls, find, etc.).
    const child = spawn("sh", ["-c", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const cap = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_BASH_OUTPUT_BYTES) {
        truncated = true;
        return next.slice(0, MAX_BASH_OUTPUT_BYTES);
      }
      return next;
    };

    const finish = (result: BashResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* spawn never started */
      }
      finish({ stdout, stderr, exitCode: 124, truncated, timedOut: true });
    }, BASH_TIMEOUT_MS);

    child.stdout?.on("data", (d: Buffer) => {
      stdout = cap(stdout, d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr = cap(stderr, d);
    });

    // CRITICAL: without an `error` handler, spawn-failure (e.g. shell not on
    // PATH, cwd doesn't exist) emits an unhandled 'error' event and no
    // 'close' event, leaving the promise dangling forever. The agent loop
    // then hangs on a single tool call. Always settle.
    child.on("error", (err) => {
      stderr = (stderr ? stderr + "\n" : "") + `spawn error: ${err.message}`;
      finish({ stdout, stderr, exitCode: 127, truncated, timedOut });
    });
    child.on("close", (code) => {
      finish({
        stdout,
        stderr,
        exitCode: timedOut ? 124 : code ?? -1,
        truncated,
        timedOut,
      });
    });
  });
}
