# MannCave HQ — Obsidian Plugin

Personal command center inside Obsidian: Today view with quick capture, brand areas (WWP, Kingdom Athletics, MannCave Media), and an AI copilot that saves transcripts into the vault.

## Install via BRAT (recommended)
1. Install the **BRAT** community plugin in Obsidian
2. BRAT → **Add beta plugin** → enter `MannCave/manncave-hq`
3. Enable **MannCave HQ** under Settings → Community plugins
4. Updates: BRAT checks GitHub releases; "Check for updates" pulls new versions right from your phone

## Install (pre-built)
1. In your vault, create the folder `.obsidian/plugins/manncave-hq/`
2. Copy `manifest.json`, `main.js`, and `styles.css` into it
3. Obsidian → Settings → Community plugins → enable **MannCave HQ**
4. Settings → MannCave HQ → set your AI provider (Anthropic key, or Ollama for local models)
5. Open via the dashboard ribbon icon or the "Open dashboard" command

With Obsidian Sync set to sync plugins, it installs itself on your other devices automatically.

## Claude on any device (no API keys)
See [docs/claude-connector-setup.md](docs/claude-connector-setup.md) — connect
claude.ai (web/desktop/mobile, Pro subscription) to the vault through a private
GitHub repo + the GitHub remote MCP connector, so Claude can read notes and
commit drafts from anywhere.

## Develop
```
npm install
npm run dev    # watch mode
npm run build  # production main.js
```

## Structure
- `src/main.ts` — plugin entry, view + settings registration
- `src/settings.ts` — provider config, vault folder paths
- `src/vault.ts` — reads/writes vault notes, templates, daily capture, transcripts
- `src/ai.ts` — provider abstraction (Anthropic + Ollama; add more here)
- `src/view.tsx` / `src/ui/App.tsx` — React dashboard
- `styles.css` — design system (area accent colors)
