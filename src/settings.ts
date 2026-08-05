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
  provider: "anthropic" | "ollama" | "openai_compat" | "nvidia" | "deepseek";
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  compatBaseUrl: string;
  compatApiKey: string;
  compatModel: string;
  nvidiaApiKey: string;
  nvidiaModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
  dailyFolder: string;
  transcriptsFolder: string;
  templatesFolder: string;
  systemFolder: string;
  usageLog: UsageLog;
  githubUser: string;
  githubToken: string;
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
  deepseekApiKey: "",
  deepseekModel: "deepseek-v4-flash",
  dailyFolder: "01 - Daily Recap",
  transcriptsFolder: "05 - AI Transcripts",
  templatesFolder: "06 - Templates",
  systemFolder: "07 - System",
  usageLog: {},
  githubUser: "MannCave",
  githubToken: "",
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
          .addOption("deepseek", "DeepSeek")
          .addOption("nvidia", "NVIDIA (build.nvidia.com)")
          .addOption("ollama", "Ollama (local)")
          .setValue(this.plugin.settings.provider)
          .onChange(async (v: HQSettings["provider"]) => {
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
      .setDesc("Works with OpenRouter, vLLM, LM Studio, LiteLLM, and other OpenAI-compatible endpoints. DeepSeek now has its own provider option above.")
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
      .setName("DeepSeek API key")
      .setDesc("Create one at platform.deepseek.com → API keys. Billed per token; very inexpensive.")
      .addText((t) =>
        t
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async (v) => {
            this.plugin.settings.deepseekApiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek model")
      .setDesc(
        "V4 Flash is the everyday pick — fast and cheap, ideal for AUTO routing and quick chats. " +
          "V4 Pro is the heavyweight for brand-voice drafting and Link Forge judgement."
      )
      .addDropdown((d) =>
        d
          .addOption("deepseek-v4-flash", "V4 Flash — fast & cheap (recommended)")
          .addOption("deepseek-v4-pro", "V4 Pro — highest quality")
          .setValue(
            ["deepseek-v4-flash", "deepseek-v4-pro"].includes(this.plugin.settings.deepseekModel)
              ? this.plugin.settings.deepseekModel
              : "deepseek-v4-flash"
          )
          .onChange(async (v) => {
            this.plugin.settings.deepseekModel = v;
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

    new Setting(containerEl).setName("GitHub").setHeading();

    new Setting(containerEl)
      .setName("GitHub username")
      .setDesc("Powers the Dev tab (repos, commit pulse). If you set a token below, use the same account.")
      .addText((t) =>
        t.setValue(this.plugin.settings.githubUser).onChange(async (v) => {
          this.plugin.settings.githubUser = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("GitHub token (optional)")
      .setDesc(
        createFragment((f) => {
          f.createDiv({
            text:
              "Without a token the Dev tab shows public repos only. Add one and private repos, " +
              "their commits, PRs, issues, and CI runs are folded into every GitHub readout.",
          });
          f.createDiv({
            text:
              "Easiest: a classic token with the 'repo' scope (github.com/settings/tokens) — " +
              "that covers everything below in one checkbox.",
          });
          f.createDiv({
            text:
              "Tighter: a fine-grained token scoped to the repos you want, with repository " +
              "permissions Metadata, Contents, Pull requests, Issues and Actions set to Read, " +
              "plus the account permission 'Events' set to Read — without Events, private " +
              "commits stay invisible even for repos the token can see.",
          });
          f.createDiv({
            cls: "mod-warning",
            text:
              "Heads up: with private repos in scope, 'LOG COMMITS' writes private commit " +
              "messages into your daily note. Keep that in mind if this vault is backed up " +
              "anywhere public.",
          });
        })
      )
      .addText((t) =>
        t
          .setPlaceholder("github_pat_...")
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (v) => {
            this.plugin.settings.githubToken = v.trim();
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
