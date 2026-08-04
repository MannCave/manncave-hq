import { App, PluginSettingTab, Setting } from "obsidian";
import type MannCaveHQPlugin from "./main";

export interface UsageEntry {
  in: number;
  out: number;
  requests: number;
}

/** date (YYYY-MM-DD) → "Provider · model" → totals */
export type UsageLog = Record<string, Record<string, UsageEntry>>;

export interface HQSettings {
  provider: "anthropic" | "ollama" | "openai_compat" | "nvidia";
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  compatBaseUrl: string;
  compatApiKey: string;
  compatModel: string;
  nvidiaApiKey: string;
  nvidiaModel: string;
  dailyFolder: string;
  transcriptsFolder: string;
  templatesFolder: string;
  systemFolder: string;
  usageLog: UsageLog;
}

export const DEFAULT_SETTINGS: HQSettings = {
  provider: "anthropic",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  compatBaseUrl: "https://openrouter.ai/api/v1",
  compatApiKey: "",
  compatModel: "",
  nvidiaApiKey: "",
  nvidiaModel: "meta/llama-3.3-70b-instruct",
  dailyFolder: "01 - Daily Recap",
  transcriptsFolder: "05 - AI Transcripts",
  templatesFolder: "06 - Templates",
  systemFolder: "07 - System",
  usageLog: {},
};

export class HQSettingTab extends PluginSettingTab {
  plugin: MannCaveHQPlugin;

  constructor(app: App, plugin: MannCaveHQPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("AI").setHeading();

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which AI backend the dashboard talks to.")
      .addDropdown((d) =>
        d
          .addOption("anthropic", "Anthropic (Claude)")
          .addOption("openai_compat", "OpenRouter / OpenAI-compatible")
          .addOption("nvidia", "NVIDIA (build.nvidia.com)")
          .addOption("ollama", "Ollama (local)")
          .setValue(this.plugin.settings.provider)
          .onChange(async (v: "anthropic" | "ollama" | "openai_compat" | "nvidia") => {
            this.plugin.settings.provider = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "Stored in this vault's plugin data. With Obsidian Sync it syncs end-to-end encrypted to your devices."
      )
      .addText((t) =>
        t
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (v) => {
            this.plugin.settings.anthropicApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic model")
      .addText((t) =>
        t.setValue(this.plugin.settings.anthropicModel).onChange(async (v) => {
          this.plugin.settings.anthropicModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("OpenRouter / compatible base URL")
      .setDesc("Works with OpenRouter, vLLM, LM Studio, LiteLLM, llama.cpp server, and other OpenAI-compatible endpoints.")
      .addText((t) =>
        t.setValue(this.plugin.settings.compatBaseUrl).onChange(async (v) => {
          this.plugin.settings.compatBaseUrl = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("OpenRouter / compatible API key")
      .setDesc("For OpenRouter, create a key at openrouter.ai/keys. Leave empty for servers without auth.")
      .addText((t) =>
        t
          .setPlaceholder("sk-or-...")
          .setValue(this.plugin.settings.compatApiKey)
          .onChange(async (v) => {
            this.plugin.settings.compatApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenRouter / compatible model")
      .setDesc("Exact model ID, e.g. a ':free' model from openrouter.ai/models.")
      .addText((t) =>
        t.setValue(this.plugin.settings.compatModel).onChange(async (v) => {
          this.plugin.settings.compatModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("NVIDIA API key")
      .setDesc("Create a free key at build.nvidia.com — open any model page and click \"Get API Key\".")
      .addText((t) =>
        t
          .setPlaceholder("nvapi-...")
          .setValue(this.plugin.settings.nvidiaApiKey)
          .onChange(async (v) => {
            this.plugin.settings.nvidiaApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("NVIDIA model")
      .setDesc("Exact model ID from build.nvidia.com, e.g. meta/llama-3.3-70b-instruct or deepseek-ai/deepseek-r1.")
      .addText((t) =>
        t.setValue(this.plugin.settings.nvidiaModel).onChange(async (v) => {
          this.plugin.settings.nvidiaModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc("Local models. Works where Ollama runs (usually desktop).")
      .addText((t) =>
        t.setValue(this.plugin.settings.ollamaUrl).onChange(async (v) => {
          this.plugin.settings.ollamaUrl = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ollama model")
      .addText((t) =>
        t.setValue(this.plugin.settings.ollamaModel).onChange(async (v) => {
          this.plugin.settings.ollamaModel = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Vault folders").setHeading();

    const folderSetting = (
      name: string,
      key: keyof Pick<
        HQSettings,
        "dailyFolder" | "transcriptsFolder" | "templatesFolder" | "systemFolder"
      >
    ) =>
      new Setting(containerEl).setName(name).addText((t) =>
        t.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v.trim();
          await this.plugin.saveSettings();
        })
      );

    folderSetting("Daily Recap folder", "dailyFolder");
    folderSetting("AI Transcripts folder", "transcriptsFolder");
    folderSetting("Templates folder", "templatesFolder");
    folderSetting("System (brand voice) folder", "systemFolder");
  }
}
