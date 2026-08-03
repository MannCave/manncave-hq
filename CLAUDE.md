# MannCave HQ — Obsidian Plugin

## What this is
A custom Obsidian plugin serving as Houston's personal command center ("second brain") with a JARVIS-style red/black HUD aesthetic. It lives inside an Obsidian vault called "MannCave HQ" that syncs across iPhone/iPad/desktop via Obsidian Sync.

## Project context
- Three brand areas, each with its own accent + identity: WWP / WorldWidePeptides (black & gold company colors, molecular/peptide-chain motif, uppercase gold-gradient headers), Kingdom Athletics — always shortened to "KA" in UI copy (grungy industrial: forge-orange accent, hazard stripes, stencil/Impact headers, concrete-textured riveted cards, stenciled crown motif), MannCave Media (ember red, broadcast/waveform motif, scanline banner, LIVE badge). Home screen is red/black JARVIS HUD with an arc-reactor clock (day-progress ring), system modules, and a command-console quick capture; each area view opens with its own HUD status line (SECTOR 02/03/04).
- The vault has numbered folders: `01 - Daily Recap`, `02 - WWP`, `03 - Kingdom Athletics`, `04 - MannCave Media`, `05 - AI Transcripts`, `06 - Templates`, `07 - System` (brand voice files used as AI system prompts).
- AI providers (src/ai.ts): Anthropic, OpenRouter/OpenAI-compatible, NVIDIA (build.nvidia.com, fixed base URL, reuses the OpenAI-compat adapter), Ollama. Provider abstraction — new providers are small adapters.

## Stack & commands
- TypeScript + React 18, bundled with esbuild to a single `main.js` (CommonJS, `obsidian` external).
- `npm install` then `npm run build` (production) or `npm run dev` (watch).
- Type check: `npx tsc --noEmit`. No test suite yet.
- Current version: 0.8.0 (keep `manifest.json`, `package.json`, and `versions.json` in sync on every release).

## File map
- `src/main.ts` — plugin entry (view + ribbon + settings registration)
- `src/settings.ts` — provider config + vault folder paths
- `src/vault.ts` — vault data layer: AREAS config, note listing via metadataCache frontmatter, template-based note creation, daily-note quick capture, transcript saving
- `src/ai.ts` — AIProvider interface + Anthropic/OpenAICompat/Ollama adapters (uses Obsidian `requestUrl`, never fetch, to avoid CORS)
- `src/view.tsx` — ItemView hosting React root
- `src/ui/App.tsx` — tabs: Today (HUD), 3 area views, AI chat
- `src/ui/motifs.tsx` — Reactor, PeptideChain, CrownMark, Waveform, LiveDot, Cursor
- `styles.css` — design system; area theming via `data-accent` + `.mch-theme-*` classes; all animations respect `prefers-reduced-motion`

## Conventions
- Frontmatter contract with the vault: `area` (wwp|kingdom|manncave|personal), `type` (daily|content-idea|blog|episode|merch|transcript|project), `status` (idea|in-progress|done). The dashboard reads these — don't break them.
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
