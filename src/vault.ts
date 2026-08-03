import { App, TFile, TFolder, normalizePath } from "obsidian";
import type MannCaveHQPlugin from "./main";

declare global {
  interface Window {
    moment: any;
  }
}

export type AreaId = "wwp" | "kingdom" | "manncave";

export interface AreaSection {
  label: string;
  path: string;
  template: string | null; // filename in templates folder, no extension
  newLabel: string;
}

export interface AreaConfig {
  id: AreaId;
  name: string;
  short: string;
  root: string;
  voiceFile: string;
  sections: AreaSection[];
}

export const AREAS: AreaConfig[] = [
  {
    id: "wwp",
    name: "WorldWidePeptides",
    short: "WWP",
    root: "02 - WWP",
    voiceFile: "Brand Voice - WWP",
    sections: [
      { label: "Projects", path: "02 - WWP/Projects", template: "Project Template", newLabel: "New project" },
      { label: "Development", path: "02 - WWP/Development", template: null, newLabel: "New note" },
      { label: "Business", path: "02 - WWP/Business", template: null, newLabel: "New note" },
      { label: "Content Hub", path: "02 - WWP/Content Hub", template: "Content Idea Template", newLabel: "New idea" },
    ],
  },
  {
    id: "kingdom",
    name: "Kingdom Athletics",
    short: "Kingdom",
    root: "03 - Kingdom Athletics",
    voiceFile: "Brand Voice - Kingdom Athletics",
    sections: [
      { label: "Blog Posts", path: "03 - Kingdom Athletics/Blog Posts", template: "Blog Post Template", newLabel: "New post" },
      { label: "Merch Ideas", path: "03 - Kingdom Athletics/Merch/Ideas", template: "Merch Idea Template", newLabel: "New merch idea" },
      { label: "Merch Mockups", path: "03 - Kingdom Athletics/Merch/Mockups", template: null, newLabel: "New note" },
      { label: "Future Plans", path: "03 - Kingdom Athletics/Future Plans", template: null, newLabel: "New note" },
      { label: "Content Hub", path: "03 - Kingdom Athletics/Content Hub", template: "Content Idea Template", newLabel: "New idea" },
    ],
  },
  {
    id: "manncave",
    name: "MannCave Media",
    short: "MannCave",
    root: "04 - MannCave Media",
    voiceFile: "Brand Voice - MannCave Media",
    sections: [
      { label: "Episodes", path: "04 - MannCave Media/Podcast - MannCave Unfiltered/Episodes", template: "Podcast Episode Template", newLabel: "New episode" },
      { label: "Vlogs & Updates", path: "04 - MannCave Media/Vlogs & Updates", template: null, newLabel: "New note" },
      { label: "Streams", path: "04 - MannCave Media/Streams", template: null, newLabel: "New note" },
      { label: "Content Hub", path: "04 - MannCave Media/Content Hub", template: "Content Idea Template", newLabel: "New idea" },
    ],
  },
];

export interface NoteInfo {
  file: TFile;
  title: string;
  status: string | null;
  type: string | null;
  mtime: number;
}

export class VaultData {
  constructor(private plugin: MannCaveHQPlugin) {}

  get app(): App {
    return this.plugin.app;
  }

  private moment() {
    return window.moment;
  }

  listNotes(folderPath: string): NoteInfo[] {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];
    const notes: NoteInfo[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        const fm = this.app.metadataCache.getFileCache(child)?.frontmatter ?? {};
        if (fm.type === "hub" || fm.type === "overview" || fm.type === "info") continue;
        notes.push({
          file: child,
          title: child.basename,
          status: fm.status ?? null,
          type: fm.type ?? null,
          mtime: child.stat.mtime,
        });
      }
    }
    return notes.sort((a, b) => b.mtime - a.mtime);
  }

  countByStatus(area: AreaConfig): { ideas: number; active: number; total: number } {
    let ideas = 0;
    let active = 0;
    let total = 0;
    for (const s of area.sections) {
      for (const n of this.listNotes(s.path)) {
        total++;
        if (n.status === "idea") ideas++;
        if (n.status === "in-progress") active++;
      }
    }
    return { ideas, active, total };
  }

  async ensureFolder(path: string) {
    const p = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(p)) {
      await this.app.vault.createFolder(p).catch(() => {});
    }
  }

  private fillTemplate(raw: string, title: string): string {
    const m = this.moment();
    return raw
      .replace(/{{title}}/g, title)
      .replace(/{{date(?::([^}]+))?}}/g, (_match, fmt) => m().format(fmt || "YYYY-MM-DD"));
  }

  async readTemplate(templateName: string | null): Promise<string> {
    if (!templateName) return "";
    const path = normalizePath(`${this.plugin.settings.templatesFolder}/${templateName}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return await this.app.vault.read(file);
    return "";
  }

  async createNote(section: AreaSection, title: string): Promise<TFile> {
    await this.ensureFolder(section.path);
    const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
    let path = normalizePath(`${section.path}/${safe}.md`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${section.path}/${safe} ${++i}.md`);
    }
    const raw = await this.readTemplate(section.template);
    const content = raw ? this.fillTemplate(raw, safe) : `# ${safe}\n\n`;
    return await this.app.vault.create(path, content);
  }

  async openFile(file: TFile) {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  todayPath(): string {
    const m = this.moment();
    return normalizePath(`${this.plugin.settings.dailyFolder}/${m().format("YYYY-MM-DD")}.md`);
  }

  async getOrCreateToday(): Promise<TFile> {
    const path = this.todayPath();
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    await this.ensureFolder(this.plugin.settings.dailyFolder);
    const raw = await this.readTemplate("Daily Recap Template");
    const m = this.moment();
    const content = raw
      ? this.fillTemplate(raw, m().format("YYYY-MM-DD"))
      : `# ${m().format("dddd, MMMM D, YYYY")}\n\n## Notes\n\n- \n`;
    return await this.app.vault.create(path, content);
  }

  /** Append a bullet to today's daily note under a section header. */
  async quickCapture(text: string, areaHeader: string | null) {
    const file = await this.getOrCreateToday();
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const target = areaHeader ?? "## 📝 Notes & Thoughts";
    let idx = lines.findIndex((l) => l.trim() === target || l.trim().startsWith(target));
    if (idx === -1) {
      // fall back: append at end
      await this.app.vault.modify(file, content.trimEnd() + `\n\n- ${text}\n`);
      return;
    }
    // insert after header (skip a blank line if present)
    let insertAt = idx + 1;
    if (lines[insertAt] !== undefined && lines[insertAt].trim() === "") insertAt++;
    lines.splice(insertAt, 0, `- ${text}`);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  async readBrandVoice(area: AreaConfig): Promise<string> {
    const path = normalizePath(`${this.plugin.settings.systemFolder}/${area.voiceFile}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return await this.app.vault.read(file);
    return "";
  }

  async saveTranscript(
    areaName: string | null,
    modelName: string,
    messages: { role: string; content: string }[]
  ): Promise<TFile> {
    const folder = this.plugin.settings.transcriptsFolder;
    await this.ensureFolder(folder);
    const m = this.moment();
    const stamp = m().format("YYYY-MM-DD HH-mm");
    const firstUser = messages.find((x) => x.role === "user")?.content ?? "Conversation";
    const topic = firstUser.replace(/[\\/:*?"<>|#^[\]\n]/g, " ").trim().slice(0, 48) || "Conversation";
    let path = normalizePath(`${folder}/${stamp} — ${topic}.md`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${stamp} — ${topic} (${++i}).md`);
    }
    const areaId = areaName ? AREAS.find((a) => a.name === areaName)?.id ?? "" : "";
    const body = messages
      .map((msg) =>
        msg.role === "user" ? `### 🧑 You\n\n${msg.content}\n` : `### 🤖 AI\n\n${msg.content}\n`
      )
      .join("\n");
    const content = `---\narea: ${areaId}\ntype: transcript\nmodel: ${modelName}\ndate: ${m().format(
      "YYYY-MM-DD HH:mm"
    )}\ntags: []\n---\n\n# ${topic}\n\n> [!info] AI Conversation\n> **Model:** ${modelName} — **Brand context:** ${
      areaName ?? "None"
    } — **Date:** ${m().format("YYYY-MM-DD")}\n\n---\n\n${body}\n---\n\n## Key Takeaways\n\n- \n\n## Action Items\n\n- [ ] \n`;
    return await this.app.vault.create(path, content);
  }
}
