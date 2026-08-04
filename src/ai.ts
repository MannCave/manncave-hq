import { requestUrl } from "obsidian";
import type { HQSettings } from "./settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Token usage for one request. `estimated` when the provider didn't report it. */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
}

/** Called with the full accumulated text each time new tokens arrive. */
export type StreamCallback = (text: string) => void;

export interface AIProvider {
  label: string;
  modelName: string;
  chat(system: string, messages: ChatMessage[]): Promise<ChatResult>;
  /**
   * Streamed variant of chat(). Falls back to non-streaming automatically
   * when the runtime can't stream from the provider (e.g. CORS), so callers
   * can always use this.
   */
  chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<ChatResult>;
}

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function buildUsage(
  inTokens: number | null | undefined,
  outTokens: number | null | undefined,
  system: string,
  messages: ChatMessage[],
  text: string
): ChatUsage {
  const haveBoth = inTokens != null && outTokens != null;
  return {
    inputTokens:
      inTokens ?? estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.content), 0),
    outputTokens: outTokens ?? estimateTokens(text),
    estimated: !haveBoth,
  };
}

/** Yield decoded lines (without trailing newline) from a streaming response body. */
async function* readLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      yield buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.trim()) yield buf;
}

async function errorFromResponse(res: Response, label: string): Promise<Error> {
  let msg = `HTTP ${res.status}`;
  try {
    const body = JSON.parse(await res.text());
    msg = body?.error?.message ?? body?.error ?? msg;
  } catch {
    /* keep HTTP status */
  }
  return new Error(`${label} error: ${msg}`);
}

class AnthropicProvider implements AIProvider {
  label = "Anthropic";
  constructor(private apiKey: string, public modelName: string) {}

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    };
  }

  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error("No Anthropic API key set. Add one in Settings → MannCave HQ.");
    }
    const res = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 2048,
        system: system || undefined,
        messages,
      }),
      throw: false,
    });
    if (res.status >= 400) {
      const msg = res.json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Anthropic error: ${msg}`);
    }
    const blocks = res.json?.content ?? [];
    const text = blocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    const u = res.json?.usage;
    return { text, usage: buildUsage(u?.input_tokens, u?.output_tokens, system, messages, text) };
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error("No Anthropic API key set. Add one in Settings → MannCave HQ.");
    }
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.modelName,
          max_tokens: 2048,
          system: system || undefined,
          messages,
          stream: true,
        }),
      });
    } catch {
      const result = await this.chat(system, messages);
      onDelta(result.text);
      return result;
    }
    if (!res.ok || !res.body) throw await errorFromResponse(res, "Anthropic");
    let text = "";
    let inTok: number | null = null;
    let outTok: number | null = null;
    for await (const line of readLines(res)) {
      if (!line.startsWith("data:")) continue;
      let json: any;
      try {
        json = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (json.type === "message_start") {
        inTok = json.message?.usage?.input_tokens ?? inTok;
      } else if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        text += json.delta.text;
        onDelta(text);
      } else if (json.type === "message_delta") {
        outTok = json.usage?.output_tokens ?? outTok;
      } else if (json.type === "error") {
        throw new Error(`Anthropic error: ${json.error?.message ?? "stream error"}`);
      }
    }
    return { text, usage: buildUsage(inTok, outTok, system, messages, text) };
  }
}

class OllamaProvider implements AIProvider {
  label = "Ollama";
  constructor(private baseUrl: string, public modelName: string) {}

  private url(): string {
    return `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
  }

  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    const res = await requestUrl({
      url: this.url(),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.modelName, messages: all, stream: false }),
      throw: false,
    });
    if (res.status >= 400) {
      throw new Error(`Ollama error: HTTP ${res.status}. Is Ollama running at ${this.baseUrl}?`);
    }
    const text = res.json?.message?.content ?? "";
    return {
      text,
      usage: buildUsage(res.json?.prompt_eval_count, res.json?.eval_count, system, messages, text),
    };
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<ChatResult> {
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.modelName, messages: all, stream: true }),
      });
    } catch {
      // Ollama only allows cross-origin requests when OLLAMA_ORIGINS is set;
      // requestUrl bypasses CORS, so fall back to the non-streaming path.
      const result = await this.chat(system, messages);
      onDelta(result.text);
      return result;
    }
    if (!res.ok || !res.body) {
      throw new Error(`Ollama error: HTTP ${res.status}. Is Ollama running at ${this.baseUrl}?`);
    }
    let text = "";
    let inTok: number | null = null;
    let outTok: number | null = null;
    for await (const line of readLines(res)) {
      let json: any;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      if (json.error) throw new Error(`Ollama error: ${json.error}`);
      if (json.message?.content) {
        text += json.message.content;
        onDelta(text);
      }
      if (json.done) {
        inTok = json.prompt_eval_count ?? inTok;
        outTok = json.eval_count ?? outTok;
        break;
      }
    }
    return { text, usage: buildUsage(inTok, outTok, system, messages, text) };
  }
}

class OpenAICompatProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    public modelName: string,
    public label = "OpenRouter",
    private modelHint = "see openrouter.ai/models",
    /** When set, an API key is mandatory and this message is shown if it's missing. */
    private missingKeyMessage: string | null = null
  ) {}

  private url(): string {
    return `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    headers["x-title"] = "MannCave HQ";
    return headers;
  }

  private requireModel() {
    if (this.missingKeyMessage && !this.apiKey) {
      throw new Error(this.missingKeyMessage);
    }
    if (!this.modelName) {
      throw new Error(`No model set. Pick a model ID in Settings → MannCave HQ (${this.modelHint}).`);
    }
  }

  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    this.requireModel();
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    const res = await requestUrl({
      url: this.url(),
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelName, messages: all }),
      throw: false,
    });
    if (res.status >= 400) {
      const msg = res.json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`${this.label} error: ${msg}`);
    }
    const text = res.json?.choices?.[0]?.message?.content ?? "";
    const u = res.json?.usage;
    return { text, usage: buildUsage(u?.prompt_tokens, u?.completion_tokens, system, messages, text) };
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<ChatResult> {
    this.requireModel();
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.modelName,
          messages: all,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
    } catch {
      const result = await this.chat(system, messages);
      onDelta(result.text);
      return result;
    }
    if (!res.ok || !res.body) throw await errorFromResponse(res, this.label);
    let text = "";
    let inTok: number | null = null;
    let outTok: number | null = null;
    for await (const line of readLines(res)) {
      if (!line.startsWith("data:")) continue; // skips OpenRouter ": PROCESSING" keep-alives
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") break;
      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (json.error) throw new Error(`${this.label} error: ${json.error?.message ?? "stream error"}`);
      if (json.usage) {
        inTok = json.usage.prompt_tokens ?? inTok;
        outTok = json.usage.completion_tokens ?? outTok;
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(text);
      }
    }
    return { text, usage: buildUsage(inTok, outTok, system, messages, text) };
  }
}

export function getProvider(settings: HQSettings): AIProvider {
  if (settings.provider === "openai_compat") {
    return new OpenAICompatProvider(
      settings.compatBaseUrl || "https://openrouter.ai/api/v1",
      settings.compatApiKey,
      settings.compatModel
    );
  }
  if (settings.provider === "nvidia") {
    return new OpenAICompatProvider(
      "https://integrate.api.nvidia.com/v1",
      settings.nvidiaApiKey,
      settings.nvidiaModel,
      "NVIDIA",
      "see build.nvidia.com",
      "No NVIDIA API key set. Create one at build.nvidia.com and add it in Settings → MannCave HQ."
    );
  }
  if (settings.provider === "ollama") {
    return new OllamaProvider(settings.ollamaUrl, settings.ollamaModel);
  }
  return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel);
}
