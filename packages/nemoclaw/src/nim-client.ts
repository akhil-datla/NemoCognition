export interface NimMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: NimToolCall[];
  tool_call_id?: string;
}

export interface NimToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface NimToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NimResponse {
  content: string | null;
  toolCalls?: { id: string; name: string; arguments: string }[];
  tokenCount: { input: number; output: number };
  finishReason: string;
}

export interface NimConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export class NimClient {
  readonly provider = "nvidia" as const;
  readonly model = "nemotron" as const;

  private config: NimConfig;
  private fetchFn: typeof globalThis.fetch;

  constructor(config: NimConfig) {
    this.config = config;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async chat(
    messages: NimMessage[],
    options?: { tools?: NimToolDef[] },
  ): Promise<NimResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    };
    if (options?.tools?.length) {
      body.tools = options.tools;
    }

    const response = await this.fetchFn(`${this.config.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`NIM API error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    const toolCalls = message.tool_calls?.map((tc: NimToolCall) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: message.content,
      toolCalls,
      tokenCount: {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
      },
      finishReason: choice.finish_reason,
    };
  }
}
