# Wine Butler IQ — CLAUDE.md

> Brand migrated from winebutlerai.com to winebutleriq.com on July 12, 2026.

## Project Overview
Wine inventory tracker and AI sommelier for personal collectors.
Domain: winebutleriq.com
PRD: `C:\Users\amand\ClaudeWorkspace\Projects\OneOff\cellar-ai\CellarAI_PRD_v1.1.docx` (rename to WineButlerIQ_PRD_v1.1.docx when convenient)

## Exhaustion, communication, and sequencing rules (added 2026-07-20 after a multi-source research task that left too many things half-finished and poorly communicated)

**Exhaust or disqualify — no source or option sits at "open" indefinitely.** For every candidate (data source, API, tool, approach), keep working it until one of two real end states is reached: it is actually usable (with evidence), or it is officially ruled out (with the specific reason — access, license, data quality, shape mismatch). "Untested" or "unresolved" is not a resting state to report and move on from; it is a to-do that gets worked in the same pass, not deferred.

**When Claude hits a wall it can't get past itself, the response must include concrete steps the user can take** — not just a report that something failed. If Claude's own tools are blocked (network restriction, CORS, auth), say so, and then give the exact URL, command, or action that lets the user get past it from their own machine. This applies broadly, not just to one project's data sources.

**No code deliverable until everything related in the current ask is actually resolved.** Don't hand over a file, a function, or a snippet while other parts of the same request are still open, half-checked, or waiting on a decision. Finish or explicitly flag every related thread first; code comes last, not as a placeholder for unfinished research.

**No git add/commit/push until everything in scope is aligned.** Don't commit piecemeal as work happens. Get full agreement on the whole batch of changes first, then commit together — not a trail of incremental commits the user has to review one at a time.

**Keep a rolling, visible status.** Use the task list (TaskCreate/TaskUpdate) to track every open thread for work like this — sources being evaluated, blockers, next steps — so the user can see current state at a glance instead of having to re-ask what's outstanding.

**Communication subagent.** Before sending any response that reports status across multiple open items, route the findings through a dedicated subagent whose only job is packaging them clearly: a plain list, one entry per item, each with current status and either a concrete next step already taken or a specific action for the user — never a paragraph that buries the actual answer. This is a standing step, not a one-time fix. (Implementation note: this platform's available subagent types don't include a custom persistent "communication" type — this is implemented as a strict, reusable prompt template run through the general-purpose agent, invoked every time, not as a one-off.)

**No bare status — every item gets a recommendation and a follow-up, no exceptions (added 2026-07-20 after the first version of this rule still produced bare status lines).** It is not enough for a list entry to say "resolved, no action needed" or "open, your call." Every single entry, without exception — resolved, open, blocked, or disqualified — must carry two things: a specific recommendation (what Claude thinks should happen next, stated as a real recommendation, not a deflection back to the user) and a concrete follow-up (either the action Claude is about to take, or the exact thing the user needs to decide/do). "No action needed" is only acceptable when paired with the reason nothing further is warranted — it is not a substitute for the recommendation/follow-up pair. This applies to every item in every status list the communication subagent produces; the subagent's prompt must explicitly instruct this, every time it is invoked, not just the first.

**A "follow-up" that just describes a dependency is not a follow-up (added 2026-07-20 after the second version of this rule still left items with nothing real to act on).** Text like "held until X is ready" or "will happen once Y is done" describes a state, not a next step, and fails this rule even though it looks like it satisfies it. Every item's follow-up must independently pass the same test as the Stop-short rule above: it is either (a) an action Claude already took in this same turn, with a real result shown, or (b) a specific, named action assigned to a specific owner (Claude or the user) with nothing vague about timing or precondition. If an item is genuinely blocked on another open item, the fix is not to write a softer follow-up — it is to go do the blocking item first, in the same turn, so the dependency resolves before the status is reported rather than being described. The communication subagent must check every item against this before output, not just confirm a recommendation/follow-up field is non-empty.

## Phase & completion rules (non-negotiable — added 2026-07-16 after a trust failure)

A "Phase 1" of any multi-phase initiative may only be called that if the final goal genuinely cannot be built without it — a true, load-bearing prerequisite. If a proposed step does not block or unlock the final goal, it is NOT a phase of that initiative. It gets its own name and its own separate task, full stop. Never bundle a nice-to-have or a maintenance safeguard into the same phase numbering as the real objective — doing so implies a dependency that doesn't exist and misleads on progress.

Before presenting any step as "Phase 1," "Phase 2," etc., or before marking one complete, state explicitly and out loud: does the final goal depend on this being done first? If the honest answer is no, say so before doing the work, not after being asked to justify it later.

Nothing gets marked "complete" or "verified" without a reproducible artifact — a commit hash, real test output, an actual diff — attached at the time it's claimed. A sentence asserting something passed is not evidence. If the artifact doesn't exist or isn't reproducible anymore, the item is not complete, regardless of what a plan doc says.

## Stop-short / verification-subagent rule (added 2026-07-20, strengthened same day after the first version still allowed a stale ending)

Whenever a response is about to present something as done, verified, or blocked — before that message is sent, spawn a verification subagent to check it independently. The subagent's job has three parts, not two: (1) confirm the claimed artifact actually exists and is reproducible (file on disk, real query output, a diff — not a sentence asserting it), (2) check whether every path available to Claude itself was actually exhausted before anything got handed back to the user, and (3) check the response's actual ending against the two allowed forms below — a description of a planned next step, on its own, is a stale ending and fails this check even if the artifact and exhaustion checks pass.

**A response may only end one of two ways:**
- **Completed further action** — the next step was already executed in this same turn, with its own real result shown, not just proposed; or
- **A named, specific approval request** — one exact action stated (what command, what file, what deploy, what irreversible or production-affecting step), with the reason it specifically requires the user rather than being something Claude could do unilaterally.

"I'm going to do X next," "the next step is Y," or any other statement of intent that does not fall into one of those two forms is a stale ending and must be caught by the subagent before the message goes out. If Claude catches itself about to write a stale ending, the fix is to either go do the thing right then, or convert it into a real, specific approval ask — not to soften the language around the same stall.

The subagent's report must say explicitly which of the two allowed endings the response achieves. If neither, the response is not finished — go back and do or ask, then re-verify.

## Data-source review rule (added 2026-07-20 after a table redesign this caused)

Before designing a database table meant to hold data from an external source, inspect that source's actual full column/field list first — every column, not a summary or a sample. Don't design the table's structure and then discover missing columns after the fact.

What happened: the `wine_knowledge` table was designed and shipped before the X-Wines CSV was actually opened and read column-by-column. Once it was, six real fields it contains had nowhere to land — ABV, Body, Acidity, Harmonize (food pairing), Elaborate (blend composition), Website, and a wine type/style — plus a structural mismatch on how vintage is represented (X-Wines lists a wine's vintages as a range; the table assumed one specific vintage per row). All fixable, but each fix costs a second migration and review cycle that a five-minute look at the real file header would have avoided the first time.

## Plan format requirement

Before any steps are shown, every plan opens with a short, plain statement: exactly what this is doing, and why it belongs in this plan/initiative at all. No steps get presented without that statement first. Steps themselves are still required — this is additive, not a replacement.

Plans get drafted using the `Plan` subagent (software-architect agent, built for step-by-step plans and dependency/trade-off analysis) before being presented — not written freehand. This is a standing requirement, always, not case-by-case.

Every blocker or step, in every plan, gets three additional things stated explicitly, not left implied: how it actually resolves, whether the user needs to do something and exactly what, and whether Claude Code/PowerShell needs to do something and exactly what. No step gets listed without that breakdown.

**Wine knowledge database initiative:** the reference-file reorg once labeled "Phase 1" was skipped 2026-07-16 — confirmed not a prerequisite for the real database, not worth the time, not committed. `lib/wines/wine-knowledge.ts` sits uncommitted/untracked in the working tree; `region-data.ts`/`varietal-data.ts` are gone from disk but recoverable from git's index (also uncommitted) if this work is ever picked back up. `normalize.ts`, `claude-extractor.ts`, and `normalize-cellar.ts` currently still import from `wine-knowledge.ts` in the working tree only — this has not been deployed. Its two unfinished items (deriving `constants.ts` dropdown lists from the hierarchy, free-text-preservation testing) plus the file rename go at the end of Phase 3 or become a separate standalone project, not this initiative's Phase 1. Full plan: `WINE_KNOWLEDGE_DATABASE_PLAN.md`. The real database (Supabase `wine_knowledge` table) has not started; prerequisites are being scoped.

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
- **Repo:** https://github.com/ambailey75/wine-butler-iq

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
- Production URL: `https://winebutleriq.com` (custom domain — add in Vercel dashboard)
- Vercel default URL: `https://cellar-ai-black.vercel.app` (will change after project rename)
- Dashboard: https://vercel.com/ai-agent-workshop-prj-s-projects/cellar-ai
- Framework preset: Next.js (set in dashboard — do not override in vercel.json)
- Cron jobs (to add): nightly alert evaluation, weekly enrichment refresh

## External Setup Steps (one-time, do manually)
1. **GitHub** — Go to https://github.com/ambailey75/Cellar-ai > Settings > rename repo to `wine-butler-ai`
2. **Git remote** — After GitHub rename, run: `git remote set-url origin https://github.com/ambailey75/wine-butler-iq`
3. **Vercel project rename** — Vercel dashboard > Project Settings > rename from `cellar-ai` to `wine-butler-ai`
4. **Custom domain** — Vercel dashboard > Domains > add `winebutleriq.com` and follow DNS instructions
5. **Rename folder** (optional) — Rename `cellar-ai/` to `wine-butler-ai/` and update this file's paths

## Installation Commands (run once when starting build)
```powershell
npm install
npx shadcn-ui@latest init
npx prisma init
```

## DEBUGGING PROTOCOL — use this process for every bug fix

1. Pick one specific failing record from real data
2. Trace it through the pipeline step by step:
   - Show rawData (what came from CSV)
   - Show mappedData (after column mapping)
   - Show normalizeWineData() output
   - Show what landed in the database
3. Identify the exact file and line where the value goes wrong
4. Write the smallest fix possible — touch only the file and lines identified
5. Run all agents before committing, not after
6. Delete test data and re-import real data after deploy
7. Verify visually before moving to next task

NEVER:
- Write fix code before running the diagnostic
- Change multiple systems in one pass without isolating root cause
- Assert something works without running it against real data
- Commit before agent QA passes

## Do Not
- Commit `.env.local`, `.env`, or any file containing API keys
- Use `curl` without `.exe` in PowerShell
- Use `Out-File` to write JSON (adds BOM) — use `[System.IO.File]::WriteAllText()`
- Expose `ANTHROPIC_API_KEY` in any client-side code
