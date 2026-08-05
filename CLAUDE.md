# MannCave HQ — Obsidian Plugin

## What this is
A custom Obsidian plugin serving as Houston's personal command center ("second brain") with a JARVIS-style red/black HUD aesthetic. It lives inside an Obsidian vault called "MannCave HQ" that syncs across iPhone/iPad/desktop via Obsidian Sync.

## Project context
- Three brand areas, each with its own accent + identity: WWP / WorldWidePeptides (black & gold company colors, molecular/peptide-chain motif, uppercase gold-gradient headers), Kingdom Athletics — always shortened to "KA" in UI copy (grungy industrial: forge-orange accent, hazard stripes, stencil/Impact headers, concrete-textured riveted cards, stenciled crown motif), MannCave Media (ember red, broadcast/waveform motif, scanline banner, LIVE badge). Home screen is red/black JARVIS HUD with an arc-reactor clock (day-progress ring), system modules, and a command-console quick capture; each area view opens with its own HUD status line (SECTOR 02/03/04).
- The vault has numbered folders: `01 - Daily Recap`, `02 - WWP`, `03 - Kingdom Athletics`, `04 - MannCave Media`, `05 - AI Transcripts`, `06 - Templates`, `07 - System` (brand voice files used as AI system prompts), `08 - McClainsRV`.
- Fourth brand area: McClainsRV — always shortened to "MCCRV" in UI copy (highway theme: route-green accent, exit-sign wordmark, dashed road-line card spines, camper-van motif, SECTOR 08). Graph nodes for MCCRV use the validated violet slot (AI transcripts fold into gray OTHER).
- AI providers (src/ai.ts): Anthropic, OpenRouter/OpenAI-compatible, NVIDIA (build.nvidia.com, fixed base URL, reuses the OpenAI-compat adapter), Ollama. Provider abstraction — new providers are small adapters.

## Stack & commands
- TypeScript + React 18, bundled with esbuild to a single `main.js` (CommonJS, `obsidian` external).
- `npm install` then `npm run build` (production) or `npm run dev` (watch).
- Type check: `npx tsc --noEmit`. No test suite yet.
- Current version: 0.13.2 (keep `manifest.json`, `package.json`, and `versions.json` in sync on every release).

## File map
- `src/main.ts` — plugin entry (view + ribbon + settings registration)
- `src/settings.ts` — provider config + vault folder paths
- `src/vault.ts` — vault data layer: AREAS config, note listing via metadataCache frontmatter, template-based note creation, daily-note quick capture, transcript saving
- `src/ai.ts` — AIProvider interface + Anthropic/OpenAICompat/Ollama adapters (uses Obsidian `requestUrl`, never fetch, to avoid CORS)
- `src/sketch.ts` — SketchModal: pointer-drawn canvas (pen pressure, eraser, undo), exports PNG with baked dark background + companion note, files to Daily or an area's Sketches folder
- `src/github.ts` — GitHub REST client (requestUrl): profile/repos/push events → Dev tab data (optional fine-grained PAT in settings); `getGitHubData` adds a 5-min shared cache so Today + Dev share one round trip
- `src/graph.ts` — vault link-graph engine shared by the full Neural Map and the home mini-map: `buildGraph` / `seedLayout` / `stepLayout` / `drawGraph` + `GRAPH_GROUPS`
- `src/view.tsx` — ItemView hosting React root
- `src/ui/App.tsx` — tabs: Today (HUD), 3 area views, AI chat
- `src/ui/motifs.tsx` — Reactor, PeptideChain, CrownMark, Waveform, LiveDot, Cursor
- `styles.css` — design system; area theming via `data-accent` + `.mch-theme-*` classes; all animations respect `prefers-reduced-motion`

## Conventions
- Frontmatter contract with the vault: `area` (wwp|kingdom|manncave|mccrv|personal), `type` (daily|content-idea|blog|episode|merch|transcript|project|sketch), `status` (idea|in-progress|done). The dashboard reads these — don't break them.
- Notes with `type: hub|overview|info` are excluded from listings.
- Template placeholders: `{{title}}` and `{{date:FORMAT}}` (moment format via `window.moment`).
- Mobile matters: this runs in Obsidian iOS. `isDesktopOnly: false` must stay false; avoid Node/Electron APIs.

## Distribution: BRAT via GitHub
- Repo: `MannCave/manncave-hq` (public). Houston installs/updates via BRAT ("Add beta plugin" → `MannCave/manncave-hq`).
- Releasing a new version: bump the version in `manifest.json` + `package.json`, add the entry to `versions.json`, commit, then tag and push the tag (`git tag 0.5.0 && git push origin 0.5.0`). The `release.yml` GitHub Actions workflow builds the plugin and publishes a release with `manifest.json`, `main.js`, `styles.css` attached — BRAT picks it up from there.
- Tags are bare versions (no `v` prefix); the workflow fails if the tag doesn't match both version fields.
- `main.js` is a build artifact and is gitignored — it ships only as a release asset.

## Roadmap
- "Draft it" action on content-idea notes (idea + brand voice + template → first draft)
- Repurposing engine (one finished piece → tweet thread, IG caption, YouTube description, newsletter blurb as linked notes)
- Prompt presets stored as notes in `07 - System` (Brainstorm / Critique / Draft modes layered on brand voice)
- Reactor alert rail (e.g. "2 ideas idle >7 days in Kingdom") + pipeline board view
- Weekly review flow + habit streaks
- Resume saved transcripts back into chat

Shipped in 0.5.0: markdown rendering in chat, streaming responses (fetch/SSE with non-streaming fallback), "Send to Content Hub" action on AI replies.
Shipped in 0.6.0: vault-aware chat context (attach active note / area backlog with statuses / last 7 daily recaps via toggle chips); chat state now survives vault changes and tab switches.
Shipped in 0.7.0: NVIDIA (build.nvidia.com) as a fourth provider with its own key/model settings.
Shipped in 0.8.0: brand theme overhaul — WWP black & gold, KA grungy industrial ("KA" shorthand everywhere), MannCave scanline banner, per-area HUD status lines.
Shipped in 0.9.0: Grid tab — TOKEN FLOW (per-request token usage recorded to data.json via provider-reported usage with char/4 estimation fallback; 14-day stacked bars + per-model 7d table, 90-day retention) and NEURAL MAP (canvas force-directed graph of vault links from metadataCache.resolvedLinks, colored by area, KA nodes square, click-to-open, 450-node cap). Chart palette steps validated for CVD/contrast on the dark surface.
Shipped in 0.10.0: LINK FORGE on the Grid tab — AI scans the 80 most recent notes (excluding templates and hub/overview/info) and proposes up to 8 new note pairs with reasons; accepting writes a wikilink (fileManager.generateMarkdownLink) under a "## Related" section in the source note and refreshes the Neural Map. Suggestions are validated against exact paths and existing links; usage is recorded to TOKEN FLOW.
Shipped in 0.13.2: fixed the real iOS overlap cause — WebKit does not lay out `<button>` as a flex **column** container (children centre, box collapses to ~0 height, contents spill over neighbouring cards). Chromium does not reproduce it, so the 0.13.1 harness passed. Fix: `.mch-sector` and `.mch-snap` buttons are `display:block` with an inner `.mch-*-inner` span owning the flex column — **never put `display:flex; flex-direction:column` directly on a `<button>`**. Also added a landscape-phone tier (`max-height:520px and pointer:coarse`) since width-only breakpoints never fire on a 956x440 phone.
Shipped in 0.13.1: responsive pass for iPhone/iPad/desktop — added flex-wrap to every header row, `min-width:0` on ellipsis spans (they were pushing siblings out of their cards), `dvh` heights for the chat pane, safe-area insets, horizontally-scrolling tab rail with an edge fade, tiered breakpoints (900/620/360px) plus a `pointer: coarse` tap-target tier, `.mch-scroll-x` wrappers on tables, and two-line repo rows on phones. Verified by rendering the real CSS at 6 viewports in headless Chromium and asserting zero horizontal spill and zero sibling overlap (harness pattern: build static replica pages, measure `getBoundingClientRect` per element).
Shipped in 0.13.0: home page rebuilt as the one-stop view — arc reactor + 2×2 sector switcher (per-area active/idea counts + load meter, tap to jump), command console, then a snapshot strip of DEV PULSE (14d commit count + sparkline + per-repo commit counts), TOKEN FLOW (today's tokens + sparkline + 7d total + active model) and a static NEURAL MAP mini-canvas; snapshot cards deep-link to their full tabs. Full TOKEN FLOW panel returned to Grid. Graph engine extracted to `src/graph.ts`; minimal pass lightens Today's card chrome (thinner bracket corners, quieter heads).
Shipped in 0.12.0: Dev tab (GITHUB UPLINK: profile readouts + 8 most recent repos; COMMIT PULSE: commits/day 14-day chart from push events + recent-pushes table; settings for username + optional PAT) and AUTO capture routing — the command console defaults to an ✦ AUTO chip where the AI classifies each capture into a daily-note section, Wins, or a brand's Content Hub as a new idea note (JSON classification via active provider, fallback to Notes on failure, usage recorded). DeepSeek documented as compat-provider option (base URL api.deepseek.com).
Shipped in 0.11.1: TOKEN FLOW moved from the Grid tab to the Today (home) tab, below the command console; Grid keeps NEURAL MAP + LINK FORGE.
Shipped in 0.11.0: McClainsRV (MCCRV) as a fourth brand area (tab, highway theme, Today module MOD-04, capture chip, AI chip, Content Hub, graph group) + handwritten notes: SketchModal canvas (finger/Pencil, pressure, six inks, eraser/undo/clear) saving PNG + companion note (`type: sketch`) into `<root>/Sketches/`, or embedding into today's daily log; opens from Today console, area banners, or the "New handwritten note" command.
