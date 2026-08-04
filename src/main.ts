import { Plugin } from "obsidian";
import { HQView, VIEW_TYPE_HQ } from "./view";
import { DEFAULT_SETTINGS, HQSettings, HQSettingTab } from "./settings";
import type { ChatUsage } from "./ai";

export default class MannCaveHQPlugin extends Plugin {
  settings: HQSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_HQ, (leaf) => new HQView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Open MannCave HQ", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new HQSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_HQ)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_HQ, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /** Add one request's tokens to the persisted usage log (kept for 90 days). */
  recordUsage(providerLabel: string, model: string, usage: ChatUsage) {
    const m = (window as any).moment;
    const day = m().format("YYYY-MM-DD");
    const log = this.settings.usageLog ?? (this.settings.usageLog = {});
    const dayLog = log[day] ?? (log[day] = {});
    const key = `${providerLabel} · ${model}`;
    const entry = dayLog[key] ?? (dayLog[key] = { in: 0, out: 0, requests: 0 });
    entry.in += usage.inputTokens;
    entry.out += usage.outputTokens;
    entry.requests += 1;
    const cutoff = m().subtract(90, "days").format("YYYY-MM-DD");
    for (const d of Object.keys(log)) {
      if (d < cutoff) delete log[d];
    }
    void this.saveSettings();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
