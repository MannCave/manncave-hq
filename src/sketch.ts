import { Modal, Notice, TFile, normalizePath } from "obsidian";
import type MannCaveHQPlugin from "./main";
import { AREAS, VaultData } from "./vault";

interface SketchPoint {
  x: number;
  y: number;
  p: number;
}

interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  points: SketchPoint[];
}

const INKS = [
  { label: "Ink", color: "#e8eaf0" },
  { label: "Gold", color: "#d9b44a" },
  { label: "Forge", color: "#ff7d26" },
  { label: "Ember", color: "#f43f5e" },
  { label: "Ice", color: "#38bdf8" },
  { label: "Route", color: "#35c26e" },
];

const SIZES = [
  { label: "S", width: 2 },
  { label: "M", width: 3.5 },
  { label: "L", width: 6 },
];

const BG = "#0f1115";

/** Fullscreen-ish canvas for handwritten notes; saves a PNG + note into a chosen folder. */
export class SketchModal extends Modal {
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private color = INKS[0].color;
  private width = SIZES[1].width;
  private erase = false;
  private dest: string; // "daily" | AreaId
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private titleInput!: HTMLInputElement;
  private dpr = window.devicePixelRatio || 1;
  private cw = 0;
  private ch = 0;

  constructor(private plugin: MannCaveHQPlugin, dest: string = "daily") {
    super(plugin.app);
    this.dest = dest;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("mch-sketch-modal");
    contentEl.empty();
    contentEl.createEl("div", { text: "HANDWRITTEN NOTE", cls: "mch-sketch-heading" });

    const tools = contentEl.createDiv("mch-sketch-tools");
    const inkRow = tools.createDiv("mch-sketch-group");
    const inkBtns: HTMLButtonElement[] = [];
    for (const ink of INKS) {
      const b = inkRow.createEl("button", { cls: "mch-sketch-ink", attr: { "aria-label": ink.label } });
      b.style.background = ink.color;
      if (ink.color === this.color) b.addClass("is-on");
      b.onclick = () => {
        this.color = ink.color;
        this.erase = false;
        inkBtns.forEach((x) => x.removeClass("is-on"));
        eraseBtn.removeClass("is-on");
        b.addClass("is-on");
      };
      inkBtns.push(b);
    }
    const sizeRow = tools.createDiv("mch-sketch-group");
    const sizeBtns: HTMLButtonElement[] = [];
    for (const s of SIZES) {
      const b = sizeRow.createEl("button", { text: s.label, cls: "mch-sketch-tool" });
      if (s.width === this.width) b.addClass("is-on");
      b.onclick = () => {
        this.width = s.width;
        sizeBtns.forEach((x) => x.removeClass("is-on"));
        b.addClass("is-on");
      };
      sizeBtns.push(b);
    }
    const actRow = tools.createDiv("mch-sketch-group");
    const eraseBtn = actRow.createEl("button", { text: "ERASE", cls: "mch-sketch-tool" });
    eraseBtn.onclick = () => {
      this.erase = !this.erase;
      eraseBtn.toggleClass("is-on", this.erase);
    };
    const undoBtn = actRow.createEl("button", { text: "UNDO", cls: "mch-sketch-tool" });
    undoBtn.onclick = () => {
      this.strokes.pop();
      this.redraw();
    };
    const clearBtn = actRow.createEl("button", { text: "CLEAR", cls: "mch-sketch-tool" });
    clearBtn.onclick = () => {
      this.strokes = [];
      this.redraw();
    };

    const wrap = contentEl.createDiv("mch-sketch-wrap");
    this.canvas = wrap.createEl("canvas");
    this.bindPointer();
    window.requestAnimationFrame(() => this.sizeCanvas());

    const destRow = contentEl.createDiv("mch-sketch-dest");
    destRow.createSpan({ text: "FILE TO", cls: "mch-sketch-label" });
    const destBtns: HTMLButtonElement[] = [];
    const addDest = (id: string, label: string) => {
      const b = destRow.createEl("button", { text: label, cls: "mch-sketch-tool" });
      if (id === this.dest) b.addClass("is-on");
      b.onclick = () => {
        this.dest = id;
        destBtns.forEach((x) => x.removeClass("is-on"));
        b.addClass("is-on");
      };
      destBtns.push(b);
    };
    addDest("daily", "Daily Log");
    for (const a of AREAS) addDest(a.id, a.short);

    const saveRow = contentEl.createDiv("mch-sketch-save");
    this.titleInput = saveRow.createEl("input", {
      cls: "mch-sketch-title",
      attr: { placeholder: "Title (optional)…", type: "text" },
    });
    const saveBtn = saveRow.createEl("button", { text: "SAVE", cls: "mch-sketch-savebtn" });
    saveBtn.onclick = () => void this.save();
  }

  onClose() {
    this.contentEl.empty();
  }

  private sizeCanvas() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    this.cw = Math.max(280, wrap.clientWidth);
    this.ch = Math.max(260, Math.min(520, Math.round(window.innerHeight * 0.5)));
    this.canvas.width = this.cw * this.dpr;
    this.canvas.height = this.ch * this.dpr;
    this.canvas.style.height = `${this.ch}px`;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.ctx = ctx;
    this.redraw();
  }

  private bindPointer() {
    const pt = (e: PointerEvent): SketchPoint => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        p: e.pointerType === "pen" ? e.pressure || 0.5 : 0.5,
      };
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.current = { color: this.color, width: this.width, erase: this.erase, points: [pt(e)] };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.current) return;
      e.preventDefault();
      const p = pt(e);
      this.current.points.push(p);
      const n = this.current.points.length;
      this.drawSegment(this.ctx, this.current, this.current.points[n - 2], p);
    });
    const finish = (e: PointerEvent) => {
      if (!this.current) return;
      e.preventDefault();
      if (this.current.points.length > 1) this.strokes.push(this.current);
      this.current = null;
    };
    this.canvas.addEventListener("pointerup", finish);
    this.canvas.addEventListener("pointercancel", finish);
  }

  private drawSegment(ctx: CanvasRenderingContext2D, s: Stroke, a: SketchPoint, b: SketchPoint) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s.erase ? s.width * 5 : s.width * (0.6 + b.p * 0.8);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  private replay(ctx: CanvasRenderingContext2D) {
    for (const s of this.strokes) {
      for (let i = 1; i < s.points.length; i++) {
        this.drawSegment(ctx, s, s.points[i - 1], s.points[i]);
      }
    }
  }

  private redraw() {
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.replay(this.ctx);
  }

  private async save() {
    if (this.strokes.length === 0) {
      new Notice("Nothing drawn yet.");
      return;
    }
    try {
      // bake the dark background in so the ink stays legible in any theme
      const out = document.createElement("canvas");
      out.width = this.canvas.width;
      out.height = this.canvas.height;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("canvas unavailable");
      octx.fillStyle = BG;
      octx.fillRect(0, 0, out.width, out.height);
      this.replay(octx);
      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode PNG"))), "image/png")
      );
      const buffer = await blob.arrayBuffer();

      const m = (window as any).moment;
      const stamp = m().format("YYYY-MM-DD HH-mm");
      const rawTitle = this.titleInput.value.trim() || `Sketch ${stamp}`;
      const safe = rawTitle.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || `Sketch ${stamp}`;

      const data = new VaultData(this.plugin);
      const area = AREAS.find((a) => a.id === this.dest) ?? null;
      const folder = area
        ? `${area.root}/Sketches`
        : `${this.plugin.settings.dailyFolder}/Sketches`;
      await data.ensureFolder(folder);

      let pngPath = normalizePath(`${folder}/${safe}.png`);
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(pngPath)) {
        pngPath = normalizePath(`${folder}/${safe} ${++i}.png`);
      }
      await this.app.vault.createBinary(pngPath, buffer);

      if (area) {
        let notePath = normalizePath(`${folder}/${safe}.md`);
        let j = 1;
        while (this.app.vault.getAbstractFileByPath(notePath)) {
          notePath = normalizePath(`${folder}/${safe} ${++j}.md`);
        }
        const content = `---\narea: ${area.id}\ntype: sketch\ndate: ${m().format(
          "YYYY-MM-DD HH:mm"
        )}\ntags: []\n---\n\n# ${safe}\n\n![[${pngPath}]]\n`;
        const note = await this.app.vault.create(notePath, content);
        new Notice(`Sketch filed to ${area.short}`);
        if (note instanceof TFile) await data.openFile(note);
      } else {
        await data.quickCapture(`![[${pngPath}]]`, "## 📝 Notes & Thoughts");
        new Notice("Sketch added to today's daily log");
      }
      this.close();
    } catch (e: any) {
      new Notice(`Couldn't save sketch: ${e.message}`, 6000);
    }
  }
}
