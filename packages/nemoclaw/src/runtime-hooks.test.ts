import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeTracker, type TrackerEvent } from "./runtime-hooks";

describe("RuntimeTracker", () => {
  let tracker: RuntimeTracker;
  let events: TrackerEvent[];

  beforeEach(() => {
    events = [];
    tracker = new RuntimeTracker({
      onEvent: (event) => events.push(event),
      phoenixEndpoint: "http://localhost:4317",
    });
  });

  describe("startRun", () => {
    it("emits a run_start event with run and branch IDs", () => {
      const result = tracker.startRun({
        title: "Research report",
        userTask: "Create report from allowed docs",
      });
      expect(result.runId).toBeTruthy();
      expect(result.branchId).toBeTruthy();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("run_start");
      expect(events[0].runId).toBe(result.runId);
    });

    it("sets provider to nvidia and model to nemotron", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      expect(events[0].attributes.provider).toBe("nvidia");
      expect(events[0].attributes.model).toBe("nemotron");
    });
  });

  describe("beforeModelCall / afterModelCall", () => {
    it("tracks a model call with start and end events", () => {
      const { runId, branchId } = tracker.startRun({ title: "Test", userTask: "test" });
      const callId = tracker.beforeModelCall({
        promptRef: "prompts/test.json",
        contextRef: "contexts/test.json",
      });
      expect(callId).toBeTruthy();
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("model_call_start");

      tracker.afterModelCall(callId, {
        outputRef: "outputs/test.json",
        tokenCount: { input: 100, output: 50 },
        latencyMs: 1200,
        toolCallsValid: true,
      });
      expect(events).toHaveLength(3);
      expect(events[2].type).toBe("model_call_end");
      expect(events[2].attributes.latencyMs).toBe(1200);
    });
  });

  describe("beforeToolCall / afterToolCall", () => {
    it("tracks a tool call lifecycle", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      const callId = tracker.beforeToolCall({
        toolName: "cat",
        inputJson: '{"path": "./research/paper.md"}',
      });
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("tool_call_start");
      expect(events[1].attributes.toolName).toBe("cat");

      tracker.afterToolCall(callId, {
        outputRef: "outputs/tool_1.json",
        exitCode: 0,
        durationMs: 150,
        errorClass: null,
        filesTouched: ["./research/paper.md"],
      });
      expect(events).toHaveLength(3);
      expect(events[2].type).toBe("tool_call_end");
      expect(events[2].attributes.exitCode).toBe(0);
    });

    it("records failed tool calls", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      const callId = tracker.beforeToolCall({
        toolName: "rm",
        inputJson: '{"path": "./private/keys.txt"}',
      });
      tracker.afterToolCall(callId, {
        outputRef: null,
        exitCode: 1,
        durationMs: 5,
        errorClass: "PermissionDenied",
        filesTouched: [],
      });
      expect(events[2].attributes.exitCode).toBe(1);
      expect(events[2].attributes.errorClass).toBe("PermissionDenied");
    });
  });

  describe("captureMemory", () => {
    it("emits a memory_update event", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.captureMemory({ key: "findings", value: "scaling laws" });
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("memory_update");
    });
  });

  describe("captureDiff", () => {
    it("emits a file_diff event", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.captureDiff("./output/report.md", "+# Report\n+Content here");
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("file_diff");
      expect(events[1].attributes.path).toBe("./output/report.md");
    });
  });

  describe("recordPolicyDecision", () => {
    it("emits a policy_allow event for allowed actions", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.recordPolicyDecision({
        actionType: "file_read",
        decision: "allow",
        resource: "./research/paper.md",
        normalizedResource: "./research/**",
        policyRuleId: "rule_1",
        policyRuleText: "allow_read: ./research/**",
        policyPath: "files.allow_read[0]",
        reason: "Matches allow pattern",
        actor: "openshell",
      });
      expect(events[1].type).toBe("policy_allow");
    });

    it("emits a policy_deny event for denied actions", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.recordPolicyDecision({
        actionType: "file_read",
        decision: "deny",
        resource: "./private/api_keys.txt",
        normalizedResource: "./private/**",
        policyRuleId: "rule_2",
        policyRuleText: "deny_read: ./private/**",
        policyPath: "files.deny_read[0]",
        reason: "Matches deny pattern",
        actor: "openshell",
      });
      expect(events[1].type).toBe("policy_deny");
      expect(events[1].attributes.decision).toBe("deny");
    });
  });

  describe("createCheckpoint", () => {
    it("emits a checkpoint event and returns a checkpoint ID", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      const cpId = tracker.createCheckpoint({
        memory: { key: "value" },
        policyYaml: "files:\n  allow_read:\n    - ./research/**",
      });
      expect(cpId).toBeTruthy();
      expect(events[1].type).toBe("checkpoint");
      expect(events[1].attributes.checkpointId).toBe(cpId);
    });
  });

  describe("validate", () => {
    it("emits a validation event", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.validate({
        status: "pass",
        evidence: ["report exists", "content valid"],
      });
      expect(events[1].type).toBe("validation");
      expect(events[1].attributes.status).toBe("pass");
    });
  });

  describe("endRun", () => {
    it("emits a run_end event", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      tracker.endRun("completed");
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("run_end");
      expect(events[1].attributes.status).toBe("completed");
    });
  });

  describe("event stream", () => {
    it("assigns sequential node IDs with parent chains", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      const mc = tracker.beforeModelCall({ promptRef: "p", contextRef: "c" });
      tracker.afterModelCall(mc, { outputRef: "o", tokenCount: { input: 1, output: 1 }, latencyMs: 10, toolCallsValid: true });
      const tc = tracker.beforeToolCall({ toolName: "cat", inputJson: "{}" });
      tracker.afterToolCall(tc, { outputRef: "o", exitCode: 0, durationMs: 5, errorClass: null, filesTouched: [] });

      expect(events[0].nodeId).toBeTruthy();
      expect(events[1].parentNodeId).toBe(events[0].nodeId);
    });

    it("includes timestamps on all events", () => {
      tracker.startRun({ title: "Test", userTask: "test" });
      expect(events[0].timestamp).toBeTruthy();
      expect(new Date(events[0].timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe("getSpans", () => {
    it("returns OpenInference-compatible spans for all events", () => {
      const { runId, branchId } = tracker.startRun({ title: "Test", userTask: "test" });
      tracker.beforeModelCall({ promptRef: "p", contextRef: "c" });
      const spans = tracker.getSpans();
      expect(spans.length).toBeGreaterThanOrEqual(2);
      expect(spans[0].runId).toBe(runId);
      expect(spans[0].branchId).toBe(branchId);
      expect(spans[0].provider).toBe("nvidia");
      expect(spans[0].model).toBe("nemotron");
    });
  });
});
