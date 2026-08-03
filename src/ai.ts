import { requestUrl } from "obsidian";
import type { HQSettings } from "./settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Called with the full accumulated text each time new tokens arrive. */
export type StreamCallback = (text: string) => void;

export interface AIProvider {
  label: string;
  modelName: string;
  chat(system: string, messages: ChatMessage[]): Promise<string>;
  /**
   * Streamed variant of chat(). Falls back to non-streaming automatically
   * when the runtime can't stream from the provider (e.g. CORS), so callers
   * can always use this.
   */
  chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<string>;
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

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
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
    return blocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<string> {
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
      const text = await this.chat(system, messages);
      onDelta(text);
      return text;
    }
    if (!res.ok || !res.body) throw await errorFromResponse(res, "Anthropic");
    let text = "";
    for await (const line of readLines(res)) {
      if (!line.startsWith("data:")) continue;
      let json: any;
      try {
        json = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        text += json.delta.text;
        onDelta(text);
      } else if (json.type === "error") {
        throw new Error(`Anthropic error: ${json.error?.message ?? "stream error"}`);
      }
    }
    return text;
  }
}

class OllamaProvider implements AIProvider {
  label = "Ollama";
  constructor(private baseUrl: string, public modelName: string) {}

  private url(): string {
    return `${this.baseUrl.replace(/\/$/, "")}/api/chat`;
  }

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
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
    return res.json?.message?.content ?? "";
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<string> {
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
      const text = await this.chat(system, messages);
      onDelta(text);
      return text;
    }
    if (!res.ok || !res.body) {
      throw new Error(`Ollama error: HTTP ${res.status}. Is Ollama running at ${this.baseUrl}?`);
    }
    let text = "";
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
      if (json.done) break;
    }
    return text;
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

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
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
    return res.json?.choices?.[0]?.message?.content ?? "";
  }

  async chatStream(system: string, messages: ChatMessage[], onDelta: StreamCallback): Promise<string> {
    this.requireModel();
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ model: this.modelName, messages: all, stream: true }),
      });
    } catch {
      const text = await this.chat(system, messages);
      onDelta(text);
      return text;
    }
    if (!res.ok || !res.body) throw await errorFromResponse(res, this.label);
    let text = "";
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
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(text);
      }
    }
    return text;
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
