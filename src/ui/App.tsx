import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer, Notice } from "obsidian";
import type MannCaveHQPlugin from "../main";
import { AREAS, AreaConfig, AreaSection, NoteInfo, VaultData } from "../vault";
import { ChatMessage, getProvider } from "../ai";
import { AreaMotif, Reactor, LiveDot, Cursor } from "./motifs";

type TabId = "today" | "wwp" | "kingdom" | "manncave" | "ai";

const TABS: { id: TabId; label: string; accent: string }[] = [
  { id: "today", label: "Today", accent: "amber" },
  { id: "wwp", label: "WWP", accent: "teal" },
  { id: "kingdom", label: "Kingdom", accent: "violet" },
  { id: "manncave", label: "MannCave", accent: "ember" },
  { id: "ai", label: "AI", accent: "ice" },
];

const AREA_ACCENT: Record<string, string> = {
  wwp: "teal",
  kingdom: "violet",
  manncave: "ember",
};

const CAPTURE_TARGETS: { label: string; header: string | null }[] = [
  { label: "Notes", header: "## 📝 Notes & Thoughts" },
  { label: "WWP", header: "### WWP" },
  { label: "Kingdom", header: "### Kingdom Athletics" },
  { label: "MannCave", header: "### MannCave Media" },
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
    return () => {
      plugin.app.metadataCache.offref(ref);
      plugin.app.vault.offref(ref2);
      plugin.app.vault.offref(ref3);
      plugin.app.vault.offref(ref4);
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

      <main className="mch-main" key={tick}>
        {tab === "today" && <TodayView data={data} onOpenArea={(id) => setTab(id)} />}
        {tab === "wwp" && <AreaView data={data} area={AREAS[0]} />}
        {tab === "kingdom" && <AreaView data={data} area={AREAS[1]} />}
        {tab === "manncave" && <AreaView data={data} area={AREAS[2]} />}
        {tab === "ai" && <AIView data={data} plugin={plugin} />}
      </main>
    </div>
  );
}

/* ---------- Today ---------- */

function TodayView({
  data,
  onOpenArea,
}: {
  data: VaultData;
  onOpenArea: (id: TabId) => void;
}) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await data.quickCapture(text.trim(), CAPTURE_TARGETS[target].header);
      new Notice(`Captured to ${CAPTURE_TARGETS[target].label}`);
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
        <div className="mch-hud-modules">
          {AREAS.map((area, i) => {
            const c = data.countByStatus(area);
            const load = c.total ? Math.round((c.active / c.total) * 100) : 0;
            return (
              <button
                key={area.id}
                className="mch-hud-card mch-hud-module"
                data-accent={AREA_ACCENT[area.id]}
                onClick={() => onOpenArea(area.id as TabId)}
              >
                <div className="mch-hud-card-head">
                  <span>{area.short.toUpperCase()}</span>
                  <span className="mch-hud-id">MOD-0{i + 1}</span>
                </div>
                <div className="mch-readouts">
                  <span><b>{c.active}</b>ACT</span>
                  <span><b>{c.ideas}</b>IDE</span>
                  <span><b>{c.total}</b>TOT</span>
                </div>
                <div className="mch-meter">
                  <div className="mch-meter-fill" style={{ width: `${load}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <section className="mch-hud-card mch-console">
        <div className="mch-hud-card-head">
          <span>COMMAND INPUT</span>
          <button
            className="mch-btn mch-btn-ghost"
            onClick={async () => data.openFile(await data.getOrCreateToday())}
          >
            OPEN DAILY LOG →
          </button>
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
            EXECUTE
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- Area ---------- */

function AreaView({ data, area }: { data: VaultData; area: AreaConfig }) {
  return (
    <div className={`mch-stack mch-hud-zone mch-boot mch-theme-${area.id}`} data-accent={AREA_ACCENT[area.id]}>
      <div className="mch-banner">
        <div className="mch-banner-left">
          <div className="mch-banner-kicker">{area.id === "wwp" ? "R&D · OPERATIONS" : area.id === "kingdom" ? "FAITH · DISCIPLINE" : "ON THE AIR"}</div>
          <div className="mch-banner-name">{area.name}</div>
        </div>
        <div className="mch-banner-right">
          {area.id === "manncave" && <LiveDot />}
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
      let lastPaint = 0;
      const reply = await provider.chatStream(system, next, (t) => {
        partial = t;
        const now = Date.now();
        if (now - lastPaint > 120) {
          lastPaint = now;
          setDraft(t);
        }
      });
      setMessages([...next, { role: "assistant", content: reply }]);
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
