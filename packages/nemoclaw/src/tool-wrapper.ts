export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolExecutionResult {
  toolName: string;
  output: unknown;
  exitCode: number;
  durationMs: number;
  errorClass: string | null;
  filesTouched: string[];
}

interface ToolWrapperConfig {
  onExecution?: (result: ToolExecutionResult) => void;
}

export class ToolWrapper {
  private tools = new Map<string, ToolDefinition>();
  private config: ToolWrapperConfig;

  constructor(config: ToolWrapperConfig = {}) {
    this.config = config;
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      const result: ToolExecutionResult = {
        toolName: name,
        output: null,
        exitCode: 1,
        durationMs: 0,
        errorClass: "ToolNotFound",
        filesTouched: [],
      };
      this.config.onExecution?.(result);
      return result;
    }

    const start = performance.now();
    try {
      const output = await tool.execute(args);
      const durationMs = Math.round(performance.now() - start);
      const filesTouched = extractFilePaths(args);
      const result: ToolExecutionResult = {
        toolName: name,
        output,
        exitCode: 0,
        durationMs,
        errorClass: null,
        filesTouched,
      };
      this.config.onExecution?.(result);
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorClass = errorMessage.split(":")[0].trim();
      const result: ToolExecutionResult = {
        toolName: name,
        output: null,
        exitCode: 1,
        durationMs,
        errorClass,
        filesTouched: [],
      };
      this.config.onExecution?.(result);
      return result;
    }
  }

  getToolDefinitions(): { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

function extractFilePaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const value of Object.values(args)) {
    if (typeof value === "string" && (value.includes("/") || value.includes("."))) {
      paths.push(value);
    }
  }
  return paths;
}
