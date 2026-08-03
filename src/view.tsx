import { ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { StrictMode } from "react";
import type MannCaveHQPlugin from "./main";
import { App } from "./ui/App";

export const VIEW_TYPE_HQ = "manncave-hq-view";

export class HQView extends ItemView {
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MannCaveHQPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_HQ;
  }

  getDisplayText() {
    return "MannCave HQ";
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("mch-container");
    this.root = createRoot(container);
    this.root.render(
      <StrictMode>
        <App plugin={this.plugin} />
      </StrictMode>
    );
  }

  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
