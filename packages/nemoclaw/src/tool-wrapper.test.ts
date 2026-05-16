import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolWrapper, type ToolDefinition, type ToolExecutionResult } from "./tool-wrapper";

describe("ToolWrapper", () => {
  let wrapper: ToolWrapper;
  let executionLog: ToolExecutionResult[];

  beforeEach(() => {
    executionLog = [];
    wrapper = new ToolWrapper({
      onExecution: (result) => executionLog.push(result),
    });
  });

  it("registers and executes a tool", async () => {
    const tool: ToolDefinition = {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async (args) => ({ content: `Contents of ${args.path}` }),
    };

    wrapper.register(tool);
    const result = await wrapper.execute("read_file", { path: "test.md" });

    expect(result.output).toEqual({ content: "Contents of test.md" });
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.errorClass).toBeNull();
    expect(result.filesTouched).toEqual(["test.md"]);
  });

  it("captures execution failures", async () => {
    const tool: ToolDefinition = {
      name: "delete_file",
      description: "Delete a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async () => { throw new Error("PermissionDenied: cannot delete"); },
    };

    wrapper.register(tool);
    const result = await wrapper.execute("delete_file", { path: "/private/keys.txt" });

    expect(result.exitCode).toBe(1);
    expect(result.errorClass).toBe("PermissionDenied");
    expect(result.output).toBeNull();
  });

  it("reports tool not found", async () => {
    const result = await wrapper.execute("nonexistent", {});
    expect(result.exitCode).toBe(1);
    expect(result.errorClass).toBe("ToolNotFound");
  });

  it("lists registered tools as function definitions", () => {
    wrapper.register({
      name: "cat",
      description: "Read file contents",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async () => ({}),
    });

    const tools = wrapper.getToolDefinitions();
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("cat");
  });

  it("notifies onExecution callback", async () => {
    wrapper.register({
      name: "echo",
      description: "Echo input",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      execute: async (args) => ({ text: args.text }),
    });

    await wrapper.execute("echo", { text: "hello" });
    expect(executionLog).toHaveLength(1);
    expect(executionLog[0].toolName).toBe("echo");
  });
});
