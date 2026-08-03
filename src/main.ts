import { Plugin } from "obsidian";
import { HQView, VIEW_TYPE_HQ } from "./view";
import { DEFAULT_SETTINGS, HQSettings, HQSettingTab } from "./settings";

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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
