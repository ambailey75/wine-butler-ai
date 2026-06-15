# Wine Butler AI — CLAUDE.md

## Project Overview
Wine inventory tracker and AI sommelier for personal collectors.
Domain: winebutlerai.com
PRD: `C:\Users\amand\ClaudeWorkspace\Projects\OneOff\cellar-ai\CellarAI_PRD_v1.1.docx` (rename to WineButlerAI_PRD_v1.1.docx when convenient)

## Paths
- **Project root:** `C:\Users\amand\ClaudeWorkspace\Projects\OneOff\cellar-ai`
- **Workspace root:** `C:\Users\amand\ClaudeWorkspace`
- **Secrets:** `C:\Users\amand\.claude\session-env\.env` (never commit)

## Tech Stack
- **Frontend:** Next.js 14 (App Router) — `app/` directory
- **Styling:** Tailwind CSS + shadcn/ui (to be installed)
- **Database:** Supabase (PostgreSQL + Auth + Storage)
- **ORM:** Prisma
- **AI:** Anthropic Claude API (`claude-sonnet-4-6`)
- **Email:** Resend
- **Deployment:** Vercel — auto-deploys on push to `main`
- **Repo:** https://github.com/ambailey75/wine-butler-ai (rename on GitHub — see external steps below)

## Environment Variables
Add these to `C:\Users\amand\.claude\session-env\.env` and to Vercel dashboard:
```
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
RESEND_API_KEY=
WINE_SEARCHER_API_KEY=
```
Never put secrets in `vercel.json`, `next.config.js`, or any committed file.

## Project Structure
```
cellar-ai/
  app/
    api/
      assistant/       # Claude AI chat endpoint
      import/          # File upload + extraction endpoints
      wines/           # CRUD endpoints
    (auth)/            # Auth pages (login, signup)
    dashboard/         # Main cellar dashboard
    import/            # Import flow pages
    layout.js          # Root layout
    page.js            # Coming soon / landing page
  components/
    ui/                # shadcn/ui primitives
    cellar/            # Cellar-specific components
    import/            # Import flow components
    assistant/         # AI chat components
  lib/
    ai/                # Claude API client, tools, system prompt builder
    import/            # Excel parser, PDF extractor, image OCR, column mapper
    enrichment/        # Wine data enrichment pipeline
    supabase/          # Supabase client (server + client)
    prisma/            # Prisma client singleton
  prisma/
    schema.prisma      # Database schema
    migrations/        # Migration files
  public/
  vercel.json          # {"framework": "nextjs"}
  CLAUDE.md            # This file
```

## Database Schema (Prisma)
Key models to implement:
- `User` — linked to Supabase Auth
- `Wine` — core inventory record (see PRD Section 4.2 for all fields)
- `WineEnrichment` — cached critic scores, pricing, drinking windows
- `CellarAlert` — drink-window notifications
- `AiConversation` — chat history (JSONB messages array)
- `Import` — import job record (source_type, status, file path)
- `ImportRow` — per-row extraction result with confidence scores

## Key Features to Build (MVP Phase 1)
1. Supabase Auth (magic link)
2. Wine CRUD with all fields from PRD Section 4.2
3. Collection import: Excel/CSV, PDF invoices, image/label photos
4. Duplicate detection on import
5. AI assistant with cellar context (Claude API tool use)
6. Async enrichment pipeline (drinking windows, valuations, scores)
7. Drink-by alerts (in-app)
8. Cellar dashboard (KPI cards, charts)
9. CSV export

## Import Pipeline
Three supported formats — all use Claude API:
- **Excel/CSV:** column-mapping UI; Claude suggests field mappings from headers
- **PDF invoice:** Claude extracts wine records per page as structured JSON
- **Image/label photo:** Claude vision extracts wine details; confidence scores per field

File size limits: 25MB per file, 20 files per batch, 100 PDF pages, 5,000 CSV rows.

## AI Assistant
- Model: `claude-sonnet-4-6`
- Pattern: system prompt includes full cellar inventory as JSON + user preferences
- Tool use: `get_cellar_inventory`, `get_wine_enrichment`, `search_wine_data`,
  `get_food_pairing`, `get_reorder_suggestions`, `get_cellar_analytics`
- API key is SERVER-SIDE ONLY — never in client bundle

## PowerShell Conventions (Windows)
- Use `curl.exe` not `curl`
- Use `[System.IO.File]::WriteAllText()` to write files (avoids BOM)
- Use `reload-env` after editing `.env`
- Node: v24, npm available globally
- Vercel CLI: installed globally (`vercel --prod` to deploy)

## Git Workflow
```powershell
git add .
git commit -m "message"
git push   # triggers auto-deploy on Vercel
```
For manual deploy: `vercel --prod`

## Vercel
- Project: `ai-agent-workshop-prj-s-projects/wine-butler-ai` (rename in Vercel dashboard)
- Production URL: `https://winebutlerai.com` (custom domain — add in Vercel dashboard)
- Vercel default URL: `https://cellar-ai-black.vercel.app` (will change after project rename)
- Dashboard: https://vercel.com/ai-agent-workshop-prj-s-projects/cellar-ai
- Framework preset: Next.js (set in dashboard — do not override in vercel.json)
- Cron jobs (to add): nightly alert evaluation, weekly enrichment refresh

## External Setup Steps (one-time, do manually)
1. **GitHub** — Go to https://github.com/ambailey75/Cellar-ai > Settings > rename repo to `wine-butler-ai`
2. **Git remote** — After GitHub rename, run: `git remote set-url origin https://github.com/ambailey75/wine-butler-ai`
3. **Vercel project rename** — Vercel dashboard > Project Settings > rename from `cellar-ai` to `wine-butler-ai`
4. **Custom domain** — Vercel dashboard > Domains > add `winebutlerai.com` and follow DNS instructions
5. **Rename folder** (optional) — Rename `cellar-ai/` to `wine-butler-ai/` and update this file's paths

## Installation Commands (run once when starting build)
```powershell
npm install
npx shadcn-ui@latest init
npx prisma init
```

## Do Not
- Commit `.env.local`, `.env`, or any file containing API keys
- Use `curl` without `.exe` in PowerShell
- Use `Out-File` to write JSON (adds BOM) — use `[System.IO.File]::WriteAllText()`
- Expose `ANTHROPIC_API_KEY` in any client-side code
