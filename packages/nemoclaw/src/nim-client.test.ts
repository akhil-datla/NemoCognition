import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NimClient,
  formatModelOutputForCapture,
  type NimMessage,
} from "./nim-client";

describe("NimClient", () => {
  let client: NimClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new NimClient({
      endpoint: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-test-key",
      model: "nvidia/llama-3.1-nemotron-70b-instruct",
      fetch: mockFetch,
    });
  });

  it("sends chat completion request to NIM endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chatcmpl-123",
        choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const messages: NimMessage[] = [{ role: "user", content: "Hi" }];
    const result = await client.chat(messages);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer nvapi-test-key");
    expect(result.content).toBe("Hello");
    expect(result.tokenCount.input).toBe(10);
    expect(result.tokenCount.output).toBe(5);
  });

  it("includes tools in request when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chatcmpl-456",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"test.md"}' } }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    });

    const tools = [{
      type: "function" as const,
      function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
    }];
    const result = await client.chat([{ role: "user", content: "Read test.md" }], { tools });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read_file");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
    });

    await expect(client.chat([{ role: "user", content: "Hi" }])).rejects.toThrow("NIM API error: 401");
  });

  it("reports provider as nvidia and model as nemotron", () => {
    expect(client.provider).toBe("nvidia");
    expect(client.model).toBe("nemotron");
  });

  it("parses reasoning_content when content is null and there are no tool calls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "Thinking step by step…",
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.content).toBe("Thinking step by step…");
    expect(result.reasoningContent).toBe("Thinking step by step…");
  });

  it("exposes reasoning_content separately when tool_calls are present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "I will list the directory first.",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "list_directory", arguments: '{"path":"apps/web/src/lib"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    });

    const result = await client.chat([{ role: "user", content: "List lib" }], {
      tools: [{
        type: "function",
        function: { name: "list_directory", description: "List dir", parameters: {} },
      }],
    });

    expect(result.content).toBeNull();
    expect(result.reasoningContent).toBe("I will list the directory first.");
    expect(result.toolCalls).toHaveLength(1);
    expect(formatModelOutputForCapture(result)).toBe("I will list the directory first.");
  });
});

describe("formatModelOutputForCapture", () => {
  it("formats tool calls when content and reasoning are empty", () => {
    const text = formatModelOutputForCapture({
      content: null,
      toolCalls: [{ id: "c1", name: "read_file", arguments: '{"path":"x"}' }],
    });
    expect(text).toContain("Tool call: read_file");
    expect(text).toContain('"path": "x"');
  });
});
