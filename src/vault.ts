import { App, TFile, TFolder, normalizePath } from "obsidian";
import type MannCaveHQPlugin from "./main";

declare global {
  interface Window {
    moment: any;
  }
}

export type AreaId = "wwp" | "kingdom" | "manncave" | "mccrv";

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
    short: "KA",
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
  {
    id: "mccrv",
    name: "McClainsRV",
    short: "MCCRV",
    root: "08 - McClainsRV",
    voiceFile: "Brand Voice - McClainsRV",
    sections: [
      { label: "Projects", path: "08 - McClainsRV/Projects", template: "Project Template", newLabel: "New project" },
      { label: "Notes", path: "08 - McClainsRV/Notes", template: null, newLabel: "New note" },
      { label: "Content Hub", path: "08 - McClainsRV/Content Hub", template: "Content Idea Template", newLabel: "New idea" },
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

  /** Every note in an area, bucketed by pipeline status. */
  areaPipeline(area: AreaConfig): { idea: NoteInfo[]; active: NoteInfo[]; done: NoteInfo[] } {
    const out = { idea: [] as NoteInfo[], active: [] as NoteInfo[], done: [] as NoteInfo[] };
    for (const s of area.sections) {
      for (const n of this.listNotes(s.path)) {
        if (n.status === "idea") out.idea.push(n);
        else if (n.status === "in-progress") out.active.push(n);
        else if (n.status === "done") out.done.push(n);
      }
    }
    return out;
  }

  /** Write a new pipeline status into a note's frontmatter. */
  async setStatus(file: TFile, status: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = status;
    });
  }

  /**
   * Things asking for attention, worst first: stalled ideas, areas with nothing
   * active, and weeks with nothing shipped.
   */
  alerts(idleDays = 7): { areaId: AreaId; label: string; text: string; level: "warn" | "info" }[] {
    const now = Date.now();
    const idleMs = idleDays * 86400000;
    const weekMs = 7 * 86400000;
    const out: { areaId: AreaId; label: string; text: string; level: "warn" | "info" }[] = [];
    let shippedAnywhere = 0;
    for (const area of AREAS) {
      const p = this.areaPipeline(area);
      const total = p.idea.length + p.active.length + p.done.length;
      shippedAnywhere += p.done.filter((n) => now - n.mtime < weekMs).length;
      const stalled = p.idea.filter((n) => now - n.mtime > idleMs).length;
      if (stalled > 0) {
        out.push({
          areaId: area.id,
          label: area.short,
          text: `${stalled} idea${stalled === 1 ? "" : "s"} idle ${idleDays}d+`,
          level: "warn",
        });
      }
      if (total > 0 && p.active.length === 0) {
        out.push({ areaId: area.id, label: area.short, text: "nothing in progress", level: "info" });
      }
    }
    if (shippedAnywhere === 0) {
      out.push({ areaId: AREAS[0].id, label: "ALL", text: "nothing shipped this week", level: "info" });
    }
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
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

  /** The markdown note the user was last working in, even while the dashboard is focused. */
  getActiveMarkdownFile(): TFile | null {
    const direct = this.app.workspace.getActiveFile();
    if (direct && direct.extension === "md") return direct;
    let best: TFile | null = null;
    let bestTime = 0;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const file = (leaf.view as any)?.file as TFile | undefined;
      const t = (leaf as any).activeTime ?? 0;
      if (file && t >= bestTime) {
        best = file;
        bestTime = t;
      }
    }
    return best;
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + "\n\n…[truncated]" : text;
  }

  /** Contents of the active note, formatted as chat context. */
  async activeNoteContext(): Promise<string> {
    const file = this.getActiveMarkdownFile();
    if (!file) return "";
    const content = await this.app.vault.read(file);
    return `### Attached note: ${file.basename}\nPath: ${file.path}\n\n${this.truncate(content, 8000)}`;
  }

  /** Titles + statuses of every note in the given area (or all areas), formatted as chat context. */
  backlogContext(area: AreaConfig | null): string {
    const m = this.moment();
    const now = Date.now();
    const chunks: string[] = [];
    for (const a of area ? [area] : AREAS) {
      const lines: string[] = [];
      for (const s of a.sections) {
        for (const n of this.listNotes(s.path).slice(0, 30)) {
          const days = Math.floor((now - n.mtime) / 86400000);
          const age = days === 0 ? "today" : `${days}d ago`;
          lines.push(
            `- [${s.label}] ${n.title} — status: ${n.status ?? "none"}${
              n.type ? `, type: ${n.type}` : ""
            } (updated ${age})`
          );
        }
      }
      chunks.push(`### ${a.name} backlog (as of ${m().format("YYYY-MM-DD")})\n${lines.length ? lines.join("\n") : "- (empty)"}`);
    }
    return chunks.join("\n\n");
  }

  /** The last `count` daily recap notes, formatted as chat context. */
  async recentRecapsContext(count = 7): Promise<string> {
    const folder = this.app.vault.getAbstractFileByPath(
      normalizePath(this.plugin.settings.dailyFolder)
    );
    if (!(folder instanceof TFolder)) return "";
    const files = folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .sort((a, b) => b.basename.localeCompare(a.basename))
      .slice(0, count);
    const parts: string[] = [];
    for (const f of files) {
      const content = await this.app.vault.read(f);
      parts.push(`### Daily recap ${f.basename}\n\n${this.truncate(content, 2000)}`);
    }
    return parts.join("\n\n");
  }

  /** Compact catalog of recent notes + existing link pairs, for AI link suggestions. */
  async linkForgeContext(maxNotes = 80): Promise<{
    catalog: string;
    existingPairs: Set<string>;
    paths: Set<string>;
  }> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !f.path.startsWith(this.plugin.settings.templatesFolder + "/"))
      .filter((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
        return fm.type !== "hub" && fm.type !== "overview" && fm.type !== "info";
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, maxNotes);
    const lines: string[] = [];
    for (const f of files) {
      const raw = await this.app.vault.cachedRead(f);
      const body = raw
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
      lines.push(`- ${f.path} :: ${body}`);
    }
    const existingPairs = new Set<string>();
    for (const [src, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      for (const t of Object.keys(targets)) {
        existingPairs.add(src < t ? `${src}|${t}` : `${t}|${src}`);
      }
    }
    return { catalog: lines.join("\n"), existingPairs, paths: new Set(files.map((f) => f.path)) };
  }

  /** Append a wikilink to the source note under a "## Related" section (created if missing). */
  async addRelatedLink(sourcePath: string, targetPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    const target = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
    if (!(file instanceof TFile)) throw new Error(`Note not found: ${sourcePath}`);
    if (!(target instanceof TFile)) throw new Error(`Note not found: ${targetPath}`);
    const link = this.app.fileManager.generateMarkdownLink(target, file.path);
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => /^## Related\b/.test(l));
    if (idx === -1) {
      await this.app.vault.modify(file, content.trimEnd() + `\n\n## Related\n\n- ${link}\n`);
      return;
    }
    let insertAt = idx + 1;
    while (insertAt < lines.length && !/^#{1,6} /.test(lines[insertAt])) insertAt++;
    while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, `- ${link}`);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  async readBrandVoice(area: AreaConfig): Promise<string> {
    const path = normalizePath(`${this.plugin.settings.systemFolder}/${area.voiceFile}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return await this.app.vault.read(file);
    return "";
  }

  /** Create a content-idea note in the area's Content Hub from an AI chat message. */
  async sendToContentHub(area: AreaConfig, content: string): Promise<TFile> {
    const folder =
      area.sections.find((s) => s.label === "Content Hub")?.path ?? `${area.root}/Content Hub`;
    await this.ensureFolder(folder);
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const rawTitle = lines.find((l) => /^#{1,6}\s/.test(l)) ?? lines[0] ?? "Content idea";
    const title =
      rawTitle
        .replace(/^#{1,6}\s*/, "")
        .replace(/[*_`>#[\]]/g, "")
        .trim()
        .slice(0, 60)
        .trim() || "Content idea";
    const safe = title.replace(/[\\/:*?"<>|^]/g, "").trim() || "Content idea";
    let path = normalizePath(`${folder}/${safe}.md`);
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safe} ${++i}.md`);
    }
    const m = this.moment();
    const note = `---\narea: ${area.id}\ntype: content-idea\nstatus: idea\nsource: ai-chat\ndate: ${m().format(
      "YYYY-MM-DD"
    )}\ntags: []\n---\n\n# ${title}\n\n> [!info] Captured from AI chat — ${m().format(
      "YYYY-MM-DD"
    )}\n\n${content.trim()}\n`;
    return await this.app.vault.create(path, note);
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
