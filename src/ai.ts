import { requestUrl } from "obsidian";
import type { HQSettings } from "./settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIProvider {
  label: string;
  modelName: string;
  chat(system: string, messages: ChatMessage[]): Promise<string>;
}

class AnthropicProvider implements AIProvider {
  label = "Anthropic";
  constructor(private apiKey: string, public modelName: string) {}

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    if (!this.apiKey) {
      throw new Error("No Anthropic API key set. Add one in Settings → MannCave HQ.");
    }
    const res = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
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
}

class OllamaProvider implements AIProvider {
  label = "Ollama";
  constructor(private baseUrl: string, public modelName: string) {}

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    const res = await requestUrl({
      url: `${this.baseUrl.replace(/\/$/, "")}/api/chat`,
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
}

class OpenAICompatProvider implements AIProvider {
  label = "OpenRouter";
  constructor(private baseUrl: string, private apiKey: string, public modelName: string) {}

  async chat(system: string, messages: ChatMessage[]): Promise<string> {
    if (!this.modelName) {
      throw new Error("No model set. Pick a model ID in Settings → MannCave HQ (see openrouter.ai/models).");
    }
    const all = system ? [{ role: "system", content: system }, ...messages] : messages;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    headers["x-title"] = "MannCave HQ";
    const res = await requestUrl({
      url: `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.modelName, messages: all }),
      throw: false,
    });
    if (res.status >= 400) {
      const msg = res.json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Provider error: ${msg}`);
    }
    return res.json?.choices?.[0]?.message?.content ?? "";
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
  if (settings.provider === "ollama") {
    return new OllamaProvider(settings.ollamaUrl, settings.ollamaModel);
  }
  return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel);
}
