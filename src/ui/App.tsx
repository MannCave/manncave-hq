import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer, Notice, TFile } from "obsidian";
import type MannCaveHQPlugin from "../main";
import type { UsageEntry } from "../settings";
import { AREAS, AreaConfig, AreaSection, NoteInfo, VaultData } from "../vault";
import { ChatMessage, getProvider } from "../ai";
import { fetchGitHubData, getGitHubData, GitHubData } from "../github";
import { buildGraph, drawGraph, GNode, GRAPH_GROUPS, seedLayout, stepLayout } from "../graph";
import { SketchModal } from "../sketch";
import { AreaMotif, Reactor, LiveDot, Cursor } from "./motifs";

type TabId = "today" | "wwp" | "kingdom" | "manncave" | "mccrv" | "grid" | "dev" | "ai";

const TABS: { id: TabId; label: string; accent: string }[] = [
  { id: "today", label: "Today", accent: "amber" },
  { id: "wwp", label: "WWP", accent: "gold" },
  { id: "kingdom", label: "KA", accent: "forge" },
  { id: "manncave", label: "MannCave", accent: "ember" },
  { id: "mccrv", label: "MCCRV", accent: "route" },
  { id: "grid", label: "Grid", accent: "ice" },
  { id: "dev", label: "Dev", accent: "violet" },
  { id: "ai", label: "AI", accent: "ice" },
];

const AREA_ACCENT: Record<string, string> = {
  wwp: "gold",
  kingdom: "forge",
  manncave: "ember",
  mccrv: "route",
};

const CAPTURE_TARGETS: { label: string; header: string | null }[] = [
  { label: "Notes", header: "## 📝 Notes & Thoughts" },
  { label: "WWP", header: "### WWP" },
  { label: "KA", header: "### Kingdom Athletics" },
  { label: "MannCave", header: "### MannCave Media" },
  { label: "MCCRV", header: "### McClainsRV" },
  { label: "Personal", header: "### Personal" },
  { label: "Wins", header: "## 🏆 Wins" },
];

export function App({ plugin }: { plugin: MannCaveHQPlugin }) {
  const data = useMemo(() => new VaultData(plugin), [plugin]);
  const [tab, setTab] = useState<TabId>("today");
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ref = plugin.app.metadataCache.on("resolved", refresh);
    const ref2 = plugin.app.vault.on("create", refresh);
    const ref3 = plugin.app.vault.on("delete", refresh);
    const ref4 = plugin.app.vault.on("rename", refresh);
    const ref5 = plugin.app.workspace.on("active-leaf-change", refresh);
    return () => {
      plugin.app.metadataCache.offref(ref);
      plugin.app.vault.offref(ref2);
      plugin.app.vault.offref(ref3);
      plugin.app.vault.offref(ref4);
      plugin.app.workspace.offref(ref5);
    };
  }, [plugin, refresh]);

  const now = (window as any).moment();

  return (
    <div className="mch-root">
      <header className="mch-header">
        <div>
          <div className="mch-eyebrow">MannCave HQ</div>
          <h1 className="mch-date">{now.format("dddd, MMMM D")}</h1>
        </div>
        <nav className="mch-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`mch-tab ${tab === t.id ? "is-active" : ""}`}
              data-accent={t.accent}
              onClick={() => setTab(t.id)}
            >
              <span className="mch-tab-dot" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* No key={tick}: a remount here would wipe in-progress chats; re-rendering
          on tick is enough to refresh the vault-derived lists. The AI view stays
          mounted (hidden) so conversations survive tab switches. */}
      <main className="mch-main">
        {tab === "today" && <TodayView data={data} plugin={plugin} onOpenArea={(id) => setTab(id)} />}
        {tab === "wwp" && <AreaView data={data} plugin={plugin} area={AREAS[0]} />}
        {tab === "kingdom" && <AreaView data={data} plugin={plugin} area={AREAS[1]} />}
        {tab === "manncave" && <AreaView data={data} plugin={plugin} area={AREAS[2]} />}
        {tab === "mccrv" && <AreaView data={data} plugin={plugin} area={AREAS[3]} />}
        {tab === "grid" && <GridView data={data} plugin={plugin} />}
        {tab === "dev" && <DevView plugin={plugin} />}
        <div style={{ display: tab === "ai" ? undefined : "none" }}>
          <AIView data={data} plugin={plugin} />
        </div>
      </main>
    </div>
  );
}

/* ---------- Today ---------- */

function TodayView({
  data,
  plugin,
  onOpenArea,
}: {
  data: VaultData;
  plugin: MannCaveHQPlugin;
  onOpenArea: (id: TabId) => void;
}) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState(-1); // -1 = AUTO: the AI routes the capture
  const [busy, setBusy] = useState(false);

  const routeAuto = async (raw: string) => {
    const provider = getProvider(plugin.settings);
    const system = "You route captured text inside a personal dashboard. You reply with ONLY a JSON object — no prose.";
    const prompt = `Route this captured text:\n"""${raw}"""\n\nBrands: wwp = WorldWidePeptides (peptide/supplement company), kingdom = Kingdom Athletics (faith + fitness apparel brand), manncave = MannCave Media (podcast/streaming/content), mccrv = McClainsRV (RV dealership day job).\n\nPick ONE destination:\n- {"dest":"notes"} — general thought or note\n- {"dest":"wwp"|"kingdom"|"manncave"|"mccrv"} — work-log line for that brand's section of today's daily note\n- {"dest":"personal"} — personal life\n- {"dest":"wins"} — a completed accomplishment worth celebrating\n- {"dest":"idea","area":"wwp"|"kingdom"|"manncave"|"mccrv","title":"<short note title>"} — a content/product idea worth its own note in that brand's Content Hub\n\nReply with ONLY the JSON object.`;
    const result = await provider.chat(system, [{ role: "user", content: prompt }]);
    plugin.recordUsage(provider.label, provider.modelName, result.usage);
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no routing decision");
    const route = JSON.parse(match[0]) as { dest?: string; area?: string; title?: string };
    if (route.dest === "idea") {
      const area = AREAS.find((a) => a.id === route.area);
      if (!area) throw new Error("unknown area");
      const title = (route.title ?? "").trim();
      await data.sendToContentHub(area, title ? `${title}\n${raw}` : raw);
      return `${area.short} Content Hub (new idea)`;
    }
    const targetDef = CAPTURE_TARGETS.find((t) => {
      if (route.dest === "notes") return t.label === "Notes";
      if (route.dest === "wins") return t.label === "Wins";
      if (route.dest === "personal") return t.label === "Personal";
      if (route.dest === "wwp") return t.label === "WWP";
      if (route.dest === "kingdom") return t.label === "KA";
      if (route.dest === "manncave") return t.label === "MannCave";
      if (route.dest === "mccrv") return t.label === "MCCRV";
      return false;
    });
    if (!targetDef) throw new Error("unknown destination");
    await data.quickCapture(raw, targetDef.header);
    return `daily log → ${targetDef.label}`;
  };

  const capture = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const raw = text.trim();
    try {
      if (target === -1) {
        try {
          const where = await routeAuto(raw);
          new Notice(`AUTO ROUTED → ${where}`);
        } catch (e: any) {
          await data.quickCapture(raw, "## 📝 Notes & Thoughts");
          new Notice(`Auto-routing unavailable (${e.message}) — captured to Notes`, 5000);
        }
      } else {
        await data.quickCapture(raw, CAPTURE_TARGETS[target].header);
        new Notice(`Captured to ${CAPTURE_TARGETS[target].label}`);
      }
      setText("");
    } catch (e: any) {
      new Notice(`Capture failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mch-stack mch-theme-today mch-boot">
      <div className="mch-hud-top">
        <span className="mch-hud-tag"><span className="mch-hud-pip" />SYSTEMS ONLINE</span>
        <span className="mch-hud-tag mch-dim">MANNCAVE HQ // COMMAND</span>
      </div>

      <div className="mch-hud-hero">
        <Reactor />
        <div className="mch-sectors">
          {AREAS.map((area, i) => {
            const c = data.countByStatus(area);
            const load = c.total ? Math.round((c.active / c.total) * 100) : 0;
            return (
              <button
                key={area.id}
                className="mch-sector"
                data-accent={AREA_ACCENT[area.id]}
                onClick={() => onOpenArea(area.id as TabId)}
              >
                {/* WebKit will not lay out a <button> as a flex column: children
                    centre and the box collapses. Inner span owns the layout. */}
                <span className="mch-sector-inner">
                  <span className="mch-sector-head">
                    <span className="mch-sector-name">{area.short.toUpperCase()}</span>
                    <span className="mch-sector-id">0{i + 2}</span>
                  </span>
                  <span className="mch-sector-nums">
                    <b>{c.active}</b> ACTIVE <b>{c.ideas}</b> IDEAS
                  </span>
                  <span className="mch-meter">
                    <span className="mch-meter-fill" style={{ width: `${load}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mch-hud-card mch-console">
        <div className="mch-hud-card-head">
          <span>COMMAND INPUT</span>
          <span className="mch-graph-tools">
            <button className="mch-btn mch-btn-ghost" onClick={() => new SketchModal(plugin).open()}>
              ✏ SKETCH
            </button>
            <button
              className="mch-btn mch-btn-ghost"
              onClick={async () => data.openFile(await data.getOrCreateToday())}
            >
              DAILY LOG →
            </button>
          </span>
        </div>
        <div className="mch-console-row">
          <span className="mch-prompt">&gt;</span>
          <textarea
            className="mch-input mch-console-input"
            rows={1}
            placeholder="log completed work…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                capture();
              }
            }}
          />
        </div>
        <div className="mch-row">
          <div className="mch-chips">
            <button
              className={`mch-chip mch-chip-auto ${target === -1 ? "is-on" : ""}`}
              title="The AI decides where this goes — daily log section, Wins, or a brand's Content Hub"
              onClick={() => setTarget(-1)}
            >
              ✦ AUTO
            </button>
            {CAPTURE_TARGETS.map((t, i) => (
              <button
                key={t.label}
                className={`mch-chip ${i === target ? "is-on" : ""}`}
                onClick={() => setTarget(i)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="mch-btn" disabled={!text.trim() || busy} onClick={capture}>
            {busy && target === -1 ? "ROUTING…" : "EXECUTE"}
          </button>
        </div>
      </section>

      <div className="mch-snap-grid">
        <DevSnapshot plugin={plugin} onOpen={() => onOpenArea("dev")} />
        <UsageSnapshot plugin={plugin} onOpen={() => onOpenArea("grid")} />
        <MiniGraph plugin={plugin} onOpen={() => onOpenArea("grid")} />
      </div>
    </div>
  );
}

/* ---------- Area ---------- */

const AREA_HUD: Record<string, { status: string; sector: string; kicker: string }> = {
  wwp: { status: "GOLD STANDARD ONLINE", sector: "02", kicker: "R&D · OPERATIONS" },
  kingdom: { status: "FORGE ACTIVE", sector: "03", kicker: "IRON · FAITH · DISCIPLINE" },
  manncave: { status: "SIGNAL LIVE", sector: "04", kicker: "ON THE AIR" },
  mccrv: { status: "CONVOY ONLINE", sector: "08", kicker: "SHOWROOM · SERVICE · ROAD" },
};

function AreaView({ data, plugin, area }: { data: VaultData; plugin: MannCaveHQPlugin; area: AreaConfig }) {
  const hud = AREA_HUD[area.id];
  return (
    <div className={`mch-stack mch-hud-zone mch-boot mch-theme-${area.id}`} data-accent={AREA_ACCENT[area.id]}>
      <div className="mch-hud-top">
        <span className="mch-hud-tag"><span className="mch-hud-pip" />{hud.status}</span>
        <span className="mch-hud-tag mch-dim">SECTOR {hud.sector} // {area.short.toUpperCase()}</span>
      </div>
      <div className="mch-banner">
        <div className="mch-banner-left">
          <div className="mch-banner-kicker">{hud.kicker}</div>
          <div className="mch-banner-name">{area.name}</div>
        </div>
        <div className="mch-banner-right">
          {area.id === "manncave" && <LiveDot />}
          <button
            className="mch-btn mch-btn-ghost"
            onClick={() => new SketchModal(plugin, area.id).open()}
          >
            ✏ SKETCH
          </button>
          <AreaMotif id={area.id} />
        </div>
      </div>
      {area.sections.map((s) => (
        <SectionCard key={s.path} data={data} section={s} accent={AREA_ACCENT[area.id]} />
      ))}
    </div>
  );
}

function SectionCard({
  data,
  section,
  accent,
}: {
  data: VaultData;
  section: AreaSection;
  accent: string;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const notes = data.listNotes(section.path);

  const create = async () => {
    if (!title.trim()) return;
    try {
      const file = await data.createNote(section, title.trim());
      setTitle("");
      setCreating(false);
      await data.openFile(file);
    } catch (e: any) {
      new Notice(`Couldn't create note: ${e.message}`);
    }
  };

  return (
    <section className="mch-card" data-accent={accent}>
      <div className="mch-card-head">
        <h2>
          {section.label} <span className="mch-count">{notes.length}</span>
        </h2>
        <button className="mch-btn mch-btn-ghost" onClick={() => setCreating((c) => !c)}>
          + {section.newLabel}
        </button>
      </div>

      {creating && (
        <div className="mch-row mch-new-row">
          <input
            className="mch-input"
            autoFocus
            placeholder="Title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="mch-btn" onClick={create} disabled={!title.trim()}>
            Create
          </button>
        </div>
      )}

      {notes.length === 0 && !creating && (
        <div className="mch-empty">Nothing here yet — start with “{section.newLabel}”.</div>
      )}

      <ul className="mch-list">
        {notes.slice(0, 8).map((n) => (
          <NoteRow key={n.file.path} note={n} onOpen={() => data.openFile(n.file)} />
        ))}
      </ul>
    </section>
  );
}

function NoteRow({ note, onOpen }: { note: NoteInfo; onOpen: () => void }) {
  return (
    <li>
      <button className="mch-note" onClick={onOpen}>
        <span className="mch-note-title">{note.title}</span>
        {note.status && <span className={`mch-status is-${note.status}`}>{note.status}</span>}
      </button>
    </li>
  );
}

/* ---------- AI ---------- */

/** Renders markdown through Obsidian's renderer into a themed container. */
function MarkdownBody({ plugin, markdown }: { plugin: MannCaveHQPlugin; markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const target = ref.current;
    if (!target) return;
    const tmp = document.createElement("div");
    MarkdownRenderer.render(plugin.app, markdown, tmp, "", plugin).then(() => {
      if (cancelled || !ref.current) return;
      ref.current.replaceChildren(...Array.from(tmp.childNodes));
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, markdown]);

  return <div className="mch-md" ref={ref} />;
}

function AIView({ data, plugin }: { data: VaultData; plugin: MannCaveHQPlugin }) {
  const [brand, setBrand] = useState<AreaConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ctxNote, setCtxNote] = useState(false);
  const [ctxBacklog, setCtxBacklog] = useState(false);
  const [ctxRecaps, setCtxRecaps] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeNote = data.getActiveMarkdownFile();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, draft]);

  const provider = getProvider(plugin.settings);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setSaved(false);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    let partial = "";
    try {
      let system =
        "You are the AI copilot inside MannCave HQ, a personal command center in Obsidian. Be direct, useful, and concise. Format answers in Markdown.";
      if (brand) {
        const voice = await data.readBrandVoice(brand);
        if (voice) {
          system += `\n\nYou are currently working in the ${brand.name} brand area. Follow this brand voice document strictly:\n\n${voice}`;
        }
      }
      const context: string[] = [];
      if (ctxNote) {
        const s = await data.activeNoteContext();
        if (s) context.push(s);
      }
      if (ctxBacklog) {
        const s = data.backlogContext(brand);
        if (s) context.push(s);
      }
      if (ctxRecaps) {
        const s = await data.recentRecapsContext(7);
        if (s) context.push(s);
      }
      if (context.length) {
        system += `\n\n---\n\nThe user attached the following context from their vault. Ground your answers in it — reference their actual notes, ideas, and statuses by name rather than giving generic advice.\n\n${context.join(
          "\n\n"
        )}`;
      }
      let lastPaint = 0;
      const result = await provider.chatStream(system, next, (t) => {
        partial = t;
        const now = Date.now();
        if (now - lastPaint > 120) {
          lastPaint = now;
          setDraft(t);
        }
      });
      plugin.recordUsage(provider.label, provider.modelName, result.usage);
      setMessages([...next, { role: "assistant", content: result.text }]);
    } catch (e: any) {
      new Notice(e.message, 6000);
      // keep whatever streamed in before the error
      setMessages(partial ? [...next, { role: "assistant", content: partial }] : next);
    } finally {
      setDraft(null);
      setBusy(false);
    }
  };

  const toHub = async (area: AreaConfig, content: string) => {
    try {
      const file = await data.sendToContentHub(area, content);
      new Notice(`Idea saved to ${area.short} Content Hub: ${file.basename}`);
    } catch (e: any) {
      new Notice(`Couldn't save idea: ${e.message}`);
    }
  };

  const save = async () => {
    if (messages.length === 0) return;
    try {
      const file = await data.saveTranscript(brand?.name ?? null, provider.modelName, messages);
      setSaved(true);
      new Notice(`Transcript saved: ${file.basename}`);
    } catch (e: any) {
      new Notice(`Save failed: ${e.message}`);
    }
  };

  return (
    <div className="mch-ai mch-theme-ai" data-accent="ice">
      <div className="mch-ai-bar">
        <div className="mch-chips">
          <button className={`mch-chip ${!brand ? "is-on" : ""}`} onClick={() => setBrand(null)}>
            General
          </button>
          {AREAS.map((a) => (
            <button
              key={a.id}
              className={`mch-chip ${brand?.id === a.id ? "is-on" : ""}`}
              data-accent={AREA_ACCENT[a.id]}
              onClick={() => setBrand(a)}
            >
              {a.short}
            </button>
          ))}
        </div>
        <div className="mch-ai-actions">
          <span className="mch-model">{provider.label} · {provider.modelName}<Cursor /></span>
          <button className="mch-btn mch-btn-ghost" disabled={messages.length === 0} onClick={save}>
            {saved ? "Saved ✓" : "Save to vault"}
          </button>
          <button
            className="mch-btn mch-btn-ghost"
            disabled={messages.length === 0}
            onClick={() => {
              setMessages([]);
              setSaved(false);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mch-ctx-bar">
        <span className="mch-ctx-label">Context</span>
        <div className="mch-chips">
          <button
            className={`mch-chip ${ctxNote ? "is-on" : ""}`}
            disabled={!activeNote}
            title={activeNote ? activeNote.path : "Open a note to attach it"}
            onClick={() => setCtxNote((v) => !v)}
          >
            📄 {activeNote ? activeNote.basename : "No note open"}
          </button>
          <button
            className={`mch-chip ${ctxBacklog ? "is-on" : ""}`}
            onClick={() => setCtxBacklog((v) => !v)}
          >
            💡 {brand ? `${brand.short} backlog` : "All backlogs"}
          </button>
          <button
            className={`mch-chip ${ctxRecaps ? "is-on" : ""}`}
            onClick={() => setCtxRecaps((v) => !v)}
          >
            📅 Last 7 recaps
          </button>
        </div>
      </div>

      <div className="mch-ai-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="mch-empty mch-ai-empty">
            Pick a brand context above and start a conversation.
            <br />
            Every chat can be saved straight into <b>05 - AI Transcripts</b>.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mch-msg is-${m.role}`}>
            <div className="mch-msg-role">{m.role === "user" ? "You" : "AI"}</div>
            {m.role === "assistant" ? (
              <>
                <MarkdownBody plugin={plugin} markdown={m.content} />
                <div className="mch-msg-actions">
                  <span className="mch-msg-actions-label">→ Content Hub:</span>
                  {AREAS.map((a) => (
                    <button
                      key={a.id}
                      className="mch-chip"
                      data-accent={AREA_ACCENT[a.id]}
                      onClick={() => toHub(a, m.content)}
                    >
                      {a.short}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="mch-msg-body">{m.content}</div>
            )}
          </div>
        ))}
        {draft !== null && (
          <div className="mch-msg is-assistant">
            <div className="mch-msg-role">AI</div>
            <MarkdownBody plugin={plugin} markdown={draft} />
          </div>
        )}
        {busy && draft === null && <div className="mch-msg is-assistant mch-thinking">Thinking…</div>}
      </div>

      <div className="mch-ai-input">
        <textarea
          className="mch-input"
          rows={2}
          placeholder={brand ? `Brainstorm for ${brand.name}…` : "Ask anything…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="mch-btn" onClick={send} disabled={!input.trim() || busy}>
          Send
        </button>
      </div>
    </div>
  );
}

/* ---------- Grid: telemetry ---------- */

// Palette steps validated for the dark surface (CVD + normal-vision separation);
// KA nodes render square as the secondary encoding for the gold/forge pair.
const USAGE_IN = "#2b97c8";
const USAGE_OUT = "#c98007";

function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function GridView({ data, plugin }: { data: VaultData; plugin: MannCaveHQPlugin }) {
  const [scan, setScan] = useState(0);
  const rescan = useCallback(() => setScan((s) => s + 1), []);
  return (
    <div className="mch-stack mch-hud-zone mch-boot" data-accent="ice">
      <div className="mch-hud-top">
        <span className="mch-hud-tag"><span className="mch-hud-pip" />TELEMETRY ONLINE</span>
        <span className="mch-hud-tag mch-dim">SECTOR 05 // GRID</span>
      </div>
      <VaultGraph data={data} plugin={plugin} scan={scan} onRescan={rescan} />
      <LinkForge data={data} plugin={plugin} onLinked={rescan} />
      <UsagePanel plugin={plugin} />
    </div>
  );
}

function UsagePanel({ plugin }: { plugin: MannCaveHQPlugin }) {
  const [sel, setSel] = useState<number | null>(null);
  const m = (window as any).moment;
  const log = plugin.settings.usageLog ?? {};

  const days: { date: string; label: string; in: number; out: number; requests: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = m().subtract(i, "days").format("YYYY-MM-DD");
    let tin = 0, tout = 0, req = 0;
    for (const e of Object.values(log[date] ?? {})) {
      tin += e.in;
      tout += e.out;
      req += e.requests;
    }
    days.push({ date, label: m(date, "YYYY-MM-DD").format("M/D"), in: tin, out: tout, requests: req });
  }

  let allTime = 0;
  for (const dayLog of Object.values(log)) {
    for (const e of Object.values(dayLog)) allTime += e.in + e.out;
  }
  const last7 = days.slice(7).reduce((n, d) => n + d.in + d.out, 0);
  const today = days[days.length - 1];

  const provTotals: Record<string, UsageEntry> = {};
  for (let i = 0; i < 7; i++) {
    const d = m().subtract(i, "days").format("YYYY-MM-DD");
    for (const [k, e] of Object.entries(log[d] ?? {})) {
      const t = provTotals[k] ?? (provTotals[k] = { in: 0, out: 0, requests: 0 });
      t.in += e.in;
      t.out += e.out;
      t.requests += e.requests;
    }
  }
  const provRows = Object.entries(provTotals).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));

  const W = 560, H = 172, padL = 42, padT = 8, padB = 20;
  const plotW = W - padL - 6;
  const plotH = H - padT - padB;
  const slot = plotW / 14;
  const bw = Math.max(8, Math.floor(slot) - 5);
  const max = Math.max(100, ...days.map((d) => d.in + d.out));
  const yh = (v: number) => (plotH * v) / max;

  return (
    <section className="mch-hud-card" data-accent="ice">
      <div className="mch-hud-card-head">
        <span>TOKEN FLOW // API USAGE</span>
        <span className="mch-hud-id">MOD-05</span>
      </div>
      {allTime === 0 ? (
        <div className="mch-empty">
          No API calls recorded yet — token tracking starts with your next AI chat message.
        </div>
      ) : (
        <>
          <svg
            className="mch-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Tokens used per day over the last 14 days, split into input and output"
          >
            {[0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={padL} x2={W - 4}
                  y1={padT + plotH - plotH * f} y2={padT + plotH - plotH * f}
                  stroke="rgba(255,255,255,0.07)" strokeWidth="1"
                />
                <text x={padL - 6} y={padT + plotH - plotH * f + 3} textAnchor="end" className="mch-chart-tick">
                  {fmtTok(Math.round(max * f))}
                </text>
              </g>
            ))}
            <line x1={padL} x2={W - 4} y1={padT + plotH} y2={padT + plotH} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
            {days.map((d, i) => {
              const x = padL + i * slot + (slot - bw) / 2;
              const inH = yh(d.in);
              const outH = yh(d.out);
              const gap = d.in > 0 && d.out > 0 ? 2 : 0;
              return (
                <g key={d.date}>
                  {d.in > 0 && (
                    <rect x={x} y={padT + plotH - inH} width={bw} height={Math.max(1, inH)} rx="1" fill={USAGE_IN} />
                  )}
                  {d.out > 0 && (
                    <rect x={x} y={padT + plotH - inH - gap - outH} width={bw} height={Math.max(1, outH)} rx="1" fill={USAGE_OUT} />
                  )}
                  <rect
                    x={padL + i * slot} y={padT} width={slot} height={plotH + padB}
                    fill="transparent" style={{ cursor: "pointer" }}
                    onClick={() => setSel(sel === i ? null : i)}
                  >
                    <title>{`${d.date} — in ${fmtTok(d.in)}, out ${fmtTok(d.out)}, ${d.requests} req`}</title>
                  </rect>
                  {sel === i && (
                    <rect
                      x={x - 2} y={padT + plotH - inH - gap - outH - 2}
                      width={bw + 4} height={inH + gap + outH + 4}
                      fill="none" stroke="rgba(232,234,240,0.7)" strokeWidth="1"
                    />
                  )}
                  {i % 2 === 1 && (
                    <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="mch-chart-tick">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="mch-chart-legend">
            <span className="mch-legend-item"><i style={{ background: USAGE_IN }} />INPUT</span>
            <span className="mch-legend-item"><i style={{ background: USAGE_OUT }} />OUTPUT</span>
            <span className="mch-legend-note">
              {sel != null
                ? `${days[sel].date} · IN ${fmtTok(days[sel].in)} · OUT ${fmtTok(days[sel].out)} · ${days[sel].requests} REQ`
                : "tap a bar for detail · ≈ estimated when the provider doesn't report usage"}
            </span>
          </div>
          <div className="mch-usage-totals">
            TODAY <b>{fmtTok(today.in + today.out)}</b> · 7D <b>{fmtTok(last7)}</b> · 90D <b>{fmtTok(allTime)}</b> TOKENS
          </div>
          {provRows.length > 0 && (
            <div className="mch-scroll-x"><table className="mch-usage-table">
              <thead>
                <tr><th>MODEL (LAST 7D)</th><th className="num">IN</th><th className="num">OUT</th><th className="num">REQ</th></tr>
              </thead>
              <tbody>
                {provRows.map(([k, e]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num">{fmtTok(e.in)}</td>
                    <td className="num">{fmtTok(e.out)}</td>
                    <td className="num">{e.requests}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </section>
  );
}

function VaultGraph({
  data,
  plugin,
  scan,
  onRescan,
}: {
  data: VaultData;
  plugin: MannCaveHQPlugin;
  scan: number;
  onRescan: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meta, setMeta] = useState({ nodes: 0, links: 0 });
  const [counts, setCounts] = useState<number[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const W = Math.max(300, wrap.clientWidth);
    const H = Math.min(460, Math.max(320, Math.round(W * 0.62)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const model = buildGraph(plugin.app, plugin.settings);
    setMeta({ nodes: model.nodes.length, links: model.links.length });
    setCounts(model.counts);
    const anchors = seedLayout(model, W, H);

    const TOTAL = 240;
    let raf = 0;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (let i = 0; i < TOTAL; i++) stepLayout(model, anchors, W, H);
      drawGraph(ctx, model, W, H, dpr);
    } else {
      let ticks = 0;
      const step = () => {
        stepLayout(model, anchors, W, H);
        stepLayout(model, anchors, W, H);
        stepLayout(model, anchors, W, H);
        ticks += 3;
        drawGraph(ctx, model, W, H, dpr);
        if (ticks < TOTAL) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    const pick = (ev: MouseEvent): GNode | null => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best: GNode | null = null;
      let bd = 196;
      for (const n of model.nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    };
    const onClick = (ev: MouseEvent) => {
      const n = pick(ev);
      if (!n) return;
      const f = plugin.app.vault.getAbstractFileByPath(n.id);
      if (f instanceof TFile) void data.openFile(f);
    };
    const onMove = (ev: MouseEvent) => {
      const n = pick(ev);
      canvas.title = n ? n.title : "";
      canvas.style.cursor = n ? "pointer" : "default";
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
    };
  }, [scan, plugin, data]);

  return (
    <section className="mch-hud-card" data-accent="ice">
      <div className="mch-hud-card-head">
        <span>NEURAL MAP // VAULT LINKS</span>
        <span className="mch-graph-tools">
          <button className="mch-btn mch-btn-ghost" onClick={onRescan}>RESCAN</button>
          <span className="mch-hud-id">MOD-06</span>
        </span>
      </div>
      <div className="mch-graph-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>
      <div className="mch-chart-legend">
        {GRAPH_GROUPS.map((g, i) => (
          <span key={g.label} className="mch-legend-item">
            <i className={g.square ? "is-square" : ""} style={{ background: g.color }} />
            {g.label} {counts[i] ?? 0}
          </span>
        ))}
        <span className="mch-legend-note">
          <b>{meta.nodes}</b> NODES · <b>{meta.links}</b> LINKS · tap a node to open it
        </span>
      </div>
    </section>
  );
}

/* ---------- Link Forge: AI-suggested connections ---------- */

interface LinkSuggestion {
  source: string;
  target: string;
  reason: string;
  sourceTitle: string;
  targetTitle: string;
}

const noteTitle = (path: string) => path.split("/").pop()?.replace(/\.md$/, "") ?? path;

function LinkForge({
  data,
  plugin,
  onLinked,
}: {
  data: VaultData;
  plugin: MannCaveHQPlugin;
  onLinked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);
  const [sugs, setSugs] = useState<LinkSuggestion[]>([]);

  const scan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const provider = getProvider(plugin.settings);
      const { catalog, existingPairs, paths } = await data.linkForgeContext();
      const system =
        "You connect related notes in a personal Obsidian vault. You respond with ONLY a JSON array — no prose, no markdown fences.";
      const prompt = `Here is a catalog of vault notes, one per line ("path :: excerpt"):\n\n${catalog}\n\nSuggest up to 8 NEW links between notes whose content genuinely relates — same project or product, an idea that supports another, a recap that mentions a piece of content. Quality over quantity; skip weak matches. Use EXACT paths from the catalog and do not link a note to itself.\n\nRespond with ONLY this JSON shape:\n[{"source":"<path>","target":"<path>","reason":"<one short sentence>"}]`;
      const result = await provider.chat(system, [{ role: "user", content: prompt }]);
      plugin.recordUsage(provider.label, provider.modelName, result.usage);
      const match = result.text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("the model didn't return a usable list — try again");
      const raw = JSON.parse(match[0]) as any[];
      const seen = new Set<string>();
      const parsed: LinkSuggestion[] = [];
      for (const r of raw) {
        if (typeof r?.source !== "string" || typeof r?.target !== "string") continue;
        if (!paths.has(r.source) || !paths.has(r.target) || r.source === r.target) continue;
        const key = r.source < r.target ? `${r.source}|${r.target}` : `${r.target}|${r.source}`;
        if (existingPairs.has(key) || seen.has(key)) continue;
        seen.add(key);
        parsed.push({
          source: r.source,
          target: r.target,
          reason: String(r.reason ?? "").slice(0, 140),
          sourceTitle: noteTitle(r.source),
          targetTitle: noteTitle(r.target),
        });
      }
      setSugs(parsed);
      setRan(true);
    } catch (e: any) {
      new Notice(`Link scan failed: ${e.message}`, 6000);
    } finally {
      setBusy(false);
    }
  };

  const accept = async (i: number) => {
    const sug = sugs[i];
    try {
      await data.addRelatedLink(sug.source, sug.target);
      new Notice(`Linked: ${sug.sourceTitle} → ${sug.targetTitle}`);
      setSugs((cur) => cur.filter((_, j) => j !== i));
      onLinked();
    } catch (e: any) {
      new Notice(`Couldn't link: ${e.message}`, 6000);
    }
  };

  return (
    <section className="mch-hud-card" data-accent="ice">
      <div className="mch-hud-card-head">
        <span>LINK FORGE // SUGGESTED CONNECTIONS</span>
        <span className="mch-graph-tools">
          <button className="mch-btn mch-btn-ghost" disabled={busy} onClick={scan}>
            {busy ? "SCANNING…" : ran ? "RESCAN NOTES" : "SCAN FOR LINKS"}
          </button>
          <span className="mch-hud-id">MOD-07</span>
        </span>
      </div>
      {!ran && !busy && (
        <div className="mch-empty">
          Have the AI read your recent notes and propose connections. Accepted links are added under a
          "Related" section in the source note — and light up on the Neural Map.
        </div>
      )}
      {busy && <div className="mch-empty">Reading the vault and looking for connections…</div>}
      {ran && !busy && sugs.length === 0 && (
        <div className="mch-empty">No new connections found — the map is up to date. Write more, then rescan.</div>
      )}
      {sugs.length > 0 && (
        <ul className="mch-forge-list">
          {sugs.map((s, i) => (
            <li key={`${s.source}|${s.target}`} className="mch-forge-row">
              <div className="mch-forge-pair">
                <b>{s.sourceTitle}</b> ↔ <b>{s.targetTitle}</b>
                {s.reason && <span className="mch-forge-reason">{s.reason}</span>}
              </div>
              <span className="mch-forge-actions">
                <button className="mch-btn" onClick={() => accept(i)}>LINK</button>
                <button
                  className="mch-btn mch-btn-ghost"
                  aria-label="Dismiss suggestion"
                  onClick={() => setSugs((cur) => cur.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Dev: GitHub uplink ---------- */

const COMMIT_BAR = "#7950d8";

function DevView({ plugin }: { plugin: MannCaveHQPlugin }) {
  const [gh, setGh] = useState<GitHubData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gen, setGen] = useState(0);
  const user = plugin.settings.githubUser;

  useEffect(() => {
    if (!user) return;
    let dead = false;
    setLoading(true);
    setErr(null);
    fetchGitHubData(user, plugin.settings.githubToken)
      .then((d) => !dead && setGh(d))
      .catch((e) => !dead && setErr(e.message))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [gen, user, plugin]);

  const W = 560, H = 150, padL = 34, padT = 8, padB = 20;
  const plotW = W - padL - 6;
  const plotH = H - padT - padB;
  const slot = plotW / 14;
  const bw = Math.max(8, Math.floor(slot) - 5);
  const max = gh ? Math.max(4, ...gh.commitsByDay.map((d) => d.count)) : 4;

  return (
    <div className="mch-stack mch-hud-zone mch-boot" data-accent="violet">
      <div className="mch-hud-top">
        <span className="mch-hud-tag"><span className="mch-hud-pip" />REPO UPLINK ONLINE</span>
        <span className="mch-hud-tag mch-dim">SECTOR 06 // DEV</span>
      </div>

      <section className="mch-hud-card" data-accent="violet">
        <div className="mch-hud-card-head">
          <span>GITHUB UPLINK{gh ? ` // ${gh.name.toUpperCase()}` : ""}</span>
          <span className="mch-graph-tools">
            <button className="mch-btn mch-btn-ghost" disabled={loading} onClick={() => setGen((g) => g + 1)}>
              {loading ? "SYNCING…" : "REFRESH"}
            </button>
            <span className="mch-hud-id">MOD-08</span>
          </span>
        </div>
        {!user && (
          <div className="mch-empty">Set your GitHub username in Settings → MannCave HQ to bring the uplink online.</div>
        )}
        {err && <div className="mch-empty">Uplink error: {err}</div>}
        {gh && (
          <>
            <div className="mch-readouts">
              <span><b>{gh.publicRepos}</b>REPOS</span>
              <span><b>{gh.totalStars}</b>STARS</span>
              <span><b>{gh.followers}</b>FOLLOWERS</span>
              <span><b>{gh.commits30d}</b>COMMITS 30D</span>
            </div>
            <ul className="mch-list">
              {gh.repos.map((r) => (
                <li key={r.fullName}>
                  <button className="mch-note mch-repo" onClick={() => window.open(r.url)}>
                    <span className="mch-note-title">
                      {r.name}
                      {r.isPrivate && <span className="mch-repo-private"> 🔒</span>}
                      {r.description && <span className="mch-repo-desc"> — {r.description}</span>}
                    </span>
                    <span className="mch-repo-meta">
                      {r.language} · ★{r.stars} · {r.pushedAt}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mch-hud-card" data-accent="violet">
        <div className="mch-hud-card-head">
          <span>COMMIT PULSE // LAST 14 DAYS</span>
          <span className="mch-hud-id">MOD-09</span>
        </div>
        {gh && gh.commitsByDay.every((d) => d.count === 0) && (
          <div className="mch-empty">No pushes detected in the last two weeks — the forge awaits.</div>
        )}
        {gh && gh.commitsByDay.some((d) => d.count > 0) && (
          <svg
            className="mch-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Commits pushed per day over the last 14 days"
          >
            <line x1={padL} x2={W - 4} y1={padT + plotH} y2={padT + plotH} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
            <line x1={padL} x2={W - 4} y1={padT + plotH / 2} y2={padT + plotH / 2} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <text x={padL - 6} y={padT + plotH / 2 + 3} textAnchor="end" className="mch-chart-tick">{Math.round(max / 2)}</text>
            <text x={padL - 6} y={padT + 3} textAnchor="end" className="mch-chart-tick">{max}</text>
            {gh.commitsByDay.map((d, i) => {
              const h = (plotH * d.count) / max;
              return (
                <g key={d.date}>
                  {d.count > 0 && (
                    <rect
                      x={padL + i * slot + (slot - bw) / 2}
                      y={padT + plotH - h}
                      width={bw}
                      height={Math.max(1, h)}
                      rx="1"
                      fill={COMMIT_BAR}
                    >
                      <title>{`${d.date} — ${d.count} commit${d.count === 1 ? "" : "s"}`}</title>
                    </rect>
                  )}
                  {i % 2 === 1 && (
                    <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="mch-chart-tick">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {gh && gh.recent.length > 0 && (
          <div className="mch-scroll-x"><table className="mch-usage-table">
            <thead>
              <tr><th>RECENT PUSHES</th><th></th><th className="num">WHEN</th></tr>
            </thead>
            <tbody>
              {gh.recent.map((c, i) => (
                <tr key={i}>
                  <td>{c.repo}</td>
                  <td>{c.message}</td>
                  <td className="num">{c.when}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {loading && !gh && <div className="mch-empty">Contacting GitHub…</div>}
      </section>
    </div>
  );
}

/* ---------- Home snapshots ---------- */

/** Thin bar sparkline — shared by the dev and usage snapshots. */
function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const W = 120;
  const H = 26;
  const slot = W / values.length;
  const bw = Math.max(2, slot - 2);
  return (
    <svg className="mch-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(1.5, (H * v) / max) : 0;
        return h > 0 ? (
          <rect key={i} x={i * slot + (slot - bw) / 2} y={H - h} width={bw} height={h} rx="1" fill={color} />
        ) : null;
      })}
    </svg>
  );
}

function DevSnapshot({ plugin, onOpen }: { plugin: MannCaveHQPlugin; onOpen: () => void }) {
  const [gh, setGh] = useState<GitHubData | null>(null);
  const [err, setErr] = useState(false);
  const user = plugin.settings.githubUser;

  useEffect(() => {
    if (!user) return;
    let dead = false;
    getGitHubData(user, plugin.settings.githubToken)
      .then((d) => !dead && setGh(d))
      .catch(() => !dead && setErr(true));
    return () => {
      dead = true;
    };
  }, [user, plugin]);

  return (
    <button className="mch-snap" data-accent="violet" onClick={onOpen}>
      {/* WebKit will not lay out a <button> as a flex column: children centre
          and the box collapses, spilling over neighbours. Inner span owns the layout. */}
      <span className="mch-snap-inner">
        <span className="mch-snap-head">
          <span>DEV PULSE</span>
          <span className="mch-snap-more">DEV →</span>
        </span>
        {!user || err ? (
          <span className="mch-snap-empty">{err ? "uplink unavailable" : "set GitHub user in settings"}</span>
        ) : !gh ? (
          <span className="mch-snap-empty">syncing…</span>
        ) : (
          <>
            <span className="mch-snap-hero">
              <b>{gh.commits14d}</b>
              <span className="mch-snap-unit">commits · 14d</span>
              <Spark values={gh.commitsByDay.map((d) => d.count)} color={COMMIT_BAR} />
            </span>
            <span className="mch-snap-rows">
              {gh.commitsByRepo.slice(0, 4).map((r) => (
                <span key={r.repo} className="mch-snap-row">
                  <span className="mch-snap-label">{r.repo}</span>
                  <span className="mch-snap-val">{r.count}</span>
                </span>
              ))}
              {gh.commitsByRepo.length === 0 && (
                <span className="mch-snap-empty">no pushes in the last 14 days</span>
              )}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function UsageSnapshot({ plugin, onOpen }: { plugin: MannCaveHQPlugin; onOpen: () => void }) {
  const m = (window as any).moment;
  const log = plugin.settings.usageLog ?? {};
  const series: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = m().subtract(i, "days").format("YYYY-MM-DD");
    let t = 0;
    for (const e of Object.values(log[date] ?? {})) t += e.in + e.out;
    series.push(t);
  }
  const today = series[series.length - 1];
  const week = series.slice(7).reduce((n, v) => n + v, 0);
  const models = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = m().subtract(i, "days").format("YYYY-MM-DD");
    for (const k of Object.keys(log[d] ?? {})) models.add(k);
  }
  const active = [...models][0] ?? "—";

  return (
    <button className="mch-snap" data-accent="ice" onClick={onOpen}>
      {/* WebKit will not lay out a <button> as a flex column: children centre
          and the box collapses, spilling over neighbours. Inner span owns the layout. */}
      <span className="mch-snap-inner">
        <span className="mch-snap-head">
          <span>TOKEN FLOW</span>
          <span className="mch-snap-more">GRID →</span>
        </span>
        {series.every((v) => v === 0) ? (
          <span className="mch-snap-empty">no API calls recorded yet</span>
        ) : (
          <>
            <span className="mch-snap-hero">
              <b>{fmtTok(today)}</b>
              <span className="mch-snap-unit">tokens · today</span>
              <Spark values={series} color={USAGE_IN} />
            </span>
            <span className="mch-snap-rows">
              <span className="mch-snap-row">
                <span className="mch-snap-label">last 7 days</span>
                <span className="mch-snap-val">{fmtTok(week)}</span>
              </span>
              <span className="mch-snap-row">
                <span className="mch-snap-label">active model</span>
                <span className="mch-snap-val mch-snap-model">{active.split(" · ").pop()}</span>
              </span>
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function MiniGraph({ plugin, onOpen }: { plugin: MannCaveHQPlugin; onOpen: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meta, setMeta] = useState({ nodes: 0, links: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const W = Math.max(180, wrap.clientWidth);
    const H = 132;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // smaller cap: this is an ambient view, not the working map
    const model = buildGraph(plugin.app, plugin.settings, 160);
    setMeta({ nodes: model.nodes.length, links: model.links.length });
    const anchors = seedLayout(model, W, H);
    for (let i = 0; i < 170; i++) stepLayout(model, anchors, W, H);
    drawGraph(ctx, model, W, H, dpr, { scale: 0.62, glow: false });
  }, [plugin]);

  return (
    <button className="mch-snap mch-snap-graph" data-accent="ice" onClick={onOpen}>
      {/* WebKit will not lay out a <button> as a flex column: children centre
          and the box collapses, spilling over neighbours. Inner span owns the layout. */}
      <span className="mch-snap-inner">
        <span className="mch-snap-head">
          <span>NEURAL MAP</span>
          <span className="mch-snap-more">GRID →</span>
        </span>
        <span className="mch-minigraph" ref={wrapRef}>
          <canvas ref={canvasRef} />
        </span>
        <span className="mch-snap-rows">
          <span className="mch-snap-row">
            <span className="mch-snap-label">{meta.nodes} notes</span>
            <span className="mch-snap-val">{meta.links} links</span>
          </span>
        </span>
      </span>
    </button>
  );
}
