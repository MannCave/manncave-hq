import { App } from "obsidian";
import { AREAS } from "./vault";
import type { HQSettings } from "./settings";

export interface GNode {
  id: string;
  title: string;
  group: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

export interface GraphModel {
  nodes: GNode[];
  links: [GNode, GNode][];
  counts: number[];
}

/** Group order follows AREAS, then DAILY, then OTHER (AI transcripts fold in). */
export const GRAPH_GROUPS: { label: string; color: string; square?: boolean }[] = [
  { label: "WWP", color: "#a29433" },
  { label: "KA", color: "#d14a12", square: true },
  { label: "MCM", color: "#bd1373" },
  { label: "MCCRV", color: "#7950d8" },
  { label: "DAILY", color: "#2b97c8" },
  { label: "OTHER", color: "#5c6472" },
];

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Read every markdown note and its resolved links into a graph model. */
export function buildGraph(app: App, settings: HQSettings, cap = 450): GraphModel {
  const groupOf = (path: string): number => {
    for (let i = 0; i < AREAS.length; i++) {
      if (path.startsWith(AREAS[i].root + "/")) return i;
    }
    if (path.startsWith(settings.dailyFolder + "/")) return AREAS.length;
    return AREAS.length + 1;
  };

  let nodes: GNode[] = app.vault.getMarkdownFiles().map((f) => ({
    id: f.path,
    title: f.basename,
    group: groupOf(f.path),
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    degree: 0,
  }));
  const index = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let links: [GNode, GNode][] = [];
  for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
    const a = index.get(src);
    if (!a) continue;
    for (const t of Object.keys(targets)) {
      const b = index.get(t);
      if (!b || b === a) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([a, b]);
      a.degree++;
      b.degree++;
    }
  }
  if (nodes.length > cap) {
    nodes = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, cap);
    const keep = new Set(nodes.map((n) => n.id));
    links = links.filter(([a, b]) => keep.has(a.id) && keep.has(b.id));
  }
  const counts = GRAPH_GROUPS.map((_, gi) => nodes.filter((n) => n.group === gi).length);
  return { nodes, links, counts };
}

/** Deterministic per-group starting positions around the canvas centre. */
export function seedLayout(model: GraphModel, W: number, H: number): [number, number][] {
  const cx = W / 2;
  const cy = H / 2;
  const anchors: [number, number][] = GRAPH_GROUPS.map((_, i) => {
    const ang = (i / GRAPH_GROUPS.length) * Math.PI * 2 - Math.PI / 2;
    return [
      cx + Math.cos(ang) * Math.min(W, H) * 0.27,
      cy + Math.sin(ang) * Math.min(W, H) * 0.27,
    ];
  });
  for (const n of model.nodes) {
    const [ax, ay] = anchors[n.group];
    const ang = hash01(n.id) * Math.PI * 2;
    const r = hash01(n.id + "r") * (Math.min(W, H) * 0.12);
    n.x = ax + Math.cos(ang) * r;
    n.y = ay + Math.sin(ang) * r;
  }
  return anchors;
}

/** One step of the force simulation (repulsion, spring links, group + centre pull). */
export function stepLayout(
  model: GraphModel,
  anchors: [number, number][],
  W: number,
  H: number
) {
  const { nodes, links } = model;
  const cx = W / 2;
  const cy = H / 2;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = hash01(a.id) - 0.5;
        dy = 0.5;
        d2 = 1;
      }
      if (d2 > 22500) continue;
      const d = Math.sqrt(d2);
      const f = 700 / d2;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  for (const [a, b] of links) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = (d - 48) * 0.015;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }
  for (const n of nodes) {
    const [ax, ay] = anchors[n.group];
    n.vx += (ax - n.x) * 0.006 + (cx - n.x) * 0.004;
    n.vy += (ay - n.y) * 0.006 + (cy - n.y) * 0.004;
    n.vx *= 0.82;
    n.vy *= 0.82;
    n.x += Math.max(-5, Math.min(5, n.vx));
    n.y += Math.max(-5, Math.min(5, n.vy));
    n.x = Math.max(8, Math.min(W - 8, n.x));
    n.y = Math.max(8, Math.min(H - 8, n.y));
  }
}

export const nodeRadius = (n: GNode, scale = 1) =>
  (2.5 + Math.min(6, Math.sqrt(n.degree) * 1.4)) * scale;

/** Paint the graph onto a 2D context. */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  model: GraphModel,
  W: number,
  H: number,
  dpr: number,
  opts: { scale?: number; glow?: boolean } = {}
) {
  const scale = opts.scale ?? 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(139, 146, 165, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of model.links) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  for (const n of model.nodes) {
    const g = GRAPH_GROUPS[n.group];
    const r = nodeRadius(n, scale);
    ctx.shadowBlur = opts.glow !== false && n.degree >= 6 ? 9 : 0;
    ctx.shadowColor = g.color;
    ctx.fillStyle = g.color;
    ctx.strokeStyle = "#05060a";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    if (g.square) ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
    else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (scale >= 0.8) ctx.stroke();
  }
  ctx.shadowBlur = 0;
}
