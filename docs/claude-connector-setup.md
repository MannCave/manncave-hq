# Claude on Any Device — Vault Connector Setup (Option B: GitHub bridge)

Goal: talk to Claude on **claude.ai (web, desktop, or the mobile app)** using your
**Pro subscription — no API keys** — and have it read your vault and write drafts
back into it, from any device.

How it works:

```
 Obsidian vault ⇄ obsidian-git (desktop) ⇄ private GitHub repo ⇄ GitHub remote MCP ⇄ claude.ai
      ⇅
 Obsidian Sync (already syncs vault to iPhone/iPad)
```

Claude talks to the GitHub copy of your vault. The obsidian-git plugin keeps the
GitHub copy and your real vault in sync. Obsidian Sync (which you already use)
carries changes to your phone. Nothing self-hosted, nothing exposed to the
internet by you — GitHub handles auth and hosting.

**Time: ~20 minutes.** Everything here happens on your desktop plus claude.ai
settings, one time.

---

## Step 1 — Create a private GitHub repo for the vault

1. On github.com: **New repository** → name it `manncave-vault` → **Private** →
   do NOT add a README/gitignore (keep it empty) → Create.
2. That's it for now — the plugin will fill it in Step 3.

> ⚠️ Keep this repo **private**, always. It will contain your entire second brain.

## Step 2 — The .gitignore (do this BEFORE the first push)

The `.obsidian` folder contains plugin settings — **including this plugin's
`data.json`, which holds your API keys.** It must never reach GitHub. Obsidian
Sync already syncs your settings between devices, so git doesn't need them at all.

Create a file called `.gitignore` in the **root of your vault** (desktop, any
text editor — or Obsidian itself with "Detect all file extensions" on) with:

```gitignore
.obsidian/
.trash/
.DS_Store
```

Double-check the filename is exactly `.gitignore` (leading dot, no extension).

## Step 3 — Install and configure obsidian-git (desktop only)

1. Obsidian → Settings → Community plugins → Browse → install **Git**
   (a.k.a. obsidian-git) → enable it.
2. Command palette → **Git: Initialize a new repository**.
3. Connect it to GitHub. Easiest path — command palette →
   **Git: Edit remotes** → add remote `origin` with the HTTPS URL of your repo:
   `https://github.com/MannCave/manncave-vault.git`
   - When asked to authenticate, use a **fine-grained personal access token**:
     github.com → Settings → Developer settings → Fine-grained tokens → Generate:
     repository access = *only* `manncave-vault`, permissions = **Contents:
     Read and write**. Use the token as your password.
4. Command palette → **Git: Commit-and-sync** — first push happens here.
   Open the repo on github.com and confirm two things:
   - Your notes are there ✅
   - The `.obsidian` folder is **NOT** there ✅ (if it is, fix Step 2 before continuing)
5. In the Git plugin settings, set the automation:
   - **Auto commit-and-sync interval:** 10 (minutes)
   - **Auto pull interval:** 5 (minutes)
   - **Pull on startup:** on
   - Commit message: `vault sync {{date}}` (or leave default)

> **Important — one relay only:** run obsidian-git on your **desktop only**.
> Your phone keeps using Obsidian Sync as it does today. Desktop is the relay
> between git and Obsidian Sync. Running git on mobile *and* Obsidian Sync
> together invites conflicts; don't.

## Step 4 — Add a "map for Claude" to the vault root

Claude navigates the repo better with a signpost. Create a note called
`README.md` in the vault root:

```markdown
# MannCave HQ Vault

Personal command center for four brands. Folder map:

- `01 - Daily Recap/` — daily logs (one note per day, YYYY-MM-DD.md)
- `02 - WWP/` — WorldWidePeptides: Projects, Development, Business, Content Hub
- `03 - Kingdom Athletics/` — "KA": Blog Posts, Merch, Future Plans, Content Hub
- `04 - MannCave Media/` — podcast episodes, vlogs, streams, Content Hub
- `05 - AI Transcripts/` — saved AI conversations
- `06 - Templates/` — note templates (do not edit)
- `07 - System/` — brand voice files ("Brand Voice - <brand>.md"). Read the
  relevant one BEFORE drafting content for that brand, and write in that voice.
- `08 - McClainsRV/` — "MCCRV": Projects, Notes, Content Hub

Conventions for new notes:
- Frontmatter: `area` (wwp|kingdom|manncave|mccrv), `type`
  (content-idea|blog|episode|merch|project), `status` (idea|in-progress|done)
- New content ideas go in the brand's `Content Hub/` folder with `status: idea`
- Drafts of existing ideas: edit the idea's note, keep its frontmatter
```

## Step 5 — Add the GitHub connector on claude.ai

1. Go to **claude.ai → Settings → Connectors** (Pro/Max feature) →
   **Add custom connector**.
2. Name: `GitHub` — URL: `https://api.githubcopilot.com/mcp/`
3. Complete the OAuth sign-in to GitHub when prompted and grant access.
4. In any chat: open the tools/connectors menu and enable GitHub for that chat.

Connectors are attached to your **account**, so this works identically in the
iOS app, web, and desktop — nothing to install per device.

## Step 6 — Use it

Example prompts (from your phone, in the claude.ai app):

> In my repo MannCave/manncave-vault: read `07 - System/Brand Voice - Kingdom
> Athletics.md` and the notes in `03 - Kingdom Athletics/Content Hub/`. Draft
> the strongest idle idea into a full blog post in the KA voice, and commit it
> as an update to that idea's note.

> Read the last 7 notes in `01 - Daily Recap/` and commit a new note to
> `04 - MannCave Media/Content Hub/` with three episode ideas based on what
> I've been working on. Frontmatter: area manncave, type content-idea, status idea.

Within ~10 minutes (the auto-pull interval), the committed notes appear in your
desktop vault, and Obsidian Sync carries them to your phone — statuses, Neural
Map, and dashboards pick them up automatically.

---

## Troubleshooting

- **Claude's changes aren't in the vault** → desktop Obsidian must be running
  for the git auto-pull; open it (or run **Git: Pull**) and they'll land.
- **Merge conflict warnings in obsidian-git** → almost always caused by editing
  the same note on GitHub and locally within one sync window. Run **Git:
  Commit-and-sync**; for stubborn cases, the plugin's "Open source control view"
  lets you pick a side.
- **Claude can't find the repo** → make sure the chat has the GitHub connector
  enabled (per-chat toggle) and that you granted the OAuth app access to the
  `manncave-vault` repo.
- **Secrets check** — run once after setup: search the GitHub repo for
  `apiKey`. Zero results expected. If `data.json` ever appears, rotate the keys
  it contains, then fix `.gitignore` and remove the file from git history.

## Later upgrade — Option A (real-time tunnel)

If the sync lag ever bothers you, the upgrade path is a live bridge: Obsidian
Local REST API plugin + an MCP wrapper on the desktop, published through a
Cloudflare Tunnel, added as a second custom connector. Real-time reads/writes,
but requires the desktop online and careful auth. Ask Claude Code to set it up
when you want it.
