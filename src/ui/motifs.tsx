import { useEffect, useState } from "react";
import type { AreaId } from "../vault";

/** WWP — peptide chain: linked molecular nodes */
export function PeptideChain() {
  const nodes = [8, 34, 60, 86, 112, 138];
  return (
    <svg className="mch-motif" width="150" height="24" viewBox="0 0 150 24" aria-hidden="true">
      {nodes.slice(0, -1).map((x, i) => (
        <line key={i} x1={x} y1={12} x2={nodes[i + 1]} y2={12} stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      ))}
      {nodes.map((x, i) => (
        <circle key={x} cx={x} cy={12} r={i % 2 === 0 ? 4.5 : 3} fill="currentColor" opacity={i % 2 === 0 ? 0.9 : 0.5} className={i === 2 ? "mch-node-pulse" : ""} />
      ))}
    </svg>
  );
}

/** Kingdom — crown chevron mark */
export function CrownMark() {
  return (
    <svg className="mch-motif" width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
      <path d="M4 18 L4 9 L11 14 L17 5 L23 14 L30 9 L30 18 Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1="4" y1="21" x2="30" y2="21" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
    </svg>
  );
}

/** MannCave — animated broadcast waveform */
export function Waveform() {
  return (
    <span className="mch-wave" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span key={i} className="mch-wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

export function LiveDot() {
  return (
    <span className="mch-live">
      <span className="mch-live-dot" />
      LIVE
    </span>
  );
}

/** Today — daylight arc: how much of today has passed */
export function DayArc() {
  const [pct, setPct] = useState(dayPct());
  useEffect(() => {
    const id = window.setInterval(() => setPct(dayPct()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="mch-dayarc" title={`${Math.round(pct)}% of today`}>
      <div className="mch-dayarc-fill" style={{ width: `${pct}%` }} />
      <span className="mch-dayarc-sun" style={{ left: `calc(${pct}% - 5px)` }} />
    </div>
  );
}

function dayPct(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.min(100, Math.max(0, (mins / 1440) * 100));
}

/** Home — arc reactor: live clock core, day-progress outer ring, rotating rings */
export function Reactor() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pct = dayPct();
  const C = 2 * Math.PI * 66;
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return (
    <div className="mch-reactor" role="img" aria-label={`Local time ${hh}:${mm}, ${Math.round(pct)} percent of day elapsed`}>
      <svg viewBox="0 0 160 160" className="mch-reactor-svg">
        <circle cx="80" cy="80" r="74" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.14" />
        <circle
          cx="80" cy="80" r="66" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeDasharray={`${(C * pct) / 100} ${C}`} strokeLinecap="round"
          transform="rotate(-90 80 80)" opacity="0.95"
        />
        <circle cx="80" cy="80" r="66" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.12" />
        <g className="mch-spin">
          <circle cx="80" cy="80" r="55" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="4 10" opacity="0.55" />
        </g>
        <g className="mch-spin-rev">
          <circle cx="80" cy="80" r="45" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="1.5 20" opacity="0.5" />
        </g>
        <circle cx="80" cy="80" r="36" fill="currentColor" opacity="0.06" />
        <circle cx="80" cy="80" r="36" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      </svg>
      <div className="mch-reactor-center">
        <div className="mch-reactor-time">{hh}:{mm}</div>
        <div className="mch-reactor-sub">{Math.round(pct)}% OF DAY</div>
      </div>
    </div>
  );
}

/** AI — blinking terminal cursor */
export function Cursor() {
  return <span className="mch-cursor" aria-hidden="true" />;
}

export function AreaMotif({ id }: { id: AreaId }) {
  if (id === "wwp") return <PeptideChain />;
  if (id === "kingdom") return <CrownMark />;
  return <Waveform />;
}
