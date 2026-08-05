/**
 * Guards the one layout rule this project keeps getting burned by.
 *
 * WebKit will not size a <button> box to stacked content. The box collapses to
 * near-zero height and its contents paint over neighbouring cards. Chromium
 * renders it correctly, so a browser render test cannot catch it — this check
 * exists because that bug shipped twice (0.13.1, 0.13.2).
 *
 * The rule is about what a button CONTAINS, not what class the button carries:
 * moving the flex column onto an inner wrapper does NOT fix the collapse.
 *
 * Rule: no <button> may contain an element whose class CSS declares as a column
 * flex/grid container. Use <div role="button"> (CardButton) for card layouts.
 */
import fs from "fs";
import path from "path";

const css = fs.readFileSync("styles.css", "utf8");

const columnClasses = new Set();
for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const body = m[2];
  const isFlexOrGrid = /display:\s*(inline-)?(flex|grid)/.test(body);
  const isColumn = /flex-direction:\s*column/.test(body) || /grid-template-rows/.test(body);
  if (!isFlexOrGrid || !isColumn) continue;
  for (const sel of m[1].split(",")) {
    for (const cls of sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)) columnClasses.add(cls[1]);
  }
}

const srcFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(f)) srcFiles.push(f);
  }
};
walk("src");

const violations = [];
for (const file of srcFiles) {
  const text = fs.readFileSync(file, "utf8");
  // Blank out comments (they discuss <button> in prose) and neutralise the ">"
  // inside JSX arrow functions, both with same-width fills so offsets — and
  // therefore reported line numbers — stay valid.
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const scrubbed = text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)))
    .replace(/=>/g, "=\u00BB");
  // whole <button …> … </button> region, including its children
  for (const region of scrubbed.matchAll(/<button\b[^>]*>.*?<\/button>/gs)) {
    for (const cn of region[0].matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = (cn[1] ?? cn[2] ?? "").replace(/\$\{[^}]*\}/g, " ").split(/\s+/);
      for (const c of classes) {
        if (columnClasses.has(c)) {
          const line = text.slice(0, region.index).split("\n").length;
          violations.push(`${file}:${line}  <button> contains .${c}, a column layout container`);
        }
      }
    }
  }
}

if (violations.length) {
  console.error("Layout guard FAILED — WebKit will collapse these button boxes:\n");
  for (const v of [...new Set(violations)]) console.error("  " + v);
  console.error('\nUse <div role="button"> (CardButton) instead of <button> for card layouts.');
  process.exit(1);
}
console.log(`Layout guard OK (${columnClasses.size} column-layout classes; no <button> contains one)`);
